import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import logo from '../../web/src/assets/onsen-logo/logo-static.png'
import Dashboard from './Dashboard'
import Photos from './Photos'
import { before, endsAt, fmtDur, remaining, type Timing } from './estimate'
import Clock from './Clock'
import { daysBefore } from './time'
// 서비스 화면과 같은 스포트라이트 안내 컴포넌트를 그대로 쓴다(모양·동작을 한 곳에서 관리)
import Onboarding, { type TourStep } from '../../web/src/components/Onboarding'

// ───────── 데이터 모양 (src-tauri/src/main.rs와 같게) ─────────
type Check = { id: string; label: string; ok: boolean; detail: string; fix: string }
type Summary = {
  merged: number | null
  homeFacts: number | null
  idFound: number | null
  todoHome: number | null
  todoFind: number | null
  webPlaces: number | null
  webBaseDate: string | null
  webUpdated: number | null
  timing: Timing
  homeDates: string[]
  todoHomeNew: number
  reviewDates: string[]
  todoReviewNew: number
  blogDates: string[]
  todoBlogNew: number
  todoPhoto: number | null
}
type FetchStatus = { state: string; done: number; total: number; saved: number; failed: number; reason: string; last: string; startedAt?: string } | null
type StepState = 'idle' | 'run' | 'ok' | 'warn' | 'fail' | 'skip'
type Engine = 'claude' | 'direct'
type Publish = { git: boolean; changed?: string[]; ahead?: number; photosChanged?: boolean } | null
// 서비스에 올리는 일은 이 앱이 하지 않는다. Claude Code에 이 문장을 말하면 커밋·푸시한다
const PUBLISH_ASK = '탕방 수집 결과 커밋하고 푸시해줘'
type LogLine = { id: number; kind: 'out' | 'err' | 'info'; text: string }

const STEPS: { id: string; title: string; desc: string }[] = [
  { id: 'prepare', title: '받을 목록 만들기', desc: '아직 안 받은 홈·후기·사진·블로그 페이지를 골라요' },
  { id: 'fetch', title: 'ego 브라우저로 받기', desc: '곳당 10초 간격으로 페이지를 저장해요' },
  { id: 'read', title: '받은 페이지 읽기', desc: '홈·방문자 후기·블로그에서 수건·드라이기·세신 근거를 뽑아요' },
  { id: 'judge', title: '정보 판정', desc: '근거가 확실한 정보만 남겨요' },
  { id: 'merge', title: '목록 합치기', desc: '공공데이터·카카오·네이버 자료를 하나로 합쳐요' },
  { id: 'export', title: '화면 데이터 만들기', desc: '탕방 화면이 읽는 파일을 새로 만들어요' },
]
const EXTRA_TOOLS = [
  { bin: 'export_gu_boundary', title: '구 경계 다시 만들기' },
  { bin: 'naver_import', title: '네이버 장소 목록 가져오기' },
  { bin: 'onsen_official', title: '행안부 원본 정리' },
]
const STATE_TEXT: Record<StepState, string> = { idle: '대기', run: '진행 중', ok: '완료', warn: '멈춤', fail: '실패', skip: '건너뜀' }
const ENGINE_KEY = 'tangbang-collector:engine'
const REFRESH_KEY = 'tangbang-collector:refresh-days'
// 다시 받기: 마지막 수집일이 이 날수보다 오래된 곳을 다시 받는다(0 = 안 함)
const REFRESH_OPTIONS = [
  { days: 0, label: '안 함' },
  { days: 30, label: '30일 지난 곳' },
  { days: 7, label: '7일 지난 곳' },
]

function readRefresh(): number {
  try {
    const v = Number(localStorage.getItem(REFRESH_KEY))
    return REFRESH_OPTIONS.some((o) => o.days === v) && localStorage.getItem(REFRESH_KEY) !== null ? v : 30
  } catch {
    return 30
  }
}
// 화면 흐름을 바꾸면 안내 단계도 고치고 v 숫자를 올린다(이미 본 사람에게 다시 보여 주려고)
const TOUR_KEY = 'tangbang-collector:onboarding:v4'

