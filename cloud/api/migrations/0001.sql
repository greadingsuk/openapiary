-- OpenApiary D1 schema (Phase 1). See docs/migration-plan.md §6.3.

CREATE TABLE IF NOT EXISTS hives (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    owner_key_id TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    public       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS readings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    hive_id    TEXT NOT NULL REFERENCES hives(id) ON DELETE CASCADE,
    ts         INTEGER NOT NULL,
    weight_kg  REAL NOT NULL,
    battery_v  REAL NOT NULL,
    temp_c     REAL,
    rssi       INTEGER,
    packet_id  INTEGER NOT NULL,
    UNIQUE (hive_id, packet_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_readings_hive_ts ON readings(hive_id, ts);
