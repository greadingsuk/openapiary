// OpenApiary Worker — multi-user + fleet analytics.
//
// Auth model:
//   - Every request to /v1/* sends `X-API-Key: <raw key>`.
//   - We sha256 it, look up the user, attach { user } to context.
//   - Legacy single-tenant API_KEY secret is auto-migrated on first hit:
//     if no user matches the hash but the raw key equals env.API_KEY,
//     we lazily create a "legacy" user and adopt any orphaned hives.
//
// Routes:
//   POST   /v1/account/register          create a new user, returns api_key (one-shot)
//   POST   /v1/readings                  bulk-insert from app (scoped to caller)
//   GET    /v1/hives                     list caller's hives
//   GET    /v1/hives/:id/readings        time-range query
//   PATCH  /v1/hives/:id                 update name / public / lat / lon / region
//
//   --- admin (X-Admin-Key) ---
//   GET    /v1/admin/fleet/stats         counts + last-24h ingest summary
//   GET    /v1/admin/fleet/hives         all hives across users (anonymised)
//   GET    /v1/admin/fleet/readings      cross-user readings (region/time window)

import { Hono } from "hono";

type Bindings = {
    DB: D1Database;
    API_KEY: string;          // legacy single-tenant key (kept for back-compat)
    ADMIN_KEY: string;        // separate key for fleet/* admin endpoints
};

type User = {
    id: string;
    email: string | null;
    api_key_hash: string;
    created_at: number;
    is_admin: number;
};

type Reading = {
    ts: number;
    weightKg: number;
    batteryV: number;
    tempC?: number;
    packetId: number;
    rssi?: number;
};

type Variables = { user: User };

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

const newId = () => crypto.randomUUID();

async function findUserByKey(db: D1Database, rawKey: string): Promise<User | null> {
    const hash = await sha256Hex(rawKey);
    const row = await db
        .prepare(`SELECT id, email, api_key_hash, created_at, is_admin FROM users WHERE api_key_hash = ?`)
        .bind(hash)
        .first<User>();
    return row ?? null;
}

async function adoptLegacyKeyIfMatch(
    db: D1Database,
    rawKey: string,
    legacyKey: string
): Promise<User | null> {
    if (!legacyKey || !timingSafeEqual(rawKey, legacyKey)) return null;
    const id = newId();
    const hash = await sha256Hex(rawKey);
    const now = Date.now();
    await db
        .prepare(
            `INSERT INTO users (id, email, api_key_hash, created_at, is_admin)
             VALUES (?, NULL, ?, ?, 0)`
        )
        .bind(id, hash, now)
        .run();
    await db.prepare(`UPDATE hives SET user_id = ? WHERE user_id IS NULL`).bind(id).run();
    return { id, email: null, api_key_hash: hash, created_at: now, is_admin: 0 };
}

// --- auth middleware for /v1/* (excluding /v1/admin/* + /v1/account/register) ---
app.use("/v1/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/v1/admin/") || path === "/v1/account/register") {
        return next();
    }
    const provided = c.req.header("X-API-Key") ?? "";
    if (!provided) return c.json({ error: "unauthorized" }, 401);

    let user = await findUserByKey(c.env.DB, provided);
    if (!user) user = await adoptLegacyKeyIfMatch(c.env.DB, provided, c.env.API_KEY);
    if (!user) return c.json({ error: "unauthorized" }, 401);

    c.set("user", user);
    await next();
});

app.use("/v1/admin/*", async (c, next) => {
    // Always-on CORS for the fleet dashboard (any origin - the X-Admin-Key
    // header is the security boundary, not the origin).
    if (c.req.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "X-Admin-Key, Content-Type",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Max-Age": "86400",
            },
        });
    }
    const provided = c.req.header("X-Admin-Key") ?? "";
    if (!c.env.ADMIN_KEY || !timingSafeEqual(provided, c.env.ADMIN_KEY)) {
        return c.json({ error: "unauthorized" }, 401, {
            "Access-Control-Allow-Origin": "*",
        });
    }
    await next();
    c.res.headers.set("Access-Control-Allow-Origin", "*");
});

// --- POST /v1/account/register ---
app.post("/v1/account/register", async (c) => {
    const body = await c.req.json<{ email?: string }>().catch(() => ({}));
    const id = newId();
    const rawKey = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    const hash = await sha256Hex(rawKey);
    try {
        await c.env.DB.prepare(
            `INSERT INTO users (id, email, api_key_hash, created_at, is_admin)
             VALUES (?, ?, ?, ?, 0)`
        )
            .bind(id, body.email ?? null, hash, Date.now())
            .run();
    } catch (e: any) {
        if (String(e?.message).includes("UNIQUE")) {
            return c.json({ error: "email already registered" }, 409);
        }
        throw e;
    }
    return c.json({ user_id: id, api_key: rawKey });
});

