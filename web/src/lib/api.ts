// 데이터 API(Cloudflare Worker + D1) 주소. 공개 주소라 비밀 값이 아니다(키를 여기에 넣지 않는다).
// 비어 있으면 예전처럼 정적 파일(/data/onsen.json)과 Vercel 제보 함수(/api/report)를 쓴다.
// worker/setup.ps1이 배포한 뒤 이 값을 Worker 주소로 바꾼다. (envPrefix 규칙 때문에 .env가 아니라 여기에 둔다)
export const API_BASE = 'https://tangbang-api.tangbang-api.workers.dev'

const STATIC_URL = '/data/onsen.json' // export_web_data(러스트)가 만든다. API가 안 될 때 대신 쓴다
const API_TIMEOUT = 6000 // API가 이보다 늦으면 정적 파일로 넘어간다
export const LOAD_TIMEOUT = 15000

export const REPORT_URL = API_BASE ? `${API_BASE}/api/report` : '/api/report'

// 목록 데이터 받기: API(공개 스냅샷) → 실패하면 정적 파일. 무료 한도를 넘거나 Worker가 멈춰도 화면은 뜬다
export async function fetchPlaces<T>(init: RequestInit = {}): Promise<T> {
  if (API_BASE) {
    try {
      const r = await fetch(`${API_BASE}/api/places`, { ...init, signal: AbortSignal.timeout(API_TIMEOUT) })
      if (r.ok) return (await r.json()) as T
    } catch {
      /* 아래 정적 파일로 */
    }
  }
  const r = await fetch(STATIC_URL, { ...init, signal: AbortSignal.timeout(LOAD_TIMEOUT) })
  if (!r.ok) throw new Error('data')
  return (await r.json()) as T
}
