// 탕방 데이터 DB(Cloudflare D1)에 초안을 올리고 '공개'하는 관리 도구. 수집 PC에서만 쓴다. 클로드용 수집 프로그램의 '공개' 화면도 이 파일을 부른다.
//   실행(프로젝트 폴더): node --env-file=.env scripts/d1_publish.mjs <명령> [--json]
//   .env에 필요한 값(값은 setup.ps1이 넣는다): TANGBANG_API(Worker 주소), TANGBANG_ADMIN_TOKEN
// 명령:
//   status                  공개 중인 스냅샷·초안·새 제보 수
//   ingest [파일]           web/public/data/onsen.json(기본)을 초안으로 올린다(바뀐 곳만 씀). 사용자 화면은 안 바뀜
//   diff                    공개본과 초안의 차이(새로 생긴 곳·빠진 곳·바뀐 곳·요금 바뀐 곳)
//   publish [--force] [--note 메모] [--expect 공개본번호]
//                           검증 통과 시 초안을 공개(1분 안에 사용자 화면에 반영). --expect: 화면이 본 공개본과 다르면 막는다
//   rollback [스냅샷id]     직전(또는 지정한) 공개본으로 되돌린다
//   reports [new|reviewed|applied|rejected]   제보 목록
//   report-set <id> <상태> [메모]             제보 상태 바꾸기
//   stats [일수]            날짜별 방문자 수(DAU)·목록 받은 횟수·제보 수(기본 14일)
//   fix-token               .env의 관리 토큰을 Worker 비밀 값으로 다시 넣는다(토큰이 어긋났을 때)
// --json: 사람이 읽는 글 대신 JSON 한 줄을 낸다 → {ok, data} 또는 {ok:false, error:{code, message, fix, problems?}}
// 토큰 값은 출력하지 않는다.

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = (process.env.TANGBANG_API || '').replace(/\/+$/, '')
const TOKEN = process.env.TANGBANG_ADMIN_TOKEN || ''
const argv = process.argv.slice(2)
const AS_JSON = argv.includes('--json')
const [cmd = 'status', ...args] = argv.filter((a) => a !== '--json')

const flag = (name) => args.includes(name)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

// 오류를 '무슨 일이고 다음에 뭘 하면 되는지'로 바꾼다(코드는 프로그램이 분기에 쓴다)
class Fail extends Error {
  constructor(code, message, fix = '', problems = []) {
    super(message)
    this.code = code
    this.fix = fix
    this.problems = problems
  }
}
const ERRORS = {
  config: ['관리 설정(.env의 TANGBANG_API·TANGBANG_ADMIN_TOKEN)이 없어요', 'worker\\setup.ps1을 한 번 실행해 주세요(Cloudflare 로그인 후 자동으로 넣어 줘요)'],
  network: ['인터넷 또는 Cloudflare Worker에 접속하지 못했어요', '인터넷 연결을 확인하고 다시 눌러 주세요. 계속 안 되면 Cloudflare 상태 페이지를 확인해요. 사용자 화면은 예전 파일로 계속 떠요'],
  auth: ['관리 토큰이 Worker와 달라요', "'토큰 맞추기'를 누르거나 `node --env-file=.env scripts/d1_publish.mjs fix-token`을 실행해요(.env의 토큰을 Worker에 다시 넣어요)"],
  quota: ['Cloudflare 무료 한도를 넘었어요', '한도는 한국 시간 오전 9시에 풀려요. 급하면 Workers 유료(Paid)로 올려요. 그동안 사용자 화면은 예전 파일로 떠요'],
  stale: ['다른 곳에서 먼저 공개했거나, 화면에 보이는 공개본이 오래됐어요', '상태를 다시 읽고(새로고침) 차이를 다시 확인한 뒤 공개해요'],
  'too-big': ['올리려는 초안이 너무 커요(1.8MB 넘음)', 'D1 한 행은 2MB까지라 저장 방식(R2)을 바꿔야 할 수 있어요. Claude에게 알려 주세요'],
  'not-published': ['아직 공개한 적이 없어요', '초안 올리기 → 차이 보기 → 공개 순서로 해요'],
  'not-ready': ['Worker에 비밀 값이 아직 안 들어 있어요', 'worker\\setup.ps1을 다시 실행해 주세요'],
  file: ['화면 데이터 파일(web/public/data/onsen.json)을 읽지 못했어요', "수집 탭에서 '화면 데이터 만들기'를 먼저 실행해 주세요"],
  validation: ['공개 전 검사에서 걸렸어요(아래 이유를 고치고 다시 올려요)', ''],
  server: ['Worker가 오류를 냈어요', '잠시 뒤 다시 해 보고, 계속되면 Claude에게 알려 주세요'],
}
const fail = (code, extra = {}) => {
  const [message, fix] = ERRORS[code] || ERRORS.server
  return new Fail(code, extra.message || message, extra.fix ?? fix, extra.problems || [])
}

