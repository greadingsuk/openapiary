-- OpenApiary D1 schema — persist apiary grouping in the cloud.
-- The app previously stored apiary names + hive assignments only in device
-- Preferences, so they were lost on reinstall. Store the apiary name on the
-- hive so it survives across devices/reinstalls (the hive's region/lat/lon
-- already carry the apiary location).
ALTER TABLE hives ADD COLUMN apiary TEXT;
