-- OpenApiary D1 schema — email/password accounts + multi-device keys.
-- Enables a "produced" auth experience: register or log in with email+password,
-- and use the same account (same hives) across multiple devices.

-- Password credentials on users (nullable: anonymous "try it" accounts have none).
ALTER TABLE users ADD COLUMN password_hash TEXT;   -- PBKDF2-SHA256 derived key, hex
ALTER TABLE users ADD COLUMN password_salt TEXT;    -- per-user random salt, hex

-- Each device gets its own API key that maps back to one user. Logging in on a
-- new device mints a fresh device key; revoking a device deletes one row without
-- affecting the others. All keys for a user resolve to the same user_id → same hives.
CREATE TABLE IF NOT EXISTS device_keys (
    key_hash    TEXT PRIMARY KEY,                 -- sha256(api_key) hex
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    label       TEXT                              -- optional device name
);

CREATE INDEX IF NOT EXISTS idx_device_keys_user_id ON device_keys(user_id);
