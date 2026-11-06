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
const ctx = { waitUntil: (p) => p }
const BASE = 'https://tangbang-api.example.workers.dev'
const call = async (method, p, { body, admin, headers = {} } = {}) => {
  const req = new Request(BASE + p, {
    method,
    headers: { ...(admin ? { Authorization: `Bearer ${env.ADMIN_TOKEN}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
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

r = await call('GET', '/admin/status', { admin: true })
ok('상태 조회', r.j.active === 1 && r.j.draft.count === data.places.length, `공개 #${r.j.active}, 스냅샷 ${r.j.snapshots.length}개`)

console.log(`\n모두 통과: ${pass}개`)