async function call(method, p, body) {
  if (!API || !TOKEN) throw fail('config')
  let r
  try {
    r = await fetch(API + p, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw fail('network')
  }
  const j = await r.json().catch(() => ({ ok: false, error: `http-${r.status}` }))
  if (r.ok && j.ok) return j
  if (r.status === 401) throw fail('auth')
  if (r.status === 409 && j.error === 'stale') throw fail('stale')
  if (r.status === 413) throw fail('too-big')
  if (r.status === 422 && j.error === 'validation') throw fail('validation', { problems: j.problems })
  if (j.error === 'quota') throw fail('quota')
  if (ERRORS[j.error]) throw fail(j.error)
  throw fail('server', { message: `Worker가 오류를 냈어요(${j.error || r.status})` })
}

const EVENT_LABEL = {
  near: "'내 주변 목욕탕' 누름",
  sort_auto: '정렬: 추천순',
  sort_dist: '정렬: 가까운 순',
  sort_name: '정렬: 이름순',
  detail: '자세히 보기 열기',
  fav: '담아두기',
  report_open: '제보 창 열기',
  report_done: '제보 보내기 완료',
  magazine_open: '매거진 열기',
  story_read: '매거진 글 끝까지 읽기',
}

const readOnsen = (file) => {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
    if (!Array.isArray(d.places) || d.places.length === 0) throw new Error('empty')
    return d
  } catch {
    throw fail('file')
  }
}

