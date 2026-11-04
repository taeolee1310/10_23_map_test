// '수집 시작'의 예상 시간. 숫자는 여기서만 계산하고, 화면에는 무엇을 기준으로 셌는지 같이 보여 준다.
//
// 시작 전:  받을 페이지 n(한 번에 150 상한) × 곳당 초  +  묶음마다 붙는 준비 시간  +  정리 시간
//   - 곳당 초: 이 PC의 최근 수집 기록(최대 5번)의 평균. 기록이 없으면 기본 14초(간격 10초 + 페이지 열고 기다리기 약 4초)
//   - 묶음 준비: ego_fetch.mjs가 25곳씩 나눠 받는다. Claude와 함께면 묶음마다 Claude가 명령을 다시 내리는 시간(기본 20초), 직접이면 3초
//   - 정리(목록 만들기·읽기·판정·합치기·화면 데이터): 최근 '수집 시작' 기록의 가운데 값. 없으면 기본 40초
// 받는 중:  남은 곳 × 지금까지의 실제 곳당 초(2곳 이상 받은 뒤부터)  +  남은 묶음 준비  +  정리 시간
// 정리 중:  정리 시간 × 남은 단계 비율

export const MAX_PAGES = 150
export const BATCH = 25
export const DEFAULT_PAGE_SEC = 14
export const DEFAULT_PROC_SEC = 40
const BATCH_OVERHEAD = { claude: 20, direct: 3 } as const
const PROC_STEPS = ['prepare', 'read', 'judge', 'merge', 'export'] as const

export type Timing = { pageSec: number | null; pageRuns: number; procSec: number | null } | null
export type Engine = keyof typeof BATCH_OVERHEAD

export type Estimate = {
  seconds: number
  pages: number
  pageSec: number
  basis: string // 무엇을 기준으로 셌는지(화면에 그대로 보여 줌)
}

export function before(todo: number, engine: Engine, timing: Timing): Estimate {
  const pages = Math.min(Math.max(todo, 0), MAX_PAGES)
  const pageSec = timing?.pageSec ?? DEFAULT_PAGE_SEC
  const proc = timing?.procSec ?? DEFAULT_PROC_SEC
  const batches = Math.ceil(pages / BATCH)
  const seconds = pages * pageSec + batches * BATCH_OVERHEAD[engine] + proc
  const rate = timing?.pageSec != null ? `최근 수집 ${timing.pageRuns}번 평균 곳당 ${Math.round(pageSec)}초` : `곳당 ${pageSec}초(기본값)`
  const basis =
    pages === 0
      ? `받을 페이지가 없어 정리만 해요 · 정리 ${fmtDur(proc)}`
      : `받을 페이지 ${pages}개${todo > MAX_PAGES ? `(대기 중인 ${todo}개 이상 중 한 번에 ${MAX_PAGES}개)` : ''} · ${rate} · 정리 ${fmtDur(proc)}`
  return { seconds, pages, pageSec, basis }
}

type Live = {
  done: number
  total: number
  startedAt?: string
  updated?: string
}

/** 실행 중 남은 시간(초). steps: 단계별 상태, fetch: ego_fetch_status.json */
export function remaining(
  steps: Record<string, { state: string }>,
  fetch: Live | null,
  todo: number,
  engine: Engine,
  timing: Timing,
  now = Date.now(),
): { seconds: number; live: boolean } {
  const proc = timing?.procSec ?? DEFAULT_PROC_SEC
  const per = proc / PROC_STEPS.length
  const procLeft = PROC_STEPS.filter((s) => !['ok', 'warn', 'fail', 'skip'].includes(steps[s]?.state ?? '')).length * per
  const fetchState = steps.fetch?.state ?? 'idle'
  if (fetchState === 'ok' || fetchState === 'warn' || fetchState === 'fail' || fetchState === 'skip') return { seconds: procLeft, live: false }
  if (fetchState !== 'run' || !fetch || fetch.total <= 0) {
    // 아직 받기 전(1단계 중): 시작 전 계산과 같다(받을 페이지 수는 1단계가 끝나면 다시 센다)
    const e = before(todo, engine, timing)
    return { seconds: e.seconds - (proc - procLeft), live: false }
  }
  const left = Math.max(fetch.total - fetch.done, 0)
  const started = fetch.startedAt ? Date.parse(fetch.startedAt) : NaN
  const live = fetch.done >= 2 && Number.isFinite(started)
  const rate = live ? (now - started) / 1000 / fetch.done : timing?.pageSec ?? DEFAULT_PAGE_SEC
  const batchesLeft = Math.max(Math.ceil(fetch.total / BATCH) - Math.ceil(fetch.done / BATCH), 0)
  return { seconds: left * rate + batchesLeft * BATCH_OVERHEAD[engine] + procLeft, live }
}

/** 사람이 읽는 길이: 1분 미만 / 약 N분 / 약 H시간 M분 (올림) */
export function fmtDur(sec: number): string {
  if (sec < 60) return '1분 미만'
  const m = Math.ceil(sec / 60)
  if (m < 60) return `약 ${m}분`
  return `약 ${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`
}

/** 끝나는 시각: 오후 3:42 */
export function endsAt(sec: number, now = Date.now()): string {
  return new Date(now + sec * 1000).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' })
}
