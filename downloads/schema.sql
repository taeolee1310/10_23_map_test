-- 탕방 도구함(downloads Worker)이 쓰는 표. tangbang D1에 함께 둔다. 처음 한 번 실행:
--   cd worker && node node_modules/wrangler/bin/wrangler.js d1 execute tangbang --remote --file ../downloads/schema.sql
-- 비밀번호 틀린 횟수(접속 주소 해시별 + 전체). 잠긴 동안은 맞는 비밀번호도 받지 않는다
CREATE TABLE IF NOT EXISTS dl_fails (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
-- 받은 기록: 하루·이름·프로그램·버전·파일마다 횟수 하나(줄 수가 늘지 않게 합친다)
CREATE TABLE IF NOT EXISTS dl_log (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  app TEXT NOT NULL,
  version TEXT NOT NULL,
  file TEXT NOT NULL,
  via TEXT NOT NULL,             -- page(사이트에서 받음) / update(앱이 스스로 업데이트)
  n INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, name, app, version, file, via)
);
