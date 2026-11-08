-- 탕방 데이터 DB(Cloudflare D1). 설계서: "탕방 데이터 서비스 전환 설계서"(2026-11-06)
-- 초안 = places 표의 현재 내용. 공개본 = snapshots 표의 활성 스냅샷 한 줄(meta.active_snapshot).
-- 사람이 확인한 값(data/curated/)은 지금처럼 러스트 export_web_data가 합친 뒤 올린다(DB에 따로 두지 않는다).

-- 곳별 초안: onsen.json의 places 한 항목을 그대로(JSON 글자) 둔다
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,          -- 카카오ID 등(onsen.json의 id)
  ord INTEGER NOT NULL,         -- onsen.json 안의 순서(공개본도 같은 순서로 만든다)
  body TEXT NOT NULL,           -- 그 곳의 JSON
  updated_at TEXT NOT NULL
);

-- 공개한 전체 JSON(사용자가 받는 것). 되돌리기를 위해 최근 30개를 둔다
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,
  place_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT
);

-- 키-값: active_snapshot(공개 중인 스냅샷 id), draft_base_date(초안의 데이터 기준일)
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- 사용자 제보. 화면에 바로 반영하지 않는다(사람이 확인한 뒤 data/curated/에 넣는다)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  place_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  adult INTEGER,
  towel INTEGER,
  scrub INTEGER,
  source TEXT,
  memo TEXT,
  towel_info TEXT,
  hairdryer TEXT,
  seshin_pay TEXT,
  flags TEXT,
  who TEXT NOT NULL,            -- 기기 ID(없으면 접속 주소)를 해시한 값. 원래 값은 저장하지 않는다
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',   -- new / reviewed / applied / rejected
  reviewed_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS reports_who ON reports (who, created_at);
CREATE INDEX IF NOT EXISTS reports_ip ON reports (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, id);

-- 하루 방문자 수(DAU). 사람마다 (접속 주소 + 브라우저 종류 + 그날 날짜)를 비밀 값과 섞은 해시 하나만 남긴다.
-- 날짜가 섞여 있어 다른 날과 이어 붙일 수 없고, 원래 주소는 저장하지 않는다. 90일이 지나면 지운다.
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,            -- 한국 날짜 YYYY-MM-DD
  v TEXT NOT NULL,              -- 방문자 해시
  n INTEGER NOT NULL DEFAULT 1, -- 그날 목록을 받은 횟수
  PRIMARY KEY (day, v)
) WITHOUT ROWID;

-- 화면에서 일어난 핵심 행동 횟수(어디서 막히는지 보려는 것). 이름은 Worker가 정한 목록(EVENTS)만 받는다.
-- 방문자 해시는 visits와 같은 방식(날짜가 섞여 다른 날과 이어 붙일 수 없음). 어떤 목욕탕을 눌렀는지·위치·입력한 글은 저장하지 않는다. 90일 뒤 지운다.
CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,            -- 한국 날짜
  name TEXT NOT NULL,           -- near · sort_auto · sort_dist · sort_name · detail · fav · report_open · report_done
  v TEXT NOT NULL,              -- 방문자 해시
  n INTEGER NOT NULL DEFAULT 1, -- 그날 그 사람이 한 횟수(200에서 멈춤)
  PRIMARY KEY (day, name, v)
) WITHOUT ROWID;

-- 매거진 글. 운영자가 서비스의 숨은 작성 화면(/magazine/write, 편집 토큰 필요)에서 쓰고 '공개'를 눌러야 사용자에게 보인다.
-- 본문은 글자만 저장한다(빈 줄 = 문단, '> ' = 인용, '![설명](https://주소)' = 사진). HTML은 받지 않는다.
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,        -- 주소에 쓰는 이름(/magazine/<slug>), 영문 소문자·숫자·-
  title TEXT NOT NULL,
  category TEXT NOT NULL,           -- unknown(몰랐던 이야기) · tips(도움이 되는 정보) · special(특별한 목욕탕) · people(사람들의 사연)
  summary TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',   -- 대표 사진 주소(https만)
  body TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '탕방 편집부',
  place_ids TEXT NOT NULL DEFAULT '[]', -- 글에 나온 목욕탕 id 목록(JSON). 그 목욕탕 상세 화면에 '이 목욕탕 이야기'로 나온다
  status TEXT NOT NULL DEFAULT 'draft', -- draft(임시 저장) · published(공개) · hidden(내림)
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stories_pub ON stories (status, published_at);

-- 작성 화면 암호를 틀린 횟수. k = 'ip:'+해시(접속 주소, 원래 주소는 저장 안 함) 또는 'all'(전체).
-- 같은 곳에서 15분 안에 5번 틀리면 15분, 전체에서 1시간 안에 30번 틀리면 1시간 동안 맞는 암호도 받지 않는다.
CREATE TABLE IF NOT EXISTS auth_fails (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,           -- 이번 구간에서 틀린 횟수
  first_at INTEGER NOT NULL,    -- 구간 시작(ms)
  locked_until INTEGER NOT NULL DEFAULT 0 -- 이 시각(ms)까지 잠금
) WITHOUT ROWID;

-- 공개·되돌리기 기록
CREATE TABLE IF NOT EXISTS publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,         -- publish / rollback
  from_id INTEGER,
  to_id INTEGER,
  summary TEXT
);
