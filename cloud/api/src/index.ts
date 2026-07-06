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
//   DELETE /v1/hives/:id/readings        delete all readings for one hive
//   PATCH  /v1/hives/:id                 update name / public / lat / lon / region
//
//   --- admin (X-Admin-Key) ---
//   GET    /v1/admin/fleet/stats         counts + last-24h ingest summary
//   GET    /v1/admin/fleet/hives         all hives across users (anonymised)
//   GET    /v1/admin/fleet/readings      cross-user readings (region/time window)

import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
    DB: D1Database;
    API_KEY: string;          // legacy single-tenant key (kept for back-compat)
    ADMIN_KEY: string;        // separate key for fleet/* admin endpoints
    GITHUB_TOKEN?: string;    // PAT (contents:read) for the PRIVATE firmware repo — secret, never sent to the app
    GITHUB_REPO?: string;     // "owner/repo" that publishes firmware releases (plain var)
    FIRMWARE_PUBLIC_KEY?: string; // Ed25519 public key (32-byte hex) firmware packages must be signed with
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

// Global CORS for all API routes. The app runs inside a Capacitor WebView
// (origin capacitor://localhost / ionic://localhost / http://localhost), so
// cross-origin requests need CORS headers or WKWebView throws "Load failed".
// The X-API-Key / X-Admin-Key header is the security boundary, not the origin.
app.use(
    "/v1/*",
    cors({
        origin: "*",
        allowHeaders: ["Content-Type", "X-API-Key", "X-Admin-Key"],
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        maxAge: 86400,
    })
);

async function sha256Hex(s: string): Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToHex(bytes: Uint8Array): string {
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(nBytes: number): string {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(nBytes)));
}

// PBKDF2-SHA256 password hashing (Workers-native via Web Crypto).
const PBKDF2_ITERS = 100_000;
async function derivePassword(password: string, saltHex: string): Promise<string> {
    const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
        key,
        256
    );
    return bytesToHex(new Uint8Array(bits));
}

async function verifyPassword(password: string, saltHex: string, expectedHex: string): Promise<boolean> {
    const got = await derivePassword(password, saltHex);
    return timingSafeEqual(got, expectedHex);
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
    // Primary key on the user row (legacy + register-issued).
    const row = await db
        .prepare(`SELECT id, email, api_key_hash, created_at, is_admin FROM users WHERE api_key_hash = ?`)
        .bind(hash)
        .first<User>();
    if (row) return row;
    // Per-device key minted at login → resolve to its owning user.
    const viaDevice = await db
        .prepare(
            `SELECT u.id, u.email, u.api_key_hash, u.created_at, u.is_admin
             FROM device_keys d JOIN users u ON u.id = d.user_id
             WHERE d.key_hash = ?`
        )
        .bind(hash)
        .first<User>();
    return viaDevice ?? null;
}

// Mint a fresh API key bound to a user (one per device/login). Returns the raw key.
async function mintDeviceKey(db: D1Database, userId: string, label?: string): Promise<string> {
    const rawKey = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    const hash = await sha256Hex(rawKey);
    await db
        .prepare(`INSERT INTO device_keys (key_hash, user_id, created_at, label) VALUES (?, ?, ?, ?)`)
        .bind(hash, userId, Date.now(), label ?? null)
        .run();
    return rawKey;
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

// --- auth middleware for /v1/* (excluding /v1/admin/* + public account routes) ---
app.use("/v1/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (
        path.startsWith("/v1/admin/") ||
        path === "/v1/account/register" ||
        path === "/v1/account/login"
    ) {
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
    // CORS for the fleet dashboard (any origin — the key/credential is the
    // security boundary, not the origin).
    if (c.req.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "X-Admin-Key, X-API-Key, Content-Type",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Max-Age": "86400",
            },
        });
    }

    // Primary auth: a normal user key (X-API-Key) belonging to an admin user.
    // The admin signs in with the SAME email/password as the app; their account
    // just has is_admin = 1. Fallback: the legacy shared ADMIN_KEY (bootstrap).
    let admin: User | null = null;
    const userKey = c.req.header("X-API-Key") ?? "";
    if (userKey) {
        const u = await findUserByKey(c.env.DB, userKey);
        if (u && u.is_admin) admin = u;
    }
    const adminKey = c.req.header("X-Admin-Key") ?? "";
    const legacyOk = c.env.ADMIN_KEY && timingSafeEqual(adminKey, c.env.ADMIN_KEY);

    if (!admin && !legacyOk) {
        return c.json({ error: "unauthorized" }, 401, {
            "Access-Control-Allow-Origin": "*",
        });
    }
    if (admin) c.set("user", admin);
    await next();
    c.res.headers.set("Access-Control-Allow-Origin", "*");
});

