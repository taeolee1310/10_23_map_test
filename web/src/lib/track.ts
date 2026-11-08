// 핵심 행동 세기: 어디서 막히는지 보려고 정해진 8가지만 센다. Worker `POST /api/event`(worker/src/index.js `EVENTS`)와 이름이 같아야 한다.
// 보내는 것은 행동 이름뿐이다. 어떤 목욕탕인지·내 위치·입력한 글은 보내지 않는다. 방문자는 서버가 (접속 주소+브라우저+날짜) 해시로만 구분한다.
// 브라우저의 '추적 안 함'(Do Not Track)이 켜져 있으면 보내지 않는다. 보내기에 실패해도 화면에는 아무 영향이 없다.
import { API_BASE } from './api'

export type TrackName = 'near' | 'sort_auto' | 'sort_dist' | 'sort_name' | 'detail' | 'fav' | 'report_open' | 'report_done'

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
