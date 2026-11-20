// 핵심 행동 세기: 어디서 막히는지 보려고 정해진 11가지만 센다(매거진 열기·글 끝까지 읽기 포함). Worker `POST /api/event`(worker/src/index.js `EVENTS`)와 이름이 같아야 한다.
// 보내는 것은 행동 이름뿐이다. 어떤 목욕탕인지·내 위치·입력한 글은 보내지 않는다. 방문자는 서버가 (접속 주소+브라우저+날짜) 해시로만 구분한다.
// 브라우저의 '추적 안 함'(Do Not Track)이 켜져 있으면 보내지 않는다. 보내기에 실패해도 화면에는 아무 영향이 없다.
import { API_BASE } from './api'

export type TrackName = 'near' | 'sort_auto' | 'sort_pop' | 'sort_dist' | 'sort_name' | 'detail' | 'fav' | 'report_open' | 'report_done' | 'magazine_open' | 'story_read'

export function track(name: TrackName) {
  try {
    if (!API_BASE || navigator.doNotTrack === '1') return
    // text/plain으로 보내면 브라우저가 사전 확인(preflight) 없이 바로 보낸다. 본문은 JSON 글자.
    // keepalive: 화면을 닫거나 이동하는 중에도 요청이 끝까지 간다(쿠키는 보내지 않는다)
    fetch(`${API_BASE}/api/event`, { method: 'POST', body: JSON.stringify({ name }), headers: { 'Content-Type': 'text/plain' }, keepalive: true }).catch(() => {})
  } catch {
    /* 세기는 실패해도 괜찮다 */
  }
}

// 인기순용 목욕탕별 행동(Worker POST /api/place-event). 이것만은 어느 목욕탕인지 보낸다(목욕탕 id와 행동 이름뿐, 위치·입력한 글은 보내지 않음).
// 같은 사람·같은 곳·같은 행동은 서버가 하루 한 번만 센다. '추적 안 함'이 켜져 있으면 보내지 않는다.
export type PlaceKind = 'view' | 'fav' | 'like' | 'unlike'

export function trackPlace(id: string, kind: PlaceKind) {
  try {
    if (!API_BASE || navigator.doNotTrack === '1') return
    fetch(`${API_BASE}/api/place-event`, { method: 'POST', body: JSON.stringify({ id, kind }), headers: { 'Content-Type': 'text/plain' }, keepalive: true }).catch(() => {})
  } catch {
    /* 세기는 실패해도 괜찮다 */
  }
}