// ---------------------------------------------------------------------------
// Firmware distribution (OTA)
//
// The firmware binary lives on a PRIVATE GitHub release. The Worker holds the
// access token (GITHUB_TOKEN secret) so the app never sees a credential and
// never talks to GitHub directly — it only ever calls these Worker endpoints
// with its normal X-API-Key. This keeps the whole OTA path inside the existing
// Cloudflare + private-GitHub architecture (no Microsoft Azure resources).
//
//   GET /v1/firmware/latest            metadata + signed manifest + download URLs
//   GET /v1/firmware/download?asset=…  streams the DFU .zip (asset=dfu) or .uf2 (asset=uf2)
//
// Both require a valid X-API-Key (enforced by the /v1/* auth middleware above).
// ---------------------------------------------------------------------------
type GhAsset = { name: string; size: number; url: string };
type GhRelease = { tag_name: string; name: string; body: string; assets: GhAsset[] };

async function ghLatestRelease(env: Bindings): Promise<GhRelease | null> {
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return null;
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases/latest`, {
        headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "openapiary-worker",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!r.ok) return null;
    return r.json<GhRelease>();
}

// Fetch a release asset's raw bytes. GitHub 302-redirects private assets to a
// pre-signed URL that must be hit WITHOUT the Authorization header (else it
// rejects with "only one auth mechanism allowed"), so follow the redirect
// manually and drop the header on the second hop.
async function ghFetchAsset(env: Bindings, asset: GhAsset): Promise<Response> {
    const r = await fetch(asset.url, {
        headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/octet-stream",
            "User-Agent": "openapiary-worker",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "manual",
    });
    if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (loc) return fetch(loc); // pre-signed URL — no auth header
    }
    return r;
}

type FwManifest = {
    version?: string;
    zip?: { name: string; size: number; sha256: string; sig: string };
    uf2?: { name: string; size: number; sha256: string };
};

async function fwManifest(env: Bindings, rel: GhRelease): Promise<FwManifest | null> {
    const man = rel.assets.find((a) => a.name === "manifest.json");
    if (!man) return null;
    return ghFetchAsset(env, man)
        .then((r) => (r.ok ? r.json<FwManifest>() : null))
        .catch(() => null);
}

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.trim().toLowerCase();
    const out = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64.trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// Authenticity gate: the firmware .zip must match the manifest sha256 AND carry
// a valid Ed25519 signature from the pinned key. The key lives here on our infra,
// so a compromised GitHub/CDN can't get a malicious image past this check.
async function verifyFirmware(env: Bindings, zip: Uint8Array, manifest: FwManifest | null): Promise<string | null> {
    if (!manifest?.zip?.sha256 || !manifest.zip.sig) return "unsigned firmware manifest";
    if (!env.FIRMWARE_PUBLIC_KEY) return "no firmware public key configured";

    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", zip));
    const gotSha = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (gotSha !== manifest.zip.sha256.trim().toLowerCase()) return "sha256 mismatch";

    try {
        const key = await crypto.subtle.importKey(
            "raw",
            hexToBytes(env.FIRMWARE_PUBLIC_KEY),
            { name: "Ed25519" },
            false,
            ["verify"]
        );
        const ok = await crypto.subtle.verify("Ed25519", key, b64ToBytes(manifest.zip.sig), zip);
        return ok ? null : "invalid signature";
    } catch {
        return "signature verification error";
    }
}

app.get("/v1/firmware/latest", async (c) => {
    if (!c.env.GITHUB_TOKEN || !c.env.GITHUB_REPO)
        return c.json({ error: "firmware source not configured" }, 503);
    const rel = await ghLatestRelease(c.env);
    if (!rel) return c.json({ error: "no firmware published yet" }, 404);

    // The manifest (produced by the signing pipeline) carries the sha256 + the
    // detached Ed25519 signature. It's small, so fetching it on the metadata
    // call is cheap. The Worker also enforces the signature at /download.
    const manifest = await fwManifest(c.env, rel);

    const origin = new URL(c.req.url).origin;
    const zip = rel.assets.find((a) => a.name.endsWith(".zip"));
    const uf2 = rel.assets.find((a) => a.name.endsWith(".uf2"));
    return c.json(
        {
            version: rel.tag_name,
            notes: rel.body ?? "",
            zip: zip ? { name: zip.name, size: zip.size, downloadUrl: `${origin}/v1/firmware/download?asset=dfu` } : null,
            uf2: uf2 ? { name: uf2.name, size: uf2.size, downloadUrl: `${origin}/v1/firmware/download?asset=uf2` } : null,
            manifest,
        },
        200,
        { "Cache-Control": "public, max-age=300" }
    );
});

app.get("/v1/firmware/download", async (c) => {
    const which = c.req.query("asset") === "uf2" ? "uf2" : "dfu";
    if (!c.env.GITHUB_TOKEN || !c.env.GITHUB_REPO)
        return c.json({ error: "firmware source not configured" }, 503);
    const rel = await ghLatestRelease(c.env);
    if (!rel) return c.json({ error: "no firmware published yet" }, 404);

    const asset =
        which === "uf2"
            ? rel.assets.find((a) => a.name.endsWith(".uf2"))
            : rel.assets.find((a) => a.name.endsWith(".zip"));
    if (!asset) return c.json({ error: "asset not found" }, 404);

    const upstream = await ghFetchAsset(c.env, asset);
    if (!upstream.ok) return c.json({ error: "upstream fetch failed" }, 502);
    const bytes = new Uint8Array(await upstream.arrayBuffer());

    // Enforce authenticity for the DFU image before it ever reaches a scale.
    // (The .uf2 is a manual USB recovery artifact, flashed via the bootloader's
    // own signature check, so it isn't gated here.)
    if (which === "dfu") {
        const reason = await verifyFirmware(c.env, bytes, await fwManifest(c.env, rel));
        if (reason) return c.json({ error: `firmware rejected: ${reason}` }, 409);
    }

    return new Response(bytes, {
        status: 200,
        headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${asset.name}"`,
            "Cache-Control": "public, max-age=300",
        },
    });
});

