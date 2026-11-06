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

-- 공개·되돌리기 기록
CREATE TABLE IF NOT EXISTS publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,         -- publish / rollback
  from_id INTEGER,
  to_id INTEGER,
  summary TEXT
);