async function run() {
  switch (cmd) {
    case 'status': {
      const s = await call('GET', '/admin/status')
      const live = s.snapshots.find((x) => x.id === s.active)
      return {
        data: { active: s.active, publishedAt: live?.created_at ?? null, liveCount: live?.place_count ?? null, draft: s.draft, newReports: s.newReports, visitors: s.visitors ?? null, snapshots: s.snapshots },
        text: [
          `공개 중인 스냅샷: ${s.active ?? '없음'}${live ? ` (${live.created_at}, ${live.place_count}곳)` : ''}`,
          `초안: ${s.draft.count}곳 · 기준일 ${s.draft.baseDate ?? '-'} · 마지막으로 올린 때 ${s.draft.updatedAt ?? '-'}`,
          `새 제보: ${s.newReports}건`,
          ...(s.visitors ? [`방문자(한국 날짜 기준): 오늘 ${s.visitors.today}명 · 어제 ${s.visitors.yesterday}명`] : []),
          ...s.snapshots.map((x) => `  #${x.id} ${x.created_at} ${x.place_count}곳${x.note ? ` · ${x.note}` : ''}`),
        ],
      }
    }
    case 'ingest': {
      const file = path.resolve(ROOT, args[0] && !args[0].startsWith('--') ? args[0] : 'web/public/data/onsen.json')
      if (!existsSync(file)) throw fail('file')
      const data = readOnsen(file)
      const j = await call('POST', '/admin/ingest', { baseDate: data.baseDate, places: data.places })
      return { data: j, text: [`초안 올림: ${j.received}곳 받음 · 새로 쓰거나 바뀐 곳 ${j.upserted} · 빠진 곳 ${j.deleted} (사용자 화면은 아직 그대로)`] }
    }
    case 'diff': {
      const d = await call('GET', '/admin/diff')
      const c = d.counts
      return {
        data: d,
        text: [
          `공개본 ${c.live}곳 → 초안 ${c.draft}곳 · 새로 생김 ${c.added} · 빠짐 ${c.removed} · 내용 바뀜 ${c.changed} · 대인 요금 바뀜 ${c.priceChanged}`,
          ...(d.added.length ? [`  새로 생김: ${d.added.join(', ')}`] : []),
          ...(d.removed.length ? [`  빠짐: ${d.removed.join(', ')}`] : []),
          ...d.priceChanges.map((p) => `  요금: ${p.name} ${p.before ?? '없음'} → ${p.after ?? '없음'}`),
        ],
      }
    }
    case 'publish': {
      const given = opt('--expect')
      const expect = given !== undefined ? Number(given) : ((await call('GET', '/admin/status')).active ?? 0)
      const j = await call('POST', '/admin/publish', { force: flag('--force'), note: opt('--note'), expect })
      return { data: j, text: [`공개했어요: 스냅샷 #${j.from ?? '-'} → #${j.to} (${j.count}곳). 1분 안에 사용자 화면에 반영돼요.`] }
    }
    case 'rollback': {
      const j = await call('POST', '/admin/rollback', args[0] ? { to: Number(args[0]) } : {})
      return { data: j, text: [`되돌렸어요: 스냅샷 #${j.from} → #${j.to}. 1분 안에 사용자 화면에 반영돼요.`] }
    }
    case 'reports': {
      const j = await call('GET', `/admin/reports?status=${encodeURIComponent(args[0] || 'new')}`)
      return {
        data: j,
        text: [
          ...j.reports.map(
            (r) =>
              `#${r.id} ${r.created_at.slice(0, 16)} ${r.place_name}(${r.place_id}) · 입장료 ${r.adult ?? '-'} 수건 ${r.towel ?? '-'} 세신 ${r.scrub ?? '-'}` +
              `${r.towel_info ? ` · 수건 안내 ${r.towel_info}` : ''}${r.hairdryer ? ` · 드라이기 ${r.hairdryer}` : ''}${r.seshin_pay ? ` · 세신 결제 ${r.seshin_pay}` : ''}` +
              ` · ${r.source}${r.flags ? ` · [${r.flags}]` : ''}${r.memo ? ` · ${r.memo}` : ''}${r.note ? ` · 검토: ${r.note}` : ''}`,
          ),
          `${j.reports.length}건`,
        ],
      }
    }
    case 'stats': {
      const days = Number(args[0]) || 14
      const j = await call('GET', `/admin/stats?days=${days}`)
      const total = j.days.reduce((a, d) => a + d.visitors, 0)
      return {
        data: j,
        text: [
          '날짜(한국)   방문자  목록받음  제보',
          ...j.days.map((d) => `${d.day}  ${String(d.visitors).padStart(5)}  ${String(d.loads).padStart(7)}  ${String(d.reports).padStart(4)}`),
          `최근 ${j.days.length}일 하루 평균 방문자 ${(total / j.days.length).toFixed(1)}명 (같은 기기·브라우저는 하루 1명으로 셈, 서비스 화면에서 온 요청만)`,
          '',
          `핵심 행동 (최근 ${j.days.length}일, 사람 수는 날마다 따로 셈해서 더한 값이라 같은 사람이 여러 날 하면 여러 번 포함)`,
          ...(j.events || []).map((e) => `  ${EVENT_LABEL[e.name] || e.name}: ${e.users}명 · ${e.total}번`),
        ],
      }
    }
    case 'report-set': {
      const [id, st, ...note] = args
      const j = await call('POST', `/admin/reports/${Number(id)}`, { status: st, note: note.join(' ') })
      return { data: j, text: [`제보 #${id} → ${st}`] }
    }
    case 'fix-token': {
      if (!TOKEN) throw fail('config')
      // wrangler로 Worker 비밀 값을 .env의 토큰으로 다시 넣는다(줄바꿈 없이). 값은 출력하지 않는다
      const r = spawnSync('node', ['put-secret.mjs', 'ADMIN_TOKEN'], { cwd: path.join(ROOT, 'worker'), env: { ...process.env, SECRET_VALUE: TOKEN }, encoding: 'utf8', shell: process.platform === 'win32' })
      if (r.status !== 0) throw fail('server', { message: 'Worker에 토큰을 다시 넣지 못했어요', fix: 'Cloudflare 로그인이 풀렸을 수 있어요. `npx wrangler login`(worker 폴더) 후 다시 해 주세요' })
      return { data: { ok: true }, text: ['Worker의 관리 토큰을 .env 값으로 맞췄어요. 1분쯤 뒤 다시 시도해 주세요.'] }
    }
    default:
      throw new Fail('usage', `모르는 명령: ${cmd}`)
  }
}

try {
  const out = await run()
  if (AS_JSON) console.log(JSON.stringify({ ok: true, command: cmd, data: out.data }))
  else for (const l of out.text) console.log(l)
} catch (e) {
  const err = e instanceof Fail ? e : fail('server', { message: String(e?.message || e) })
  if (AS_JSON) console.log(JSON.stringify({ ok: false, command: cmd, error: { code: err.code, message: err.message, fix: err.fix, problems: err.problems } }))
  else {
    console.error(`⛔ ${err.message}`)
    for (const p of err.problems) console.error(`  - ${p}`)
    if (err.fix) console.error(`  → ${err.fix}`)
  }
  process.exit(2)
}
