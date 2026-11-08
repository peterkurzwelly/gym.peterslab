-- Sync epoch: a random id for this database's history (sync_meta key 'epoch').
-- Clients send the epoch they last saw. A different epoch means they are talking to a recreated, wiped or restored
-- database: the server pulls from 0 and answers reset: true, and the client pushes every row it holds again.
-- A recreated database runs this migration and gets a fresh epoch. After a manual wipe (DELETE FROM) or a Time Travel
-- restore, rotate it by hand (apps/api/README.md):
--   UPDATE sync_meta SET value = abs(random() % 9007199254740991) WHERE key = 'epoch';
INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('epoch', abs(random() % 9007199254740991));
