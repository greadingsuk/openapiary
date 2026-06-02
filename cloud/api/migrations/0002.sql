-- OpenApiary D1 schema — multi-user support.
-- Adds users table, scopes hives by user, adds optional geo for regional analytics.

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,            -- uuid
    email         TEXT UNIQUE,                  -- nullable for anonymous demo keys
    api_key_hash  TEXT NOT NULL UNIQUE,         -- sha256(api_key) hex
    created_at    INTEGER NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash);

-- Add user scoping + optional location to hives.
-- D1 supports ALTER TABLE ADD COLUMN.
ALTER TABLE hives ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE hives ADD COLUMN lat REAL;
ALTER TABLE hives ADD COLUMN lon REAL;
ALTER TABLE hives ADD COLUMN region TEXT;       -- optional human label e.g. "Yorkshire Dales"

CREATE INDEX IF NOT EXISTS idx_hives_user_id ON hives(user_id);

-- Backfill any existing rows (single-tenant era) to a placeholder user we'll create at runtime.
-- Worker will lazily migrate `owner_key_id='default'` rows to the user matching the legacy API_KEY.
