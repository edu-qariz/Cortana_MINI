-- Cortana Mini licence store.
-- Apply with: npm run schema  (remote) or npm run schema:local (wrangler dev)

CREATE TABLE IF NOT EXISTS licences (
    id          TEXT PRIMARY KEY,
    plan        TEXT    NOT NULL DEFAULT 'pilot',
    status      TEXT    NOT NULL DEFAULT 'active',
    device_id   TEXT,
    daily_limit INTEGER NOT NULL DEFAULT 0,
    expires_at  TEXT,
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per licence per UTC day. Rows are kept while daily_limit is 0 (pilot),
-- so enforcement can be switched on later without losing history.
CREATE TABLE IF NOT EXISTS usage_daily (
    licence_id TEXT    NOT NULL,
    day        TEXT    NOT NULL,
    plans      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (licence_id, day)
);

CREATE TABLE IF NOT EXISTS devices (
    licence_id TEXT NOT NULL,
    device_id  TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (licence_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_daily (day);
