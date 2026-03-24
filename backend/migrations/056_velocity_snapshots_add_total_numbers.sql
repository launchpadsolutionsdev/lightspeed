-- Add total_numbers column to velocity_snapshots so we can track
-- raffle numbers sold (draw pool size) alongside ticket counts.
-- Numbers ≠ tickets: a single ticket can contain many numbers
-- (e.g. $20 ticket = 50 numbers, $100 ticket = 700 numbers).

ALTER TABLE velocity_snapshots
    ADD COLUMN IF NOT EXISTS total_numbers INTEGER NOT NULL DEFAULT 0;