function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === '1'
  } catch {
    return true // 저장소를 못 쓰면 매번 띄우지 않는다
  }
}

const n = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('ko-KR'))

function readEngine(): Engine {
  try {
    return localStorage.getItem(ENGINE_KEY) === 'direct' ? 'direct' : 'claude'
  } catch {
    return 'claude'
  }
}

export default function App() {
  const [root, setRoot] = useState<string | null>(null)
  const [rootError, setRootError] = useState('')
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [engine, setEngine] = useState<Engine>(readEngine)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Record<string, { state: StepState; note: string }>>({})
  const [fetchSt, setFetchSt] = useState<FetchStatus>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [tab, setTab] = useState<'collect' | 'dash' | 'photo'>('collect')
  const [tourOpen, setTourOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [refreshDays, setRefreshDays] = useState<number>(readRefresh)
  const [pub, setPub] = useState<Publish>(null)
  const [copied, setCopied] = useState(false)
  const loadPub = useCallback(() => invoke<Publish>('publish_status').then(setPub).catch(() => {}), [])
  const logId = useRef(0)
  const logBox = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const r = await invoke<string | null>('get_root')
    setRoot(r)
    setChecks(await invoke<Check[]>('check_env'))
    if (r) setSummary(await invoke<Summary>('summary').catch(() => null))
    if (r) loadPub()
  }, [loadPub])

  useEffect(() => {
    refresh()
    invoke<boolean>('is_running').then(setRunning)
    const un = [
      listen<{ kind: LogLine['kind']; text: string }>('log', (e) => {
        setLogs((l) => [...l.slice(-400), { id: ++logId.current, ...e.payload }])
      }),
      listen<{ id: string; state: StepState; note: string }>('step', (e) => {
        setSteps((s) => ({ ...s, [e.payload.id]: { state: e.payload.state, note: e.payload.note } }))
        // 목록을 새로 만들었으면 받을 페이지 수가 바뀌므로 예상 시간을 다시 센다
        if (e.payload.id === 'prepare' && e.payload.state === 'ok') invoke<Summary>('summary').then(setSummary).catch(() => {})
      }),
      listen<{ ok: boolean; message: string }>('finished', (e) => {
        setRunning(false)
        setStopping(false)
        setResult(e.payload)
        refresh()
      }),
    ]
    return () => un.forEach((p) => p.then((f) => f()))
  }, [refresh])

  // 쉬는 동안에도 30초마다 지금 시각을 다시 읽어 예상 끝나는 시각·오래된 곳 수를 맞춘다
  useEffect(() => {
    if (running) return
    const t = setInterval(() => {
      setNow(Date.now())
      loadPub() // 사진을 고르거나 반영하면 바뀌므로 쉬는 동안 30초마다 다시 본다
    }, 30_000)
    return () => clearInterval(t)
  }, [running, loadPub])

  // 받는 동안 진행 상황(ego_fetch_status.json)을 읽는다
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      invoke<FetchStatus>('fetch_status').then(setFetchSt).catch(() => {})
      setNow(Date.now())
    }, 1500)
    return () => clearInterval(t)
  }, [running, loadPub])

  useEffect(() => {
    const el = logBox.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs, logOpen])

  // 처음 열 때 한 번: 준비 상태를 읽은 뒤 안내를 띄운다
  useEffect(() => {
    if (checks && !tourSeen()) setTourOpen(true)
  }, [checks])

  const tour: TourStep[] = [
    {
      target: '[data-tour="ready"]',
      title: '먼저 준비 상태를 봐요',
      body: '다섯 가지가 모두 ✓이면 수집할 수 있어요. !가 있으면 그 아래 안내대로 설치한 뒤 ‘다시 확인’을 눌러 주세요.',
      onEnter: () => setTab('collect'),
    },
    {
      target: '[data-tour="folder"]',
      title: '프로젝트 폴더',
      body: '깃에서 받은 탕방 폴더예요. 수집한 파일과 화면 데이터가 모두 이 폴더에 저장돼요. 다른 폴더를 쓰려면 ‘바꾸기’를 눌러요.',
    },
    {
      target: '[data-tour="engine"]',
      title: '수집 방법 고르기',
      body: '‘Claude와 함께’는 Claude Code가 ego 브라우저를 움직이고 멈춘 이유를 알려 줘요. Claude가 없거나 로그인이 안 돼 있으면 ‘직접 실행’을 골라요. 지키는 규칙은 같아요.',
    },
    {
      target: '[data-tour="refresh"]',
      title: '다시 받기',
      body: '이미 받은 곳도 오래되면 다시 받아 가장 최근 정보로 바꿔요. 며칠이 지났는지는 오른쪽 위 시계(한국 시간)로 세요. 오래된 곳부터 받고, 새 곳과 합쳐 한 번에 150곳까지예요.',
    },
    {
      target: '[data-tour="start"]',
      title: '수집 시작',
      body: '누르면 아래 6단계를 차례로 해요. 버튼 아래에 예상 시간과 끝나는 시각이 나와요. 받기 시작하면 실제 속도로 남은 시간을 다시 계산해요. 캡차가 보이면 바로 멈추고, 그때까지 받은 만큼은 정리해 줘요.',
    },
    {
      target: '[data-tour="steps"] .step:first-child',
      title: '지금 어디까지 했는지',
      body: '단계마다 대기 → 진행 중 → 완료로 바뀌어요. 한 단계만 다시 돌리고 싶으면 아래 ‘단계별로 실행’을, 자세한 출력은 ‘실행 기록’을 열어요.',
    },
    {
      target: '.step-manual',
      title: '서비스에 반영하기',
      body: '수집과 사진 고르기는 이 PC의 파일만 바꿔요. 서비스(tangbang.vercel.app)에 올리려면 Claude Code에 \u201C탕방 수집 결과 커밋하고 푸시해줘\u201D라고 말해 주세요. 올릴 변경이 생기면 위쪽에 노란 알림이 떠요.',
    },
    {
      target: '[data-tour="kpis"]',
      title: '대시보드: 얼마나 채웠나',
      body: '화면에 나오는 곳 중 요금·TOP 3·네이버 연결이 몇 %인지 보여 줘요. 숫자는 데이터 파일에서 바로 세요.',
      onEnter: () => setTab('dash'),
    },
    {
      target: '[data-tour="actions"] .action:first-child',
      title: '다음에 할 일',
      body: '비어 있는 곳이 많은 순서로 정리했어요. ‘목록 보기’를 누르면 아래 장소 목록이 그 조건으로 걸러져요.',
    },
    {
      target: '[data-tour="reload"]',
      title: '숫자 다시 읽기',
      body: '데이터 파일을 다시 읽어 숫자를 새로 세요. 수집은 하지 않아요. 터미널에서 직접 도구를 돌렸거나 파일을 고쳤을 때 눌러요.',
    },
    {
      target: '[data-tour="photo-tab"]',
      title: '사진 고르기',
      body: '네이버 업체 사진 후보 중 대표 사진을 직접 골라요. 고르면 서비스 목록 카드에 어떻게 보이는지 바로 미리 보여 주고, \u2018화면 데이터에 반영\u2019을 누르면 서비스 데이터에 들어가요.',
      onEnter: () => setTab('collect'),
    },
  ]

  const closeTour = () => {
    setTourOpen(false)
    setTab('collect')
    try {
      localStorage.setItem(TOUR_KEY, '1')
    } catch {
      /* 저장 못 해도 닫는다 */
    }
  }

  const chooseRoot = async () => {
    setRootError('')
    const picked = await open({ directory: true, title: '탕방 프로젝트 폴더 고르기' })
    if (typeof picked !== 'string') return
    try {
      setRoot(await invoke<string>('set_root', { path: picked }))
      refresh()
    } catch (e) {
      setRootError(String(e))
    }
  }

  const pickEngine = (e: Engine) => {
    setEngine(e)
    try {
      localStorage.setItem(ENGINE_KEY, e)
    } catch {
      /* 저장 못 해도 이번 실행에는 적용 */
    }
  }

  const run = async (plan: string) => {
    setResult(null)
    setFetchSt(null)
    setSteps({})
    setLogs([])
    // 먼저 켠다: 바로 실패하면 'finished'가 invoke 응답보다 먼저 와서, 뒤에 켜면 '실행 중'에 갇힌다
    setRunning(true)
    try {
      await invoke('start', { plan, engine, refreshDays: refreshDays > 0 ? refreshDays : null })
    } catch (e) {
      setRunning(false)
      setResult({ ok: false, message: String(e) })
    }
  }

  const stop = async () => {
    setStopping(true)
    await invoke('stop')
  }

  const need = (id: string) => checks?.find((c) => c.id === id)?.ok ?? false
  const canRun = !!root && need('cargo') && need('ego') && (engine === 'direct' || need('claude'))
  const blockers = checks?.filter((c) => !c.ok && ['root', 'cargo', 'ego'].concat(engine === 'claude' ? ['claude'] : []).includes(c.id)) ?? []
  const pct = fetchSt && fetchSt.total > 0 ? Math.min(100, Math.round((fetchSt.done / fetchSt.total) * 100)) : 0
  const todo = (summary?.todoFind ?? 0) + (summary?.todoHome ?? 0)
  const readyAll = !!checks && checks.every((c) => c.ok)
  const pending = !!pub?.git && ((pub.changed?.length ?? 0) > 0 || (pub.ahead ?? 0) > 0)
  const timing = summary?.timing ?? null
  // 받을 페이지 = 새로 찾을 검색 + 새 곳 홈 + (다시 받기를 켰으면) 기준보다 오래된 곳. 기준 날짜는 지금 한국 시간에서 센다
  const staleFrom = refreshDays > 0 ? daysBefore(refreshDays, now) : null
  const old = (ds: string[] | undefined) => (staleFrom ? (ds ?? []).filter((d) => d && d < staleFrom).length : 0)
  const stale = old(summary?.homeDates) + old(summary?.reviewDates) + old(summary?.blogDates)
  const toFetch = (summary?.todoFind ?? 0) + (summary?.todoHomeNew ?? 0) + (summary?.todoReviewNew ?? 0) + (summary?.todoBlogNew ?? 0) + (summary?.todoPhoto ?? 0) + stale
  const est = before(toFetch, engine, timing)
  const left = running ? remaining(steps, fetchSt, toFetch, engine, timing, now) : null

  return (
    <div className="app">
      <header className="top">
        <img className="top-logo" src={logo} alt="" width={40} height={40} />
        <div className="top-text">
          <h1>탕방 데이터 수집 도구</h1>
          <p>네이버 플레이스에서 서울 목욕탕 정보를 모아 탕방 화면 데이터로 만들어요</p>
        </div>
        <Clock />
        <button className="btn btn-outline btn-sm top-help" onClick={() => setTourOpen(true)} disabled={running}>
          어떻게 사용하는 거예요?
        </button>
      </header>
      <nav className="tabs" role="tablist" aria-label="화면">
        <button role="tab" aria-selected={tab === 'collect'} className={tab === 'collect' ? 'tab on' : 'tab'} onClick={() => setTab('collect')}>
          수집{running && <span className="tab-dot" aria-label="실행 중" />}
        </button>
        <button role="tab" aria-selected={tab === 'dash'} className={tab === 'dash' ? 'tab on' : 'tab'} onClick={() => setTab('dash')} disabled={!root}>
          대시보드
        </button>
        <button role="tab" aria-selected={tab === 'photo'} className={tab === 'photo' ? 'tab on' : 'tab'} onClick={() => setTab('photo')} disabled={!root} data-tour="photo-tab">
          사진 고르기
        </button>
      </nav>
      {rootError && <div className="toast toast-error" role="alert">{rootError}</div>}
      {pending && !running && (
        <div className="publish" role="status" data-tour="publish">
          <span className="publish-dot" aria-hidden />
          <div className="publish-text">
            <strong>{(pub?.changed?.length ?? 0) > 0 ? '아직 서비스에 반영되지 않은 변경이 있어요' : '커밋은 됐지만 아직 서비스에 올리지 않았어요'}</strong>
            <span>
              {(pub?.changed?.length ?? 0) > 0
                ? `${pub?.photosChanged ? '고른 사진·' : ''}화면 데이터 등 ${pub?.changed?.length}개 파일이 이 PC에만 있어요. `
                : `푸시 안 한 커밋 ${pub?.ahead}개. `}
              Claude Code에 이렇게 말해 주세요: <q>{PUBLISH_ASK}</q>
            </span>
            {(pub?.changed?.length ?? 0) > 0 && (
              <details className="publish-files">
                <summary>바뀐 파일 보기</summary>
                <ul>{pub?.changed?.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
              </details>
            )}
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(PUBLISH_ASK).then(
                () => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 2000)
                },
                () => {},
              )
            }}
          >
            {copied ? '복사했어요' : '문장 복사'}
          </button>
        </div>
      )}

      {root && (
        <div hidden={tab !== 'dash'}>
          <Dashboard active={tab === 'dash' && !running} />
        </div>
      )}
      {root && tab === 'photo' && (
        <Photos
          active={tab === 'photo'}
          running={running}
          onSaved={loadPub}
          onApply={() => {
            setTab('collect')
            run('export')
          }}
        />
      )}
      <main className="grid" hidden={tab !== 'collect'}>
        <div className="col">
          <section className="card hero" aria-labelledby="run-title">
            <div className="card-head">
              <h2 id="run-title" className="card-title">수집하기</h2>
              <div className="segmented" role="radiogroup" aria-label="수집 방법" data-tour="engine">
                {(['claude', 'direct'] as Engine[]).map((e) => (
                  <button
                    key={e}
                    role="radio"
                    aria-checked={engine === e}
                    className={engine === e ? 'seg on' : 'seg'}
                    onClick={() => pickEngine(e)}
                    disabled={running}
                  >
                    {e === 'claude' ? 'Claude와 함께' : '직접 실행'}
                  </button>
                ))}
              </div>
            </div>
            <p className="hint hint-tight">
              {engine === 'claude'
                ? 'Claude Code가 ego 브라우저를 움직여 페이지를 받고, 멈추면 이유를 알려 줘요.'
                : 'Claude 없이 ego 브라우저로 바로 받아요. 지키는 규칙은 같아요.'}
            </p>

            <div className="refresh" data-tour="refresh">
              <span className="refresh-label" id="refresh-label">다시 받기</span>
              <div className="chips chips-sm" role="radiogroup" aria-labelledby="refresh-label">
                {REFRESH_OPTIONS.map((o) => (
                  <button
                    key={o.days}
                    role="radio"
                    aria-checked={refreshDays === o.days}
                    className={refreshDays === o.days ? 'chip on' : 'chip'}
                    onClick={() => {
                      setRefreshDays(o.days)
                      try {
                        localStorage.setItem(REFRESH_KEY, String(o.days))
                      } catch {
                        /* 저장 못 해도 이번 실행에는 적용 */
                      }
                    }}
                    disabled={running}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <span className="refresh-note">
                {staleFrom ? `${staleFrom} 이전에 받은 페이지 ${stale}개(홈·후기·블로그)` : '이미 받은 곳은 다시 받지 않아요'}
              </span>
            </div>

            <div className="run-row" data-tour="start">
              {!running ? (
                <button className="btn btn-primary btn-lg" onClick={() => run('all')} disabled={!canRun}>
                  수집 시작
                </button>
              ) : (
                <button className="btn btn-outline btn-lg" onClick={stop} disabled={stopping}>
                  {stopping ? '멈추는 중…' : '멈추기'}
                </button>
              )}
              {!running && (
                <div className="estimate" data-tour="estimate">
                  <div className="estimate-main">
                    예상 <strong>{fmtDur(est.seconds)}</strong>
                    <span className="estimate-end"> · {endsAt(est.seconds)}쯤 끝나요</span>
                  </div>
                  <div className="estimate-basis">{est.basis}</div>
                </div>
              )}
            </div>
            <ul className="rules" aria-label="수집 규칙">
              <li>곳당 10초 간격</li>
              <li>한 번에 150곳까지</li>
              <li>캡차가 보이면 바로 멈춤</li>
            </ul>            {!canRun && !running && blockers.length > 0 && (
              <p className="blocker">먼저 준비할 것: {blockers.map((b) => b.label).join(', ')}</p>
            )}

            {(running || fetchSt) && (
              <div className="progress" aria-live="polite">
                <div className="progress-head">
                  <span>페이지 받기</span>
                  <span className="progress-num">
                    {fetchSt ? `${n(fetchSt.done)} / ${n(fetchSt.total)}곳` : '준비 중'}
                  </span>
                </div>
                <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <div className="bar-fill" style={{ width: `${pct}%` }} />
                </div>
                {left && (
                  <p className="estimate estimate-live">
                    남은 시간 <strong>{fmtDur(left.seconds)}</strong>
                    <span className="estimate-end"> · {endsAt(left.seconds, now)}쯤 끝나요</span>
                    <span className="estimate-basis">{left.live ? '지금까지 받은 실제 속도로 계산해요' : '예상 값이에요. 2곳 이상 받으면 실제 속도로 다시 계산해요'}</span>
                  </p>
                )}
                {fetchSt?.last && <p className="progress-last">마지막으로 받은 곳: {fetchSt.last}</p>}
              </div>
            )}

            {result && (
              <div className={result.ok ? 'toast toast-success' : 'toast toast-error'} role="status">
                <span className="toast-dot" aria-hidden />
                {result.message}
              </div>
            )}

            <ol className="steps" data-tour="steps">
              {STEPS.map((s, i) => {
                const st = steps[s.id]?.state ?? 'idle'
                return (
                  <li key={s.id} className={`step step-${st}`}>
                    <span className="step-num" aria-hidden>{st === 'ok' ? '✓' : st === 'fail' ? '!' : i + 1}</span>
                    <div className="step-body">
                      <div className="step-title">{s.title}</div>
                      <div className="step-desc">{steps[s.id]?.note || s.desc}</div>
                    </div>
                    <span className={`badge badge-${st}`}>{STATE_TEXT[st]}</span>
                  </li>
                )
              })}
              <li className={`step step-manual ${pending ? 'step-warn' : pub?.git ? 'step-ok' : ''}`}>
                <span className="step-num" aria-hidden>{pending ? '!' : pub?.git ? '✓' : STEPS.length + 1}</span>
                <div className="step-body">
                  <div className="step-title">서비스에 반영하기</div>
                  <div className="step-desc">
                    {pending ? `Claude Code에 \u201C${PUBLISH_ASK}\u201D라고 말해 주세요` : '앱이 하지 않아요. 바뀐 데이터가 생기면 여기와 위쪽에 알려 줘요'}
                  </div>
                </div>
                <span className={`badge ${pending ? 'badge-warn' : pub?.git ? 'badge-ok' : ''}`}>{pending ? '할 일 있음' : pub?.git ? '반영됨' : '직접'}</span>
              </li>
            </ol>
          </section>

          <details className="card fold">
            <summary className="card-title">단계별로 실행</summary>
            <p className="hint">한 단계만 다시 돌릴 때 써요. 순서는 위 목록과 같아요.</p>
            <div className="tool-grid">
              {STEPS.map((s) => (
                <button key={s.id} className="btn btn-outline" onClick={() => run(s.id)} disabled={running || !root || !need('cargo') || (s.id === 'fetch' && !canRun)}>
                  {s.title}
                </button>
              ))}
              {EXTRA_TOOLS.map((t) => (
                <button key={t.bin} className="btn btn-outline" onClick={() => run(`tool:${t.bin}`)} disabled={running || !root || !need('cargo')}>
                  {t.title}
                </button>
              ))}
            </div>
          </details>

          <details className="card fold" open={logOpen} onToggle={(e) => setLogOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="card-title">
              실행 기록 <span className="count">{logs.length}줄</span>
            </summary>
            <div className="log" ref={logBox} role="log">
              {logs.length === 0 ? (
                <p className="log-empty">아직 기록이 없어요</p>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className={`log-line log-${l.kind}`}>
                    {l.text}
                  </div>
                ))
              )}
            </div>
          </details>
        </div>

        <div className="col">
          <section className="card" aria-labelledby="ready-title" data-tour="ready">
            <div className="card-head">
              <h2 id="ready-title" className="card-title">
                준비 상태
                {checks && (
                  <span className={readyAll ? 'tag tag-ok' : 'tag tag-warn'}>
                    {readyAll ? '모두 준비됨' : `${checks.filter((c) => !c.ok).length}개 필요`}
                  </span>
                )}
              </h2>
              <button className="btn btn-outline btn-sm" onClick={refresh} disabled={running}>다시 확인</button>
            </div>
            <ul className="checks">
              {(checks ?? []).map((c) => (
                <li key={c.id} className={c.ok ? 'check ok' : 'check no'} data-tour={c.id === 'root' ? 'folder' : undefined}>
                  <span className="check-icon" aria-hidden>{c.ok ? '✓' : '!'}</span>
                  <div className="check-body">
                    <div className="check-label">
                      {c.label}
                      <span className="sr-only">{c.ok ? ' 준비됨' : ' 준비 필요'}</span>
                    </div>
                    <div className="check-detail" title={c.detail}>{c.detail}</div>
                    {!c.ok && <div className="check-fix">{c.fix}</div>}
                  </div>
                  {c.id === 'root' && (
                    <button className="btn btn-outline btn-sm" onClick={chooseRoot} disabled={running}>
                      {root ? '바꾸기' : '폴더 고르기'}
                    </button>
                  )}
                </li>
              ))}
              {!checks && <li className="check">확인하는 중…</li>}
            </ul>
          </section>

          <section className="card" aria-labelledby="data-title">
            <div className="card-head">
              <h2 id="data-title" className="card-title">지금 데이터</h2>
              <button className="link-btn" onClick={() => setTab('dash')} disabled={!root}>대시보드에서 자세히 →</button>
            </div>
            <dl className="stats">
              <div className="stat">
                <dt>화면에 나오는 곳</dt>
                <dd>{n(summary?.webPlaces)}<small>곳</small></dd>
              </div>
              <div className="stat">
                <dt>네이버 홈 정보</dt>
                <dd>{n(summary?.homeFacts)}<small>곳</small></dd>
              </div>
              <div className="stat">
                <dt>ID 찾기 기록</dt>
                <dd>{n(summary?.idFound)}<small>곳</small></dd>
              </div>
              <div className="stat">
                <dt>받을 페이지</dt>
                <dd>{n(toFetch)}<small>개</small></dd>
              </div>
            </dl>
            <p className="hint">
              데이터 기준일 {summary?.webBaseDate ?? '–'}
              {summary?.webUpdated ? ` · 마지막으로 만든 때 ${new Date(summary.webUpdated * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
            </p>
          </section>

          <section className="note" aria-label="알아 둘 것">
            <h2 className="note-title">알아 둘 것</h2>
            <ul>
              <li>받은 페이지는 이 컴퓨터에만 저장되고 깃에는 올라가지 않아요.</li>
              <li>사람이 확인해서 넣은 값은 바꾸지 않아요.</li>
              <li>다 끝나면 탕방 화면 데이터가 바뀌어요. 서비스에 반영하려면 커밋·배포를 따로 해요.</li>
            </ul>
          </section>
        </div>      </main>
      <Onboarding steps={tour} open={tourOpen} onClose={closeTour} />
    </div>
  )
}