// --- POST /v1/account/register ---
//   - email + password  → a full account that can log in from any device.
//   - neither           → an anonymous "try it" account (can be upgraded later).
app.post("/v1/account/register", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}));
    const email = body.email?.trim().toLowerCase() || null;
    const password = body.password ?? "";

    if (email && password.length < 8) {
        return c.json({ error: "password must be at least 8 characters" }, 400);
    }

    const id = newId();
    const rawKey = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    const hash = await sha256Hex(rawKey);

    let passwordHash: string | null = null;
    let passwordSalt: string | null = null;
    if (email && password) {
        passwordSalt = randomHex(16);
        passwordHash = await derivePassword(password, passwordSalt);
    }

    try {
        await c.env.DB.prepare(
            `INSERT INTO users (id, email, api_key_hash, password_hash, password_salt, created_at, is_admin)
             VALUES (?, ?, ?, ?, ?, ?, 0)`
        )
            .bind(id, email, hash, passwordHash, passwordSalt, Date.now())
            .run();
    } catch (e: any) {
        if (String(e?.message).includes("UNIQUE")) {
            return c.json({ error: "email already registered" }, 409);
        }
        throw e;
    }
    return c.json({ user_id: id, api_key: rawKey, email });
});

// --- POST /v1/account/login ---
// Body: { email, password }. Verifies credentials, mints a fresh per-device key.
app.post("/v1/account/login", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string; device?: string }>().catch(() => ({}));
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || !password) return c.json({ error: "email and password required" }, 400);

    const user = await c.env.DB.prepare(
        `SELECT id, password_hash, password_salt FROM users WHERE email = ?`
    )
        .bind(email)
        .first<{ id: string; password_hash: string | null; password_salt: string | null }>();

    if (!user || !user.password_hash || !user.password_salt) {
        return c.json({ error: "invalid email or password" }, 401);
    }
    const ok = await verifyPassword(password, user.password_salt, user.password_hash);
    if (!ok) return c.json({ error: "invalid email or password" }, 401);

    const rawKey = await mintDeviceKey(c.env.DB, user.id, body.device);
    return c.json({ user_id: user.id, api_key: rawKey, email });
});

