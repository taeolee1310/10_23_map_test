-- 제보 표에 칸 4개를 더한다(소인 요금·주차·가기 전 알아둘 것). 이미 만든 DB에 한 번만 실행한다.
--   운영:  node node_modules/wrangler/bin/wrangler.js d1 execute tangbang --remote --file migrate-2026-11-16-report-fields.sql
--   내 PC: 같은 명령에서 --remote 대신 --local
-- 새로 만드는 DB는 schema.sql에 이 칸들이 이미 들어 있어 실행할 필요가 없다. 두 번 실행하면 'duplicate column'으로 멈춘다(자료는 그대로).
ALTER TABLE reports ADD COLUMN child INTEGER;
ALTER TABLE reports ADD COLUMN parking TEXT;
ALTER TABLE reports ADD COLUMN parking_note TEXT;
ALTER TABLE reports ADD COLUMN tips TEXT;
