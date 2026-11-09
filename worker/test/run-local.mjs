// Worker를 Cloudflare 없이 이 PC에서 시험한다. D1 대신 Node 내장 SQLite(node:sqlite)에 같은 SQL을 돌린다.
//   실행(프로젝트 폴더): node worker/test/run-local.mjs
// 실제 D1과 다를 수 있는 점: 한도(행 읽기·CPU)와 Cloudflare 캐시는 흉내만 낸다. 배포 뒤에는 setup.ps1의 확인 단계로 다시 본다.

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const worker = (await import('../src/index.js')).default

// ── D1 흉내 ──
const sqlite = new DatabaseSync(':memory:')
sqlite.exec(readFileSync(path.join(HERE, '../schema.sql'), 'utf8'))
const conv = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)
class Stmt {
  constructor(sql, params = []) {
    this.sql = sql
    this.params = params
  }
  bind(...p) {
    return new Stmt(this.sql, p.map(conv))
  }
  #st() {
    return sqlite.prepare(this.sql)
  }
  async first() {
    return this.#st().get(...this.params) ?? null
  }
  async all() {
    return { results: this.#st().all(...this.params) }
  }
  async run() {
    if (/\bRETURNING\b/i.test(this.sql)) return { results: this.#st().all(...this.params), meta: { changes: 1 } }
    const r = this.#st().run(...this.params)
    return { meta: { changes: Number(r.changes) } }
  }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(list) {
    sqlite.exec('BEGIN')
    try {
      const out = []
      for (const s of list) out.push(await s.run())
      sqlite.exec('COMMIT')
      return out
    } catch (e) {
      sqlite.exec('ROLLBACK')
      throw e
    }
  },
}
// Cloudflare 캐시 흉내
const store = new Map()
globalThis.caches = { default: { match: async (k) => (store.has(k.url) ? new Response(store.get(k.url)) : undefined), put: async (k, r) => store.set(k.url, await r.text()) } }

const env = { DB, ADMIN_TOKEN: 'local-test-token-0123456789', REPORT_SALT: 'local-test-salt', ALLOWED_ORIGINS: 'https://tangbang.vercel.app,http://localhost:5173' }
const pending = [] // 응답 뒤에 도는 일(캐시 넣기·방문 세기). 시험에서는 모아 두었다가 기다린다
const ctx = { waitUntil: (p) => pending.push(p) }
const settle = async () => Promise.all(pending.splice(0))
const BASE = 'https://tangbang-api.example.workers.dev'
const call = async (method, p, { body, raw, admin, headers = {} } = {}) => {
  const req = new Request(BASE + p, {
    method,
    headers: { ...(admin ? { Authorization: `Bearer ${env.ADMIN_TOKEN}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  })
  const t = performance.now()
  const res = await worker.fetch(req, env, ctx)
  const ms = performance.now() - t
  const txt = res.status === 304 ? '' : await res.text()
  let j = null
  try {
    j = JSON.parse(txt)
  } catch {}
  return { res, j, txt, ms }
}

const data = JSON.parse(readFileSync(path.join(ROOT, 'web/public/data/onsen.json'), 'utf8').replace(/^﻿/, ''))
let pass = 0
const ok = (name, cond, extra = '') => {
  assert.ok(cond, name)
  pass++
  console.log(`✓ ${name}${extra ? ` (${extra})` : ''}`)
}

// 0. 실제 D1은 LIKE/GLOB 패턴을 50바이트까지만 받는다(2026-11-06 배포하다 'pattern too complex'로 실패). Node SQLite는 이 제한이 없어 시험에서 못 잡으므로 소스를 직접 검사한다
const src = readFileSync(path.join(HERE, '../src/index.js'), 'utf8')
const patterns = [...src.matchAll(/\b(?:GLOB|LIKE)\s+'([^']*)'/g)].map((m) => m[1])
ok('SQL의 LIKE/GLOB 패턴이 모두 50바이트 이하(D1 제한)', patterns.length >= 2 && patterns.every((p) => Buffer.byteLength(p) <= 50), `${patterns.length}개, 가장 긴 것 ${Math.max(...patterns.map((p) => Buffer.byteLength(p)))}바이트`)

// 1. 공개 전
ok('공개 전에는 /api/places가 503', (await call('GET', '/api/places')).res.status === 503)
ok('관리용은 토큰 없으면 401', (await call('GET', '/admin/status')).res.status === 401)

// 2. 초안 올리기
let r = await call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places: data.places } })
ok('초안 올리기', r.j.ok && r.j.upserted === data.places.length, `${r.j.upserted}곳 씀`)
r = await call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places: data.places } })
ok('같은 내용을 다시 올리면 쓰지 않음', r.j.upserted === 0 && r.j.deleted === 0, `씀 ${r.j.upserted}`)
r = await call('GET', '/admin/diff', { admin: true })
ok('공개 전 diff = 전부 새로 생김', r.j.counts.added === data.places.length && r.j.counts.live === 0)

// 3. 공개
r = await call('POST', '/admin/publish', { admin: true, body: { note: '첫 공개' } })
ok('공개', r.j.ok && r.j.to === 1, `#${r.j.to}, ${r.j.count}곳`)

// 4. 사용자가 받는 데이터 = 지금 onsen.json
r = await call('GET', '/api/places', { headers: { Origin: 'https://tangbang.vercel.app' } })
const got = r.j
ok('스냅샷 곳 수와 기준일이 onsen.json과 같음', got.places.length === data.places.length && got.baseDate === data.baseDate)
assert.deepStrictEqual(got.places, data.places)
ok('스냅샷 places 내용이 onsen.json과 완전히 같음(순서·칸·값)', true)
ok('publishedAt이 붙음', typeof got.publishedAt === 'string')
ok('허용한 화면 주소에는 CORS 허용', r.res.headers.get('Access-Control-Allow-Origin') === 'https://tangbang.vercel.app')
const etag = r.res.headers.get('ETag')
ok('ETag가 있음', etag === '"s1"', etag)
r = await call('GET', '/api/places', { headers: { 'If-None-Match': etag } })
ok('바뀌지 않았으면 304', r.res.status === 304)
r = await call('GET', '/api/places', { headers: { Origin: 'https://evil.example.com' } })
ok('허용 안 한 주소에는 CORS 헤더 없음', !r.res.headers.get('Access-Control-Allow-Origin'))
r = await call('GET', '/api/places')
ok('두 번째부터는 캐시에서 읽음', store.size === 1, `${r.ms.toFixed(1)}ms`)

// 5. 한 곳 요금을 바꿔 다시 공개 → 사용자에게 반영
const changed = structuredClone(data.places)
const target = changed.find((p) => p.price?.adult != null)
const before = target.price.adult
target.price.adult = before + 1000
r = await call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places: changed } })
ok('바뀐 곳만 씀', r.j.upserted === 1, `${r.j.upserted}곳`)
r = await call('GET', '/admin/diff', { admin: true })
ok('diff가 요금 바뀐 곳을 잡음', r.j.counts.changed === 1 && r.j.counts.priceChanged === 1 && r.j.priceChanges[0].after === before + 1000, `${r.j.priceChanges[0].name} ${r.j.priceChanges[0].before}→${r.j.priceChanges[0].after}`)
r = await call('GET', '/api/places')
ok('공개 전에는 사용자 화면이 그대로', r.j.places.find((p) => p.id === target.id).price.adult === before)
r = await call('POST', '/admin/publish', { admin: true })
ok('다시 공개', r.j.to === 2)
r = await call('GET', '/api/places')
ok('공개 뒤 사용자에게 새 요금', r.j.places.find((p) => p.id === target.id).price.adult === before + 1000 && r.res.headers.get('ETag') === '"s2"')

// 6. 되돌리기
r = await call('POST', '/admin/rollback', { admin: true })
ok('되돌리기', r.j.ok && r.j.to === 1)
r = await call('GET', '/api/places')
ok('되돌린 뒤 예전 요금', r.j.places.find((p) => p.id === target.id).price.adult === before)

// 7. 공개 전 검증
const broken = structuredClone(data.places)
broken[0].lat = 0
await call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places: broken } })
r = await call('POST', '/admin/publish', { admin: true })
ok('서울 밖 좌표가 있으면 공개를 막음', r.res.status === 422, r.j.problems[0].slice(0, 40))
const adultName = structuredClone(data.places)
adultName[1].name = '테스트 휴게텔'
await call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places: adultName } })
r = await call('POST', '/admin/publish', { admin: true })
ok('성인업소 키워드 이름이 있으면 막음', r.res.status === 422 && r.j.problems.some((x) => x.includes('성인업소')))
const both = structuredClone(data.places)
const ex = both.find((p) => p.price_example)
ex.price = { ...(ex.price || {}), adult: 9000 }
await call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places: both } })
r = await call('POST', '/admin/publish', { admin: true })
ok('확인 요금과 예시 요금이 같이 있으면 막음', r.res.status === 422 && r.j.problems.some((x) => x.includes('예시')))
await call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places: data.places.slice(0, 300) } })
r = await call('POST', '/admin/publish', { admin: true })
ok('곳 수가 10% 넘게 줄면 막음', r.res.status === 422 && r.j.problems.some((x) => x.includes('10%')))
r = await call('GET', '/api/places')
ok('막힌 동안 사용자 화면은 그대로', r.j.places.length === data.places.length)
await call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places: data.places } })

