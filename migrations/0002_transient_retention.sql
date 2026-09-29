-- Add a retrieval timestamp so lyrics can be purged on a retention schedule.
--
-- The previous build had no TTL once the body moved into D1, which meant lyrics
-- accumulated indefinitely. fetched_at is set on every store and read by the
-- daily purge, so stored lyrics stay transient like they were when the body
-- lived in a KV key with a 24h expiration.
--
-- Existing rows get a full retention window from deploy time rather than being
-- purged on the first cron run, because they were fetched recently enough.

ALTER TABLE tracks ADD COLUMN fetched_at INTEGER;

UPDATE tracks SET fetched_at = (strftime('%s', 'now') * 1000) WHERE fetched_at IS NULL;
