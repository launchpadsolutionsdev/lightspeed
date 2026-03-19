-- Velocity snapshots table for persistent Heartbeat data collection.
-- Replaces the ephemeral JSON file (velocity-snapshots.json) so that
-- snapshot history survives server restarts, redeploys, and disk wipes.

CREATE TABLE IF NOT EXISTS velocity_snapshots (
    id          BIGSERIAL PRIMARY KEY,
    ts          BIGINT NOT NULL,              -- Unix epoch milliseconds
    total_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_tickets INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient range queries (e.g. last 24h, last 7d)
CREATE INDEX IF NOT EXISTS idx_velocity_snapshots_ts ON velocity_snapshots (ts DESC);