// --- POST /v1/readings ---
app.post("/v1/readings", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ hiveId: string; deviceName?: string; readings: Reading[] }>();
    if (!body?.hiveId || !Array.isArray(body.readings)) return c.json({ error: "bad request" }, 400);

    const existing = await c.env.DB.prepare(`SELECT user_id FROM hives WHERE id = ?`)
        .bind(body.hiveId)
        .first<{ user_id: string | null }>();
    if (existing && existing.user_id && existing.user_id !== user.id) {
        return c.json({ error: "hive belongs to another user" }, 403);
    }

    await c.env.DB.prepare(
        `INSERT INTO hives (id, name, owner_key_id, user_id, created_at, public)
         VALUES (?, ?, 'multi', ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
            name    = COALESCE(excluded.name, hives.name),
            user_id = COALESCE(hives.user_id, excluded.user_id)`
    )
        .bind(body.hiveId, body.deviceName ?? body.hiveId, user.id, Date.now())
        .run();

    const stmts = body.readings.map((r) =>
        c.env.DB.prepare(
            `INSERT OR IGNORE INTO readings
             (hive_id, ts, weight_kg, battery_v, temp_c, rssi, packet_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(body.hiveId, r.ts, r.weightKg, r.batteryV, r.tempC ?? null, r.rssi ?? null, r.packetId)
    );
    if (stmts.length) await c.env.DB.batch(stmts);

    return c.json({ ok: true, accepted: body.readings.length });
});

// --- GET /v1/hives ---
app.get("/v1/hives", async (c) => {
    const user = c.get("user");
    const { results } = await c.env.DB.prepare(
        `SELECT id, name, created_at, public, lat, lon, region
         FROM hives WHERE user_id = ? ORDER BY created_at DESC`
    )
        .bind(user.id)
        .all();
    return c.json({ hives: results });
});

// --- GET /v1/hives/:id/readings ---
app.get("/v1/hives/:id/readings", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const from = Number(c.req.query("from") ?? 0);
    const to = Number(c.req.query("to") ?? Date.now());

    const owner = await c.env.DB.prepare(`SELECT user_id FROM hives WHERE id = ?`)
        .bind(id)
        .first<{ user_id: string | null }>();
    if (!owner || owner.user_id !== user.id) return c.json({ error: "not found" }, 404);

    const { results } = await c.env.DB.prepare(
        `SELECT ts, weight_kg, battery_v, temp_c, rssi, packet_id
         FROM readings
         WHERE hive_id = ? AND ts BETWEEN ? AND ?
         ORDER BY ts ASC LIMIT 10000`
    )
        .bind(id, from, to)
        .all();
    return c.json({ readings: results });
});

// --- PATCH /v1/hives/:id ---
app.patch("/v1/hives/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = await c.req
        .json<{ name?: string; public?: 0 | 1; lat?: number; lon?: number; region?: string }>()
        .catch(() => ({}));

    const owner = await c.env.DB.prepare(`SELECT user_id FROM hives WHERE id = ?`)
        .bind(id)
        .first<{ user_id: string | null }>();
    if (!owner || owner.user_id !== user.id) return c.json({ error: "not found" }, 404);

    await c.env.DB.prepare(
        `UPDATE hives
         SET name   = COALESCE(?, name),
             public = COALESCE(?, public),
             lat    = COALESCE(?, lat),
             lon    = COALESCE(?, lon),
             region = COALESCE(?, region)
         WHERE id = ?`
    )
        .bind(
            body.name ?? null,
            body.public ?? null,
            body.lat ?? null,
            body.lon ?? null,
            body.region ?? null,
            id
        )
        .run();
    return c.json({ ok: true });
});

// --- ADMIN: fleet stats ---
app.get("/v1/admin/fleet/stats", async (c) => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const stats = await c.env.DB.batch([
        c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users`),
        c.env.DB.prepare(`SELECT COUNT(*) AS n FROM hives WHERE user_id IS NOT NULL`),
        c.env.DB.prepare(`SELECT COUNT(*) AS n FROM readings`),
        c.env.DB.prepare(`SELECT COUNT(*) AS n FROM readings WHERE ts >= ?`).bind(since),
        c.env.DB.prepare(`SELECT COUNT(DISTINCT hive_id) AS n FROM readings WHERE ts >= ?`).bind(since),
    ]);
    return c.json({
        users: (stats[0].results?.[0] as any)?.n ?? 0,
        hives: (stats[1].results?.[0] as any)?.n ?? 0,
        readings_total: (stats[2].results?.[0] as any)?.n ?? 0,
        readings_24h: (stats[3].results?.[0] as any)?.n ?? 0,
        hives_active_24h: (stats[4].results?.[0] as any)?.n ?? 0,
    });
});

// --- ADMIN: anonymised fleet hives ---
app.get("/v1/admin/fleet/hives", async (c) => {
    const { results } = await c.env.DB.prepare(
        `SELECT id, created_at, public, lat, lon, region,
                substr(user_id, 1, 8) AS user_prefix
         FROM hives WHERE user_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 5000`
    ).all();
    return c.json({ hives: results });
});

// --- ADMIN: cross-user readings ---
app.get("/v1/admin/fleet/readings", async (c) => {
    const from = Number(c.req.query("from") ?? Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = Number(c.req.query("to") ?? Date.now());
    const region = c.req.query("region");

    const stmt = region
        ? c.env.DB.prepare(
              `SELECT r.hive_id, r.ts, r.weight_kg, r.battery_v, r.temp_c, h.region, h.lat, h.lon
               FROM readings r JOIN hives h ON h.id = r.hive_id
               WHERE h.region = ? AND r.ts BETWEEN ? AND ?
               ORDER BY r.ts ASC LIMIT 50000`
          ).bind(region, from, to)
        : c.env.DB.prepare(
              `SELECT r.hive_id, r.ts, r.weight_kg, r.battery_v, r.temp_c, h.region, h.lat, h.lon
               FROM readings r JOIN hives h ON h.id = r.hive_id
               WHERE r.ts BETWEEN ? AND ?
               ORDER BY r.ts ASC LIMIT 50000`
          ).bind(from, to);
    const { results } = await stmt.all();
    return c.json({ readings: results });
});

app.get("/", (c) => c.text("OpenApiary API. See /v1/*"));

export default app;