// 7-2. 예외 상황
const ingest = (places) => call('POST', '/admin/ingest', { admin: true, body: { baseDate: data.baseDate, places } })
const phoneData = structuredClone(data.places)
phoneData[2].price = { ...(phoneData[2].price || {}), memo: '문의 010-1234-5678' }
await ingest(phoneData)
r = await call('POST', '/admin/publish', { admin: true })
ok('휴대폰 번호 모양이 든 칸이 있으면 막음', r.res.status === 422 && r.j.problems.some((x) => x.includes('휴대폰')))
const telData = structuredClone(data.places)
telData[2].tel = '010-1234-5678'
telData[3].tel = '02-123-4567'
await ingest(telData)
r = await call('POST', '/admin/publish', { admin: true, body: { note: 'tel 칸은 검사하지 않음' } })
ok('번호 칸(tel)과 기관 대표번호는 막지 않음', r.res.status === 200 && r.j.ok, `#${r.j.to}`)
const stale = await call('GET', '/admin/status', { admin: true })
r = await call('POST', '/admin/publish', { admin: true, body: { expect: stale.j.active - 1 } })
ok('화면이 본 공개본과 다르면(다른 곳이 먼저 공개) 409로 막음', r.res.status === 409 && r.j.error === 'stale')
r = await call('POST', '/admin/publish', { admin: true, body: { expect: stale.j.active } })
ok('본 공개본이 맞으면 공개됨(내용이 같아도 새 스냅샷)', r.res.status === 200, `#${r.j.to}`)
const huge = structuredClone(data.places)
huge[0].junk = 'x'.repeat(1_250_000) // 원래 약 0.32MB(JSON 압축 크기) + 1.25MB ≈ 1.57MB: 올리기는 되지만(1.8MB 이하) 공개는 막힌다(1.5MB 초과)
await ingest(huge)
r = await call('POST', '/admin/publish', { admin: true })
ok('스냅샷이 1.5MB를 넘으면 공개를 막음', r.res.status === 422 && r.j.problems.some((x) => x.includes('너무 커')))
const tooBig = structuredClone(data.places)
tooBig[0].junk = 'x'.repeat(1_550_000) // 약 0.32MB + 1.55MB ≈ 1.87MB(1.8MB 초과)
r = await ingest(tooBig)
ok('초안이 1.8MB를 넘으면 올리기부터 413', r.res.status === 413)
await ingest(data.places)
await call('POST', '/admin/publish', { admin: true })
const before2 = sqlite.prepare("SELECT v FROM meta WHERE k = 'active_snapshot'").get().v
const brokenDb = { ...DB, batch: async () => { throw new Error('boom') } }
r = await worker.fetch(new Request(BASE + '/admin/publish', { method: 'POST', headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` }, body: '{}' }), { ...env, DB: brokenDb }, ctx)
ok('공개 도중 실패하면 500', r.status === 500)
ok('공개 도중 실패해도 공개 중인 스냅샷은 그대로', sqlite.prepare("SELECT v FROM meta WHERE k = 'active_snapshot'").get().v === before2)
const quotaDb = { prepare() { throw new Error('D1 daily limit exceeded') } }
r = await worker.fetch(new Request(BASE + '/api/places'), { ...env, DB: quotaDb }, ctx)
ok('무료 한도를 넘어 DB가 실패하면 503 quota(화면은 예전 파일로 대체)', r.status === 503 && (await r.json()).error === 'quota')
await ingest(data.places)

// 8. 제보
const p0 = data.places[0]
const good = { placeId: p0.id, placeName: p0.name, adult: 12000, source: '현장 가격표', deviceId: 'dev-1' }
r = await call('POST', '/api/report', { body: good, headers: { Origin: 'http://localhost:5173', 'CF-Connecting-IP': '1.2.3.4' } })
ok('제보 저장', r.j.ok && r.res.headers.get('Access-Control-Allow-Origin') === 'http://localhost:5173')
r = await call('POST', '/api/report', { body: { ...good, memo: '연락 010-1234-5678' }, headers: { 'CF-Connecting-IP': '1.2.3.4' } })
const masked = sqlite.prepare('SELECT memo, flags, who, ip_hash FROM reports ORDER BY id DESC LIMIT 1').get()
ok('메모 속 연락처는 가리고 해시만 저장', masked.memo === '[연락처 의심, 가림]' && masked.flags.includes('연락처') && !masked.ip_hash.includes('1.2.3.4'))
ok('목록에 없는 곳은 거절', (await call('POST', '/api/report', { body: { ...good, placeId: 'nope' } })).res.status === 400)
ok('값이 없으면 거절', (await call('POST', '/api/report', { body: { placeId: p0.id, placeName: p0.name, source: '기타' } })).res.status === 400)
ok('허용 안 한 출처 값은 거절', (await call('POST', '/api/report', { body: { ...good, source: '아무거나' } })).res.status === 400)
for (let i = 0; i < 3; i++) await call('POST', '/api/report', { body: good, headers: { 'CF-Connecting-IP': '1.2.3.4' } })
r = await call('POST', '/api/report', { body: good, headers: { 'CF-Connecting-IP': '1.2.3.4' } })
ok('같은 기기에서 한 시간에 5건 넘으면 429', r.res.status === 429)
r = await call('GET', '/api/places')
ok('제보는 사용자 화면에 바로 반영되지 않음', r.j.places.find((x) => x.id === p0.id).price.adult === p0.price.adult)
r = await call('GET', '/admin/reports?status=new', { admin: true })
ok('관리용 제보 목록', r.j.reports.length === 5, `${r.j.reports.length}건`)
r = await call('POST', `/admin/reports/${r.j.reports[0].id}`, { admin: true, body: { status: 'reviewed', note: '시험' } })
ok('제보 상태 바꾸기', r.j.ok)

// 9. 방문자 수(DAU)
await settle()
sqlite.exec('DELETE FROM visits')
const site = { Origin: 'https://tangbang.vercel.app', 'User-Agent': 'Mozilla/5.0 test', 'CF-Connecting-IP': '5.6.7.8' }
for (let i = 0; i < 3; i++) await call('GET', '/api/places', { headers: site })
await call('GET', '/api/places', { headers: { ...site, 'CF-Connecting-IP': '9.9.9.9' } })
await call('GET', '/api/places', { headers: { ...site, Origin: 'http://localhost:5173' } }) // 개발 화면은 세지 않음
await call('GET', '/api/places', { headers: { 'User-Agent': 'curl', 'CF-Connecting-IP': '1.1.1.1' } }) // 화면 밖 호출은 세지 않음
await call('GET', '/api/places', { headers: { ...site, Origin: 'https://evil.example.com' } }) // 허용 안 한 주소도 세지 않음
await settle()
const vrows = sqlite.prepare('SELECT v, n FROM visits').all()
ok('같은 사람은 하루 1명, 다른 주소는 따로 셈(서비스 화면만)', vrows.length === 2 && vrows.some((x) => x.n === 3), `${vrows.length}명, 횟수 ${vrows.map((x) => x.n).join('·')}`)
ok('방문 기록에 접속 주소 원래 값이 없음', vrows.every((x) => !x.v.includes('5.6.7.8') && x.v.length === 16))
await call('GET', '/api/places', { headers: { ...site, 'If-None-Match': `"s${sqlite.prepare("SELECT v FROM meta WHERE k = 'active_snapshot'").get().v}"` } }) // 304로 끝나도 방문으로 셈
await settle()
sqlite.exec("INSERT INTO visits (day, v, n) VALUES ('2000-01-01', 'old', 1)")
r = await call('GET', '/admin/stats?days=7', { admin: true })
const todayRow = r.j.days[r.j.days.length - 1]
ok('날짜별 방문자 수(오늘 2명, 7일치, 비는 날은 0)', r.j.days.length === 7 && todayRow.visitors === 2 && todayRow.loads === 5 && r.j.days[0].visitors === 0, `${todayRow.day} ${todayRow.visitors}명 ${todayRow.loads}회 제보 ${todayRow.reports}건`)
ok('오늘 제보 수도 같이 셈', todayRow.reports === 5)
ok('90일 넘은 방문 기록은 지움', !sqlite.prepare("SELECT 1 FROM visits WHERE day = '2000-01-01'").get())
const failingVisitDb = { ...DB, prepare: (sql) => (/INSERT INTO visits/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('write fail') } }) } : DB.prepare(sql)) }
const res9 = await worker.fetch(new Request(BASE + '/api/places', { headers: site }), { ...env, DB: failingVisitDb }, ctx)
await settle()
ok('방문 세기가 실패해도 목록은 그대로 받음', res9.status === 200)

// 10. 핵심 행동 세기
sqlite.exec('DELETE FROM events')
const ev = (name, headers = site) => call('POST', '/api/event', { body: undefined, headers: { 'Content-Type': 'text/plain', ...headers }, raw: JSON.stringify({ name }) })
r = await ev('near')
ok('행동 기록은 204로 끝남(CORS 헤더 포함)', r.res.status === 204 && r.res.headers.get('Access-Control-Allow-Origin') === 'https://tangbang.vercel.app')
await ev('near')
await ev('detail')
await ev('near', { ...site, 'CF-Connecting-IP': '9.9.9.9' })
await settle()
const er = sqlite.prepare('SELECT name, count(*) AS users, sum(n) AS total FROM events GROUP BY name ORDER BY name').all()
ok('행동 횟수와 사람 수를 따로 셈', er.find((x) => x.name === 'near').users === 2 && er.find((x) => x.name === 'near').total === 3 && er.find((x) => x.name === 'detail').total === 1, JSON.stringify(er.map((x) => [x.name, x.users, x.total])))
r = await ev('hack_me')
ok('정해진 이름이 아니면 400', r.res.status === 400)
const evRows = sqlite.prepare('SELECT count(*) AS c FROM events').get().c
await ev('near', { ...site, Origin: 'http://localhost:5173' })
await ev('near', { ...site, Origin: 'https://evil.example.com' })
await ev('near', { 'User-Agent': 'curl' })
await settle()
ok('개발 화면·허용 안 한 주소·화면 밖 호출은 세지 않음', sqlite.prepare('SELECT count(*) AS c FROM events').get().c === evRows)
for (let i = 0; i < 210; i++) await ev('fav')
await settle()
ok('한 사람이 같은 행동을 하루 200번까지만 셈', sqlite.prepare("SELECT n FROM events WHERE name = 'fav'").get().n === 200)
sqlite.exec("INSERT INTO events (day, name, v, n) VALUES ('2000-01-01', 'near', 'old', 1)")
r = await call('GET', '/admin/stats?days=7', { admin: true })
ok('통계에 행동별 사람 수·횟수(안 한 행동은 0)', r.j.events.find((x) => x.name === 'near').users === 2 && r.j.events.find((x) => x.name === 'report_done').total === 0 && r.j.events.length === 10)
ok('90일 넘은 행동 기록은 지움', !sqlite.prepare("SELECT 1 FROM events WHERE day = '2000-01-01'").get())

// 11. 매거진
env.EDITOR_TOKEN = 'local-editor-token-abcdefgh'
const ed = (method, p, body, token = env.EDITOR_TOKEN) => call(method, p, { body, headers: { Authorization: `Bearer ${token}`, Origin: 'https://tangbang.vercel.app' } })
// 번호 방식 전에 공개한 글(예전 영문 주소)
sqlite.prepare("INSERT INTO stories (slug, title, category, body, status, published_at, created_at, updated_at) VALUES ('old-story', '예전 글', 'tips', '예전 글 본문입니다. 충분히 길어요.', 'published', '2026-11-08', '2026-11-08', '2026-11-08')").run()
const oldId = sqlite.prepare("SELECT id FROM stories WHERE slug = 'old-story'").get().id
ok('예전 영문 주소로도 열림', (await call('GET', '/api/stories/old-story')).j?.story?.id === oldId)
ok('예전 글도 번호 주소로 열림', (await call('GET', `/api/stories/${oldId}`)).j?.story?.slug === 'old-story')
sqlite.prepare('DELETE FROM stories WHERE id = ?').run(oldId)
const draft = { slug: 'ignored-by-server', title: '수건 한 장이 건네는 것들', category: 'unknown', summary: '요약', body: '첫 문단입니다. 충분히 긴 본문이에요.\n\n> 인용\n\n![사진](https://example.com/a.jpg)', place_ids: [p0.id, p0.id], status: 'draft' }
r = await ed('POST', '/api/editor/stories', draft, 'wrong-token-wrong-token-xx')
ok('편집 토큰이 틀리면 401', r.res.status === 401)
r = await call('POST', '/api/editor/stories', { body: draft, headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } })
ok('관리 토큰으로는 글을 못 씀(편집 토큰만)', r.res.status === 401)
r = await ed('POST', '/api/editor/stories', draft)
const sid = r.j.id
ok('임시 저장하면 서버가 글 번호를 매김', r.j.ok && sid > 0)
ok('주소는 글 번호(보낸 slug는 무시)', sqlite.prepare('SELECT slug FROM stories WHERE id = ?').get(sid).slug === String(sid))
r = await call('GET', '/api/stories')
ok('임시 저장 글은 공개 목록에 없음', r.j.stories.length === 0)
ok('임시 저장 글은 주소로도 안 열림', (await call('GET', `/api/stories/${sid}`)).res.status === 404)
const pubAt0 = sqlite.prepare('SELECT published_at FROM stories WHERE id = ?').get(sid).published_at
r = await ed('POST', '/api/editor/stories', { ...draft, id: sid, status: 'published' })
r = await call('GET', '/api/stories')
ok('공개하면 목록에 나옴(본문 없이, 목욕탕 id 중복 제거)', r.j.stories.length === 1 && !('body' in r.j.stories[0]) && r.j.stories[0].place_ids.length === 1 && r.j.stories[0].published_at && !pubAt0)
const pubAt = r.j.stories[0].published_at
r = await call('GET', `/api/stories/${sid}`)
ok('공개 글은 번호 주소로 본문까지', r.j.story.body.includes('인용'))
await new Promise((res) => setTimeout(res, 5))
await ed('POST', '/api/editor/stories', { ...draft, id: sid, title: '제목을 고침', status: 'published' })
r = await call('GET', `/api/stories/${sid}`)
ok('제목을 고쳐도 주소·공개일은 그대로', r.j.story.title === '제목을 고침' && r.j.story.published_at === pubAt && r.j.story.slug === String(sid))
r = await ed('POST', '/api/editor/stories', { ...draft, id: 99999 })
ok('없는 글 번호를 고치면 404', r.res.status === 404)
r = await ed('POST', '/api/editor/stories', { ...draft, body: '<script>alert(1)</script> 긴 본문 긴 본문 긴 본문', status: 'draft' })
ok('본문의 script 태그는 거절', r.res.status === 422)
r = await ed('POST', '/api/editor/stories', { ...draft, body: draft.body + '\n![x](http://evil.example/a.jpg)' })
ok('사진 주소가 https가 아니면 거절', r.res.status === 422)
r = await ed('POST', '/api/editor/stories', { ...draft })
ok('새 글은 다음 번호', r.j.ok && r.j.id === sid + 1 && sqlite.prepare('SELECT slug FROM stories WHERE id = ?').get(r.j.id).slug === String(sid + 1))
sqlite.prepare('DELETE FROM stories WHERE id = ?').run(r.j.id)
r = await ed('POST', '/api/editor/stories', { ...draft, id: sid, status: 'hidden' })
ok('내리면 공개 목록에서 빠짐', (await call('GET', '/api/stories')).j.stories.length === 0)
r = await ed('GET', '/api/editor/stories')
ok('작성 화면 목록은 모든 상태를 봄', r.j.stories.length === 1 && r.j.stories[0].status === 'hidden')

// 12. 작성 화면 암호 틀린 횟수 제한
const edFrom = (ip, token) => call('GET', '/api/editor/stories', { headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': ip } })
const lefts = []
for (let i = 0; i < 4; i++) lefts.push((await edFrom('1.1.1.1', 'wrong')).j.left)
ok('틀릴 때마다 남은 횟수를 알려 줌', lefts.join(',') === '4,3,2,1', lefts.join(','))
r = await edFrom('1.1.1.1', 'wrong')
ok('같은 곳에서 5번 틀리면 잠금(429, 남은 초)', r.res.status === 429 && r.j.error === 'locked' && r.j.retry > 800 && r.res.headers.get('Retry-After'))
r = await edFrom('1.1.1.1', env.EDITOR_TOKEN)
ok('잠긴 동안은 맞는 암호도 받지 않음', r.res.status === 429)
r = await edFrom('2.2.2.2', env.EDITOR_TOKEN)
ok('다른 곳은 잠기지 않음', r.res.status === 200)
ok('접속 주소는 해시로만 저장', !sqlite.prepare("SELECT 1 FROM auth_fails WHERE k LIKE '%1.1.1.1%'").get())
sqlite.prepare("UPDATE auth_fails SET first_at = first_at - 3600000, locked_until = 1 WHERE k != 'all'").run()
r = await edFrom('1.1.1.1', env.EDITOR_TOKEN)
ok('잠금 시간이 지나면 다시 들어가짐', r.res.status === 200)
r = await edFrom('1.1.1.1', 'wrong')
ok('맞히면 그곳의 틀린 횟수는 처음부터', r.j.left === 4)
sqlite.exec('DELETE FROM auth_fails')
for (let i = 0; i < 30; i++) await edFrom(`10.0.0.${i}`, 'wrong')
r = await edFrom('3.3.3.3', env.EDITOR_TOKEN)
ok('전체에서 1시간에 30번 틀리면 모두 잠금(여러 곳에서 나눠 맞혀 보기 방지)', r.res.status === 429)
sqlite.exec('DELETE FROM auth_fails')

// 13. 매거진 사진 올리기·읽기. R2는 Map 기반 가짜 객체(put/get)로 흉내 낸다. 실제 R2·Cloudflare 한도는 확인하지 못한다
const r2 = new Map()
let r2Gets = 0
env.tangbang_photos = {
  async put(key, value, opts) {
    r2.set(key, { bytes: new Uint8Array(value), httpMetadata: opts?.httpMetadata ?? {} })
  },
  async get(key) {
    r2Gets++
    const o = r2.get(key)
    return o ? { body: new Blob([o.bytes]).stream(), httpMetadata: o.httpMetadata } : null
  },
}
const JPG = [0xff, 0xd8, 0xff, 0xe0]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
const GIF = [...'GIF89a'].map((c) => c.charCodeAt(0))
const MB5 = 5 * 1024 * 1024
const fill = (head, total) => {
  const b = new Uint8Array(total)
  b.set(head)
  for (let i = head.length; i < total; i++) b[i] = i & 255
  return b
}
const upload = (bytes, { name = 'a.jpg', type = 'image/jpeg', field = 'file', token = env.EDITOR_TOKEN, ip = '20.0.0.1' } = {}) => {
  const fd = new FormData()
  fd.append(field, new File([bytes], name, { type }))
  return call('POST', '/api/editor/photos', { raw: fd, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'CF-Connecting-IP': ip, Origin: 'https://tangbang.vercel.app' } })
}
sqlite.exec('DELETE FROM auth_fails')
r = await upload(fill(JPG, 100), { token: '', ip: '21.0.0.1' })
ok('사진 올리기: 편집 토큰이 없으면 401', r.res.status === 401 && r.j.error === 'auth' && r2.size === 0)
const photoLefts = []
for (let i = 0; i < 2; i++) photoLefts.push((await upload(fill(JPG, 100), { token: 'wrong-token', ip: '22.0.0.1' })).j.left)
ok('사진 올리기: 틀린 토큰은 401이고 남은 횟수가 줄어듦(글 저장과 같은 횟수 제한)', photoLefts.join(',') === '4,3', photoLefts.join(','))
r = await upload(fill(JPG, 100), { token: env.ADMIN_TOKEN, ip: '23.0.0.1' })
ok('사진 올리기: 관리 토큰으로는 못 올림(편집 토큰만)', r.res.status === 401 && r2.size === 0)
for (let i = 0; i < 3; i++) await upload(fill(JPG, 100), { token: 'wrong-token', ip: '22.0.0.1' })
r = await upload(fill(JPG, 100), { token: 'wrong-token', ip: '22.0.0.1' })
ok('사진 올리기: 5번 틀리면 잠금(429, 남은 초)', r.res.status === 429 && r.j.error === 'locked' && r.j.retry > 800 && r.res.headers.get('Retry-After'))
r = await upload(fill(JPG, 100), { ip: '22.0.0.1' })
ok('사진 올리기: 잠긴 동안은 맞는 암호도 받지 않음', r.res.status === 429 && r2.size === 0)
sqlite.exec('DELETE FROM auth_fails')

r = await upload(fill(GIF, 100), { name: 'a.jpg', type: 'image/jpeg' })
ok('사진 올리기: 확장자·Content-Type이 jpg여도 실제 GIF면 415', r.res.status === 415 && r.j.error === 'type' && r2.size === 0)
r = await upload(new TextEncoder().encode('<html><script>alert(1)</script></html>'), { name: 'x.png', type: 'image/png' })
ok('사진 올리기: HTML을 png로 속여도 415', r.res.status === 415 && r2.size === 0)
r = await upload(fill([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 100), { name: 'a.webp', type: 'image/webp' })
ok('사진 올리기: RIFF라도 WEBP가 아니면(WAVE) 415', r.res.status === 415 && r2.size === 0)
r = await upload(fill(JPG, MB5 + 1))
ok('사진 올리기: 5MB를 1바이트라도 넘으면 413', r.res.status === 413 && r.j.error === 'too-big' && r2.size === 0)
r = await upload(fill(JPG, MB5 + 200 * 1024))
ok('사진 올리기: 본문이 5MB+멀티파트 여유(64KB)를 넘으면 413', r.res.status === 413 && r2.size === 0)
r = await upload(fill(GIF, MB5 + 1))
ok('사진 올리기: 크기가 형식보다 먼저(큰 GIF도 413)', r.res.status === 413)
r = await upload(fill(JPG, 100), { field: 'photo' })
ok('사진 올리기: file 칸이 없으면 400', r.res.status === 400 && r.j.error === 'file' && r2.size === 0)
r = await upload(new Uint8Array(0))
ok('사진 올리기: 빈 파일은 400', r.res.status === 400 && r2.size === 0)
r = await call('POST', '/api/editor/photos', { body: { file: 'x' }, headers: { Authorization: `Bearer ${env.EDITOR_TOKEN}` } })
ok('사진 올리기: multipart가 아니면 400', r.res.status === 400 && r.j.error === 'body')
r = await worker.fetch(new Request(BASE + '/api/editor/photos', { method: 'POST', headers: { Authorization: `Bearer ${env.EDITOR_TOKEN}`, 'Content-Type': 'multipart/form-data; boundary=zzz' }, body: 'garbage' }), env, ctx)
ok('사진 올리기: 깨진 multipart는 400', r.status === 400 && r2.size === 0)
r = await worker.fetch(new Request(BASE + '/api/editor/photos', { method: 'POST', headers: { Authorization: `Bearer ${env.EDITOR_TOKEN}` }, body: new FormData() }), { ...env, tangbang_photos: undefined }, ctx)
ok('사진 올리기: R2 연결이 없으면 503 not-ready', r.status === 503 && (await r.json()).error === 'not-ready')

const jpgBytes = fill(JPG, 3000)
r = await upload(jpgBytes, { name: '../../내 사진 (1).png', type: 'image/png' })
const photoUrl = r.j?.url
const photoKey = photoUrl?.split('/api/photos/')[1]
ok('사진 올리기: 정상(실제 형식은 JPEG, 파일 이름은 PNG라고 해도)', r.res.status === 200 && r.j.ok && photoUrl.startsWith(`${BASE}/api/photos/`) && photoUrl.startsWith('https://'), photoKey)
ok('저장 키는 UUID + 실제 형식 확장자(사용자 파일 이름 없음)', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/.test(photoKey) && !photoKey.includes('png') && r2.size === 1)
ok('R2에 Content-Type이 실제 형식으로 저장됨', r2.get(photoKey).httpMetadata.contentType === 'image/jpeg')
ok('업로드 응답에 CORS 허용(작성 화면 주소)', r.res.headers.get('Access-Control-Allow-Origin') === 'https://tangbang.vercel.app')
r = await call('GET', new URL(photoUrl).pathname)
ok('같은 주소로 GET 200(토큰 없이 공개 읽기)', r.res.status === 200)
ok('읽기: Content-Type은 저장할 때 형식', r.res.headers.get('Content-Type') === 'image/jpeg')
ok('읽기: 1년 캐시(immutable)와 nosniff', r.res.headers.get('Cache-Control') === 'public, max-age=31536000, immutable' && r.res.headers.get('X-Content-Type-Options') === 'nosniff')
const back = new Uint8Array(await (await worker.fetch(new Request(photoUrl), env, ctx)).arrayBuffer())
ok('읽은 바이트가 올린 것과 같음', back.length === jpgBytes.length && back.every((v, i) => v === jpgBytes[i]), `${back.length}바이트`)
r = await upload(fill(PNG, 500), { name: 'a.png', type: 'image/png' })
const pngRes = await worker.fetch(new Request(r.j.url), env, ctx)
ok('PNG도 올라가고 image/png로 읽힘', r.res.status === 200 && r.j.url.endsWith('.png') && pngRes.headers.get('Content-Type') === 'image/png')
r = await upload(fill(WEBP, 500), { name: 'a.webp', type: 'image/webp' })
const webpRes = await worker.fetch(new Request(r.j.url), env, ctx)
ok('WebP도 올라가고 image/webp로 읽힘', r.res.status === 200 && r.j.url.endsWith('.webp') && webpRes.headers.get('Content-Type') === 'image/webp')
r = await upload(fill(JPG, MB5))
ok('정확히 5MB는 올라감(경계)', r.res.status === 200 && r.j.ok)
r = await call('GET', '/api/photos/00000000-0000-4000-8000-000000000000.jpg')
ok('읽기: 없는 키는 404', r.res.status === 404 && r.j.error === 'not-found')
const badKeys = ['abc.jpg', '..%2Fsecret', 'a b.jpg', `${photoKey.replace('.jpg', '.gif')}`, photoKey.slice(0, -4), photoKey.toUpperCase()]
const getsBefore = r2Gets
const badRes = await Promise.all(badKeys.map((k) => call('GET', `/api/photos/${k}`)))
r = await call('GET', '/api/photos/a/b.jpg')
ok('읽기: 키 형식이 맞지 않거나 경로가 더 깊으면 404(R2를 부르지 않음)', badRes.every((x) => x.res.status === 404) && r.res.status === 404 && r2Gets === getsBefore, `${badKeys.length + 1}가지`)
r = await worker.fetch(new Request(photoUrl), { ...env, tangbang_photos: undefined }, ctx)
ok('읽기: R2 연결이 없으면 503', r.status === 503)
ok('사진 올리기는 편집 토큰 관문 뒤에서만 일어남(실패 요청은 R2에 아무것도 안 씀)', r2.size === 4, `R2 ${r2.size}개`)
sqlite.exec('DELETE FROM auth_fails')

r = await call('GET', '/admin/status', { admin: true })
ok('상태에 오늘·어제 방문자 수', r.j.visitors.today === 2 && r.j.visitors.yesterday === 0, `오늘 ${r.j.visitors.today}명`)
ok('상태 조회', r.j.active === Number(sqlite.prepare("SELECT v FROM meta WHERE k = 'active_snapshot'").get().v) && r.j.draft.count === data.places.length, `공개 #${r.j.active}, 스냅샷 ${r.j.snapshots.length}개`)

console.log(`\n모두 통과: ${pass}개`)