// --- POST /v1/account/upgrade — add email+password to the current (anonymous) account ---
app.post("/v1/account/upgrade", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}));
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || password.length < 8) {
        return c.json({ error: "email and an 8+ character password required" }, 400);
    }
    const salt = randomHex(16);
    const hash = await derivePassword(password, salt);
    try {
        await c.env.DB.prepare(
            `UPDATE users SET email = ?, password_hash = ?, password_salt = ? WHERE id = ?`
        )
            .bind(email, hash, salt, user.id)
            .run();
    } catch (e: any) {
        if (String(e?.message).includes("UNIQUE")) {
            return c.json({ error: "email already registered" }, 409);
        }
        throw e;
    }
    return c.json({ ok: true, email });
});

// --- GET /v1/me — identity of the caller (regular user key) ---
app.get("/v1/me", async (c) => {
    const user = c.get("user");
    return c.json({
        id: user.id,
        email: user.email,
        is_admin: !!user.is_admin,
    });
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

// --- DELETE /v1/hives/:id/readings ---
app.delete("/v1/hives/:id/readings", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    const owner = await c.env.DB.prepare(`SELECT user_id FROM hives WHERE id = ?`)
        .bind(id)
        .first<{ user_id: string | null }>();
    if (!owner || owner.user_id !== user.id) return c.json({ error: "not found" }, 404);

    const result = await c.env.DB.prepare(`DELETE FROM readings WHERE hive_id = ?`).bind(id).run();
    return c.json({ ok: true, deleted: result.meta.changes ?? 0 });
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
    const userId = c.req.query("user");

    if (userId) {
        const stats = await c.env.DB.batch([
            c.env.DB.prepare(`SELECT COUNT(*) AS n FROM hives WHERE user_id = ?`).bind(userId),
            c.env.DB.prepare(
                `SELECT COUNT(*) AS n FROM readings r JOIN hives h ON h.id = r.hive_id WHERE h.user_id = ?`
            ).bind(userId),
            c.env.DB.prepare(
                `SELECT COUNT(*) AS n FROM readings r JOIN hives h ON h.id = r.hive_id WHERE h.user_id = ? AND r.ts >= ?`
            ).bind(userId, since),
            c.env.DB.prepare(
                `SELECT COUNT(DISTINCT r.hive_id) AS n FROM readings r JOIN hives h ON h.id = r.hive_id WHERE h.user_id = ? AND r.ts >= ?`
            ).bind(userId, since),
        ]);
        return c.json({
            users: 1,
            hives: (stats[0].results?.[0] as any)?.n ?? 0,
            readings_total: (stats[1].results?.[0] as any)?.n ?? 0,
            readings_24h: (stats[2].results?.[0] as any)?.n ?? 0,
            hives_active_24h: (stats[3].results?.[0] as any)?.n ?? 0,
        });
    }

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

// --- ADMIN: whoami — confirms the admin key + a label for the header ---
app.get("/v1/admin/whoami", async (c) => {
    const admin = c.get("user");
    return c.json({
        is_admin: true,
        label: admin?.email ?? "Admin",
        email: admin?.email ?? null,
        scope: "fleet",
    });
});

// --- ADMIN: list users (for the persona switcher) ---
app.get("/v1/admin/users", async (c) => {
    const { results } = await c.env.DB.prepare(
        `SELECT u.id, u.email, u.created_at, u.is_admin,
                COUNT(h.id) AS hive_count
         FROM users u
         LEFT JOIN hives h ON h.user_id = u.id
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT 5000`
    ).all();
    return c.json({ users: results });
});

// --- ADMIN: force-reset a user's password ---
// Body: { password? }. If omitted, a random temporary password is generated and
// returned once so the admin can hand it to the user. Also revokes the user's
// existing device keys so old sessions can't continue.
app.post("/v1/admin/users/:id/reset-password", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ password?: string }>().catch(() => ({}));
    let password = (body.password ?? "").trim();
    let generated: string | null = null;
    if (!password) {
        generated = "OA-" + randomHex(5);   // 10 hex chars, human-typable
        password = generated;
    }
    if (password.length < 8) {
        return c.json({ error: "password must be at least 8 characters" }, 400, { "Access-Control-Allow-Origin": "*" });
    }
    const u = await c.env.DB.prepare(`SELECT id, email FROM users WHERE id = ?`).bind(id)
        .first<{ id: string; email: string | null }>();
    if (!u) return c.json({ error: "user not found" }, 404, { "Access-Control-Allow-Origin": "*" });

    const salt = randomHex(16);
    const hash = await derivePassword(password, salt);
    await c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`)
        .bind(hash, salt, id).run();
    // Revoke all device keys so the old password's sessions can't continue.
    await c.env.DB.prepare(`DELETE FROM device_keys WHERE user_id = ?`).bind(id).run();

    return c.json({ ok: true, email: u.email, temporary_password: generated }, 200, { "Access-Control-Allow-Origin": "*" });
});

// --- ADMIN: grant / revoke admin on a user ---
app.post("/v1/admin/users/:id/set-admin", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ is_admin?: boolean }>().catch(() => ({}));
    const flag = body.is_admin ? 1 : 0;
    await c.env.DB.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).bind(flag, id).run();
    return c.json({ ok: true, is_admin: !!flag }, 200, { "Access-Control-Allow-Origin": "*" });
});

// --- ADMIN: anonymised fleet hives ---
app.get("/v1/admin/fleet/hives", async (c) => {
    const userId = c.req.query("user");
    const stmt = userId
        ? c.env.DB.prepare(
              `SELECT id, created_at, public, lat, lon, region,
                      substr(user_id, 1, 8) AS user_prefix
               FROM hives WHERE user_id = ?
               ORDER BY created_at DESC LIMIT 5000`
          ).bind(userId)
        : c.env.DB.prepare(
              `SELECT id, created_at, public, lat, lon, region,
                      substr(user_id, 1, 8) AS user_prefix
               FROM hives WHERE user_id IS NOT NULL
               ORDER BY created_at DESC LIMIT 5000`
          );
    const { results } = await stmt.all();
    return c.json({ hives: results });
});

// --- ADMIN: cross-user readings ---
app.get("/v1/admin/fleet/readings", async (c) => {
    const from = Number(c.req.query("from") ?? Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = Number(c.req.query("to") ?? Date.now());
    const region = c.req.query("region");
    const userId = c.req.query("user");

    let stmt;
    if (userId) {
        stmt = c.env.DB.prepare(
            `SELECT r.hive_id, r.ts, r.weight_kg, r.battery_v, r.temp_c, h.region, h.lat, h.lon
             FROM readings r JOIN hives h ON h.id = r.hive_id
             WHERE h.user_id = ? AND r.ts BETWEEN ? AND ?
             ORDER BY r.ts ASC LIMIT 50000`
        ).bind(userId, from, to);
    } else if (region) {
        stmt = c.env.DB.prepare(
            `SELECT r.hive_id, r.ts, r.weight_kg, r.battery_v, r.temp_c, h.region, h.lat, h.lon
             FROM readings r JOIN hives h ON h.id = r.hive_id
             WHERE h.region = ? AND r.ts BETWEEN ? AND ?
             ORDER BY r.ts ASC LIMIT 50000`
        ).bind(region, from, to);
    } else {
        stmt = c.env.DB.prepare(
            `SELECT r.hive_id, r.ts, r.weight_kg, r.battery_v, r.temp_c, h.region, h.lat, h.lon
             FROM readings r JOIN hives h ON h.id = r.hive_id
             WHERE r.ts BETWEEN ? AND ?
             ORDER BY r.ts ASC LIMIT 50000`
        ).bind(from, to);
    }
    const { results } = await stmt.all();
    return c.json({ readings: results });
});

app.get("/", (c) => c.text("OpenApiary API. See /v1/*"));

export default app;
