// OpenApiary Worker — Phase 1 stub.
// Endpoints per docs/migration-plan.md §6.2:
//   POST   /v1/readings          bulk-insert from app
//   GET    /v1/hives             list hives owned by this API key
//   GET    /v1/hives/:id/readings?from=&to=
//   PATCH  /v1/hives/:id         update name / public flag
//
// Auth: X-API-Key header, constant-time compared against the API_KEY secret.

import { Hono } from "hono";

type Bindings = {
    DB: D1Database;
    API_KEY: string;
};

type Reading = {
    ts: number;
    weightKg: number;
    batteryV: number;
    tempC?: number;
    packetId: number;
    rssi?: number;
};

const app = new Hono<{ Bindings: Bindings }>();

// --- Auth middleware ---
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

app.use("/v1/*", async (c, next) => {
    const provided = c.req.header("X-API-Key") ?? "";
    if (!c.env.API_KEY || !timingSafeEqual(provided, c.env.API_KEY)) {
        return c.json({ error: "unauthorized" }, 401);
    }
    await next();
});

// --- POST /v1/readings ---
app.post("/v1/readings", async (c) => {
    const body = await c.req.json<{
        hiveId: string;
        deviceName?: string;
        readings: Reading[];
    }>();

    if (!body?.hiveId || !Array.isArray(body.readings)) {
        return c.json({ error: "bad request" }, 400);
    }

    // Upsert hive row (owner_key_id is a placeholder until multi-key auth lands)
    await c.env.DB.prepare(
        `INSERT INTO hives (id, name, owner_key_id, created_at, public)
         VALUES (?, ?, 'default', ?, 0)
         ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, hives.name)`
    )
        .bind(body.hiveId, body.deviceName ?? body.hiveId, Date.now())
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
    const { results } = await c.env.DB.prepare(
        `SELECT id, name, created_at, public FROM hives ORDER BY created_at DESC`
    ).all();
    return c.json({ hives: results });
});

// --- GET /v1/hives/:id/readings ---
app.get("/v1/hives/:id/readings", async (c) => {
    const id = c.req.param("id");
    const from = Number(c.req.query("from") ?? 0);
    const to = Number(c.req.query("to") ?? Date.now());
    const { results } = await c.env.DB.prepare(
        `SELECT ts, weight_kg, battery_v, temp_c, rssi, packet_id
         FROM readings
         WHERE hive_id = ? AND ts BETWEEN ? AND ?
         ORDER BY ts ASC
         LIMIT 10000`
    )
        .bind(id, from, to)
        .all();
    return c.json({ readings: results });
});

// --- PATCH /v1/hives/:id ---
app.patch("/v1/hives/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string; public?: 0 | 1 }>();
    await c.env.DB.prepare(
        `UPDATE hives
         SET name   = COALESCE(?, name),
             public = COALESCE(?, public)
         WHERE id = ?`
    )
        .bind(body.name ?? null, body.public ?? null, id)
        .run();
    return c.json({ ok: true });
});

app.get("/", (c) => c.text("OpenApiary API. See /v1/*"));

export default app;
