-- Verbose diagnostic logging, opt-in from the app (Settings > Verbose logging).
-- Lets us read what a beekeeper's app actually did (BLE scans/connects, sync
-- results) without needing them to reproduce an issue in front of us.
CREATE TABLE IF NOT EXISTS device_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  hive_id TEXT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT,
  app_version TEXT,
  platform TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_logs_user ON device_logs(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_device_logs_hive ON device_logs(hive_id, ts);
