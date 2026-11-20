-- 인기순(2026-11-20): 목욕탕별 행동 기록 표. 운영 DB에 한 번만 실행한다.
-- 인기순: 목욕탕별 상세 보기(view)·담기(fav)·추천해요(like)·추천 취소(unlike, 예전 날 누른 것을 뺄 때).
-- 같은 사람·같은 곳·같은 행동은 하루 한 줄. 방문자 해시는 visits와 같은 방식(날짜가 섞여 다른 날과 이어 붙일 수 없음).
-- 위치·입력한 글은 저장하지 않는다. 점수는 최근 30일만 쓰고, 90일이 지나면 지운다(/admin/stats).
CREATE TABLE IF NOT EXISTS place_events (
  day TEXT NOT NULL,            -- 한국 날짜
  place_id TEXT NOT NULL,       -- 목욕탕 id(places.id)
  kind TEXT NOT NULL,           -- view · fav · like · unlike
  v TEXT NOT NULL,              -- 방문자 해시
  PRIMARY KEY (day, place_id, kind, v)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS place_events_v ON place_events (day, v);
