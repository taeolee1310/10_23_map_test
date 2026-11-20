-- 사람마다 다른 관리 열쇠와 '누가 했는지' 기록(2026-11-20). 이미 만든 DB에 한 번만 실행한다.
--   운영:  cd worker && node node_modules/wrangler/bin/wrangler.js d1 execute tangbang --remote --file migrate-2026-11-20-admins.sql
-- 새로 만드는 DB는 schema.sql에 이미 들어 있다. 두 번 실행하면 'duplicate column'으로 멈춘다(자료는 그대로).
CREATE TABLE IF NOT EXISTS admins (
  name TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used TEXT
);
ALTER TABLE reports ADD COLUMN reviewed_by TEXT;
ALTER TABLE publish_log ADD COLUMN by TEXT;
