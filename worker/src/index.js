// 탕방 데이터 API (Cloudflare Worker + D1). 화면은 Vercel 그대로, 데이터·제보만 여기서 맡는다.
// 공개용:  GET  /api/places   공개 스냅샷(onsen.json과 같은 모양 + publishedAt)
//          POST /api/report   제보 받기(화면에 바로 반영하지 않음)
// 관리용(Authorization: Bearer ADMIN_TOKEN, 수집 PC의 scripts/d1_publish.mjs만 부른다):
//          GET  /admin/status · POST /admin/ingest · GET /admin/diff · POST /admin/publish · POST /admin/rollback
//          GET  /admin/reports?status=new · POST /admin/reports/<id>
// 원칙: 사용자 요청마다 큰 JSON을 만들지 않는다(무료 Worker는 요청당 CPU 10ms). 공개 때 SQL이 본문을 만들어 한 행에 둔다.

const KEEP_SNAPSHOTS = 30
const MAX_SNAPSHOT = 1_500_000 // 스냅샷 본문 상한(D1 한 행 한도 2MB의 3/4). 넘으면 공개를 막는다
const MAX_INGEST = 1_800_000 // 한 번에 올릴 수 있는 초안 크기
const DROP_LIMIT = 0.1// 직전 공개본보다 곳 수가 10% 넘게 줄면 공개를 막는다(--force로만 통과)
const ADULT = ['휴게텔', '안마', '건마', '스웨디시', '키스방', '대딸', '유흥', '룸살롱', '단란', '노래빠', '성인', '립카페'] // src/naver.rs ADULT_NAME과 같게

// 제보 규칙: web/api/report.js와 같게
const SOURCES = ['현장 가격표', '직접 냈어요', '공식 홈페이지·네이버', '기타']
const TOWEL = ['무제한', '1장', '2장', '3장 이상']
const DRYER = ['무료', '유료', '없음']
const PAY = ['현금만', '카드 가능']
const MAX_WON = 200000
const RANGE = { adult: [3000, 30000], towel: [0, 5000], scrub: [5000, 60000] }
const LIMIT_WHO_HOUR = 5
const LIMIT_IP_DAY = 30
const contact = /\d[\d\s-]{7,}\d|https?:|www\.|@/i

const now = () => new Date().toISOString()
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin')
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (origin && allowed.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Expose-Headers': 'ETag',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }
  }
  return { Vary: 'Origin' }
}

async function sha(v) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function authorized(req, env) {
  const want = env.ADMIN_TOKEN
  const got = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!want || got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

const activeId = async (db) => {
  const r = await db.prepare("SELECT v FROM meta WHERE k = 'active_snapshot'").first()
  return r ? Number(r.v) : null
}

// ───────── 공개용 ─────────

async function getPlaces(req, env, ctx, cors) {
  const id = await activeId(env.DB)
  if (!id) return json({ ok: false, error: 'not-published' }, 503, cors)
  const etag = `"s${id}"`
  const head = { ETag: etag, 'Cache-Control': 'public, max-age=60', ...cors }
  // Cloudflare가 압축하면서 ETag 앞에 W/를 붙여 돌려주므로 비교할 때 뗀다
  const inm = (req.headers.get('If-None-Match') || '').split(',').map((s) => s.trim().replace(/^W\//, ''))
  if (inm.includes(etag)) return new Response(null, { status: 304, headers: head })
  // 스냅샷 본문은 id별로 바뀌지 않으므로 Cloudflare 캐시에 id를 열쇠로 둔다(공개하면 id가 바뀌어 바로 새 것을 읽는다)
  const key = new Request(`https://snapshot.tangbang.invalid/${id}`)
  const cache = caches.default
  let body
  const hit = await cache.match(key)
  if (hit) body = await hit.text()
  else {
    const row = await env.DB.prepare('SELECT body FROM snapshots WHERE id = ?').bind(id).first()
    if (!row) return json({ ok: false, error: 'not-published' }, 503, cors)
    body = row.body
    ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'Cache-Control': 'public, max-age=86400' } })))
  }
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...head } })
}

const won = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= MAX_WON ? n : NaN
}
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const pick = (list, v) => (list.includes(v) ? v : '')

async function postReport(req, env, cors) {
  if (!env.REPORT_SALT) return json({ ok: false, error: 'not-ready' }, 503, cors)
  let b
  try {
    b = await req.json()
  } catch {
    return json({ ok: false, error: 'body' }, 400, cors)
  }
  if (!b || typeof b !== 'object') return json({ ok: false, error: 'body' }, 400, cors)
  if (b.hp) return json({ ok: true }, 200, cors) // 숨은 칸이 채워져 있으면 자동 입력이라 조용히 버린다

  const placeId = text(b.placeId, 40)
  let placeName = text(b.placeName, 80)
  const adult = won(b.adult)
  const towel = won(b.towel)
  const scrub = won(b.scrub)
  const source = SOURCES.includes(b.source) ? b.source : ''
  const towelInfo = pick(TOWEL, b.towelInfo)
  const dryW = pick(DRYER, b.hairdryerW)
  const dryM = pick(DRYER, b.hairdryerM)
  const hairdryer = [dryW && `여탕 ${dryW}`, dryM && `남탕 ${dryM}`].filter(Boolean).join(' · ') || pick(DRYER, b.hairdryer)
  const seshinPay = pick(PAY, b.seshinPay)
  let memo = text(b.memo, 100)
  if (!placeId || !placeName) return json({ ok: false, error: 'place' }, 400, cors)
  if ([adult, towel, scrub].some(Number.isNaN)) return json({ ok: false, error: 'price' }, 400, cors)
  if (adult == null && towel == null && scrub == null && !towelInfo && !hairdryer && !seshinPay) return json({ ok: false, error: 'empty' }, 400, cors)
  if (!source) return json({ ok: false, error: 'source' }, 400, cors)

  const place = await env.DB.prepare("SELECT json_extract(body, '$.name') AS name FROM places WHERE id = ?").bind(placeId).first()
  if (!place) return json({ ok: false, error: 'place' }, 400, cors) // 목록에 없는 업체
  const flags = []
  if (place.name !== placeName) flags.push('이름 불일치')
  placeName = place.name // 이름은 서버 목록 기준으로 기록한다
  for (const [k, label] of [['adult', '입장료'], ['towel', '수건'], ['scrub', '세신']]) {
    const v = { adult, towel, scrub }[k]
    if (v != null && (v < RANGE[k][0] || v > RANGE[k][1])) flags.push(`${label} 이상값`)
  }
  if (contact.test(memo)) {
    flags.push('연락처 의심')
    memo = '[연락처 의심, 가림]' // 개인 연락처는 저장하지 않는다
  }

  // 기기 ID와 접속 주소는 해시로만 남긴다(원래 값은 저장하지 않는다)
  const ip = req.headers.get('CF-Connecting-IP') || ''
  const deviceId = text(b.deviceId, 64)
  const who = await sha(`${deviceId ? `device:${deviceId}` : `ip:${ip}`}|${env.REPORT_SALT}`)
  const ipHash = await sha(`ip:${ip}|${env.REPORT_SALT}`)
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const dayAgo = new Date(Date.now() - 86400_000).toISOString()
  const c = await env.DB.prepare(
    'SELECT (SELECT count(*) FROM reports WHERE who = ?1 AND created_at > ?2) AS w, (SELECT count(*) FROM reports WHERE ip_hash = ?3 AND created_at > ?4) AS i',
  )
    .bind(who, hourAgo, ipHash, dayAgo)
    .first()
  if (c.w >= LIMIT_WHO_HOUR || c.i >= LIMIT_IP_DAY) return json({ ok: false, error: 'limit' }, 429, cors)

  await env.DB.prepare(
    'INSERT INTO reports (created_at, place_id, place_name, adult, towel, scrub, source, memo, towel_info, hairdryer, seshin_pay, flags, who, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)',
  )
    .bind(now(), placeId, placeName, adult, towel, scrub, source, memo, towelInfo, hairdryer, seshinPay, flags.join(', '), who, ipHash)
    .run()
  return json({ ok: true }, 200, cors)
}

// ───────── 관리용 ─────────

async function status(env) {
  const db = env.DB
  const id = await activeId(db)
  const [draft, base, reports, snaps] = await Promise.all([
    db.prepare('SELECT count(*) AS n, max(updated_at) AS at FROM places').first(),
    db.prepare("SELECT v FROM meta WHERE k = 'draft_base_date'").first(),
    db.prepare("SELECT count(*) AS n FROM reports WHERE status = 'new'").first(),
    db.prepare('SELECT id, place_count, created_at, note FROM snapshots ORDER BY id DESC LIMIT 10').all(),
  ])
  return json({ ok: true, active: id, draft: { count: draft.n, updatedAt: draft.at, baseDate: base?.v ?? null }, newReports: reports.n, snapshots: snaps.results })
}

async function ingest(req, env) {
  let b
  try {
    b = await req.json()
  } catch {
    return json({ ok: false, error: 'body' }, 400)
  }
  const places = b?.places
  if (!Array.isArray(places) || places.length === 0) return json({ ok: false, error: 'places' }, 400)
  if (places.some((p) => !p || typeof p !== 'object' || !p.id)) return json({ ok: false, error: 'id' }, 400)
  const ids = new Set(places.map((p) => String(p.id)))
  if (ids.size !== places.length) return json({ ok: false, error: 'duplicate-id' }, 400)
  const arr = JSON.stringify(places)
  if (arr.length > MAX_INGEST) return json({ ok: false, error: 'too-big' }, 413)
  const at = now()
  // 바뀐 곳만 쓴다(무료 쓰기 한도 하루 10만 행). JSON 펼치기는 DB(SQL) 안에서 한다
  const res = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO places (id, ord, body, updated_at)
       SELECT CAST(json_extract(value, '$.id') AS TEXT), key, json(value), ?2 FROM json_each(?1) WHERE true
       ON CONFLICT(id) DO UPDATE SET ord = excluded.ord, body = excluded.body, updated_at = excluded.updated_at
       WHERE places.body IS NOT excluded.body OR places.ord IS NOT excluded.ord`,
    ).bind(arr, at),
    env.DB.prepare(`DELETE FROM places WHERE id NOT IN (SELECT CAST(json_extract(value, '$.id') AS TEXT) FROM json_each(?1))`).bind(arr),
    env.DB.prepare(`INSERT INTO meta (k, v) VALUES ('draft_base_date', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).bind(String(b.baseDate ?? '')),
  ])
  return json({ ok: true, received: places.length, upserted: res[0].meta.changes, deleted: res[1].meta.changes })
}

async function diff(env) {
  const db = env.DB
  const id = await activeId(db)
  const live = `WITH s AS (SELECT CAST(json_extract(value, '$.id') AS TEXT) AS id, json(value) AS body FROM json_each(coalesce((SELECT body FROM snapshots WHERE id = ?1), '{"places":[]}'), '$.places'))`
  const names = (where) => db.prepare(`${live} SELECT json_extract(p.body, '$.name') AS name FROM places p ${where} ORDER BY p.ord LIMIT 30`).bind(id)
  const [counts, added, removed, changed, price] = await Promise.all([
    db
      .prepare(
        `${live} SELECT (SELECT count(*) FROM places) AS draft, (SELECT count(*) FROM s) AS live,
          (SELECT count(*) FROM places p WHERE p.id NOT IN (SELECT id FROM s)) AS added,
          (SELECT count(*) FROM s WHERE s.id NOT IN (SELECT id FROM places)) AS removed,
          (SELECT count(*) FROM places p JOIN s ON s.id = p.id WHERE s.body IS NOT p.body) AS changed,
          (SELECT count(*) FROM places p JOIN s ON s.id = p.id WHERE json_extract(s.body, '$.price.adult') IS NOT json_extract(p.body, '$.price.adult')) AS priceChanged`,
      )
      .bind(id)
      .first(),
    names('WHERE p.id NOT IN (SELECT id FROM s)').all(),
    db.prepare(`${live} SELECT json_extract(body, '$.name') AS name FROM s WHERE id NOT IN (SELECT id FROM places) LIMIT 30`).bind(id).all(),
    names('JOIN s ON s.id = p.id WHERE s.body IS NOT p.body').all(),
    db
      .prepare(
        `${live} SELECT json_extract(p.body, '$.name') AS name, json_extract(s.body, '$.price.adult') AS before, json_extract(p.body, '$.price.adult') AS after
         FROM places p JOIN s ON s.id = p.id WHERE json_extract(s.body, '$.price.adult') IS NOT json_extract(p.body, '$.price.adult') ORDER BY p.ord LIMIT 30`,
      )
      .bind(id)
      .all(),
  ])
  const v = (r) => r.results.map((x) => x.name)
  return json({ ok: true, active: id, counts, added: v(added), removed: v(removed), changed: v(changed), priceChanges: price.results })
}

// 공개 전 자동 검증. 문제가 있으면 이유 목록을 돌려준다(빈 목록 = 통과)
async function validate(env, force) {
  const db = env.DB
  const problems = []
  const [count, bad, adult, example, prev] = await Promise.all([
    db.prepare('SELECT count(*) AS n FROM places').first(),
    db
      .prepare(
        `SELECT json_extract(body, '$.name') AS name FROM places WHERE coalesce(json_extract(body, '$.name'), '') = '' OR coalesce(json_extract(body, '$.gu'), '') = ''
         OR coalesce(json_extract(body, '$.kind'), '') = '' OR json_extract(body, '$.lat') IS NULL OR json_extract(body, '$.lng') IS NULL
         OR json_extract(body, '$.lat') NOT BETWEEN 33 AND 39 OR json_extract(body, '$.lng') NOT BETWEEN 124 AND 132 LIMIT 20`,
      )
      .all(),
    db.prepare(`SELECT json_extract(body, '$.name') AS name FROM places WHERE ${ADULT.map(() => "json_extract(body, '$.name') LIKE ?").join(' OR ')} LIMIT 20`).bind(...ADULT.map((w) => `%${w}%`)).all(),
    db.prepare(`SELECT json_extract(body, '$.name') AS name FROM places WHERE json_extract(body, '$.price.adult') IS NOT NULL AND json_extract(body, '$.price_example') IS NOT NULL LIMIT 20`).all(),
    db.prepare("SELECT place_count AS n FROM snapshots WHERE id = (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'active_snapshot')").first(),
  ])
  // 휴대폰 번호 모양(010-1234-5678, 01012345678)이 든 칸은 막는다. 기관 대표번호(02-…)와 번호 칸(tel)·주소·이름은 검사하지 않는다
  const phone = await db
    .prepare(
      `SELECT DISTINCT json_extract(p.body, '$.name') AS name FROM places p, json_tree(p.body) t
       WHERE t.type = 'text' AND t.atom NOT LIKE 'http%' AND coalesce(t.key, '') NOT IN ('tel', 'url', 'id', 'addr', 'checked_at', 'name')
         AND (t.atom GLOB '*01[016789]-[0-9][0-9][0-9]*-[0-9][0-9][0-9][0-9]*' OR t.atom GLOB '*01[016789][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*') LIMIT 20`,
    )
    .all()
  const size = await db.prepare('SELECT coalesce(sum(length(body)), 0) AS n FROM places').first()
  if (phone.results.length) problems.push(`휴대폰 번호 모양이 든 곳: ${phone.results.map((x) => x.name).join(', ')}`)
  if (size.n > MAX_SNAPSHOT) problems.push(`스냅샷이 너무 커요(${Math.round(size.n / 1000)}KB, 한도 ${MAX_SNAPSHOT / 1000}KB). D1 한 행은 2MB까지라 R2 같은 파일 저장소로 옮길지 정해야 해요`)
  if (!count.n) problems.push('초안이 비어 있어요')
  if (bad.results.length) problems.push(`필수 칸(이름·구·종류·좌표)이 비었거나 서울 밖 좌표: ${bad.results.map((x) => x.name || '(이름 없음)').join(', ')}`)
  if (adult.results.length) problems.push(`성인업소 키워드가 든 이름: ${adult.results.map((x) => x.name).join(', ')}`)
  if (example.results.length) problems.push(`확인 요금과 예시 요금이 함께 있음: ${example.results.map((x) => x.name).join(', ')}`)
  if (prev && count.n < prev.n * (1 - DROP_LIMIT) && !force) problems.push(`곳 수가 직전 공개본 ${prev.n}곳에서 ${count.n}곳으로 10% 넘게 줄었어요(맞다면 --force)`)
  return { problems, count: count.n }
}

async function publish(req, env) {
  const b = await req.json().catch(() => ({}))
  const db = env.DB
  const from = await activeId(db)
  // 화면(수집 프로그램)이 마지막으로 본 공개본과 지금 공개본이 다르면 막는다: 다른 PC가 먼저 공개했거나 오래된 상태로 덮어쓰는 일 방지
  if (b.expect !== undefined && b.expect !== null && Number(b.expect) !== (from ?? 0)) return json({ ok: false, error: 'stale', active: from }, 409)
  const { problems, count } = await validate(env, !!b.force)
  if (problems.length) return json({ ok: false, error: 'validation', problems }, 422)
  const at = now()
  const note = text(b.note, 200) || null
  // 스냅샷 만들기 + 공개 포인터 바꾸기 + 기록 + 오래된 스냅샷 정리를 한 묶음(트랜잭션)으로 한다. 중간에 실패하면 전부 취소돼 쓰다 만 공개본이 남지 않는다.
  // 본문은 SQL이 만든다(Worker CPU를 쓰지 않음). onsen.json과 같은 모양 + publishedAt
  await db.batch([
    db
      .prepare(
        `INSERT INTO snapshots (body, place_count, created_at, note)
         SELECT json_object('baseDate', (SELECT v FROM meta WHERE k = 'draft_base_date'), 'publishedAt', ?1,
           'places', json((SELECT json_group_array(json(body)) FROM (SELECT body FROM places ORDER BY ord)))),
           (SELECT count(*) FROM places), ?1, ?2`,
      )
      .bind(at, note),
    db.prepare(`INSERT INTO meta (k, v) VALUES ('active_snapshot', CAST(last_insert_rowid() AS TEXT)) ON CONFLICT(k) DO UPDATE SET v = excluded.v`),
    db
      .prepare(`INSERT INTO publish_log (at, action, from_id, to_id, summary) VALUES (?1, 'publish', ?2, (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'active_snapshot'), ?3)`)
      .bind(at, from, `${count}곳${note ? ` · ${note}` : ''}`),
    db.prepare(`DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ${KEEP_SNAPSHOTS})`),
  ])
  const to = await activeId(db)
  return json({ ok: true, from, to, count })
}

async function rollback(req, env) {
  const b = await req.json().catch(() => ({}))
  const db = env.DB
  const from = await activeId(db)
  if (!from) return json({ ok: false, error: 'not-published' }, 409)
  const target = b.to
    ? await db.prepare('SELECT id FROM snapshots WHERE id = ?').bind(Number(b.to)).first()
    : await db.prepare('SELECT id FROM snapshots WHERE id < ? ORDER BY id DESC LIMIT 1').bind(from).first()
  if (!target) return json({ ok: false, error: 'no-snapshot' }, 404)
  await db.batch([
    db.prepare(`INSERT INTO meta (k, v) VALUES ('active_snapshot', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).bind(String(target.id)),
    db.prepare('INSERT INTO publish_log (at, action, from_id, to_id, summary) VALUES (?1, ?2, ?3, ?4, ?5)').bind(now(), 'rollback', from, target.id, ''),
  ])
  return json({ ok: true, from, to: target.id })
}

async function listReports(url, env) {
  const st = url.searchParams.get('status') || 'new'
  const r = await env.DB.prepare(
    'SELECT id, created_at, place_id, place_name, adult, towel, scrub, source, memo, towel_info, hairdryer, seshin_pay, flags, status, note FROM reports WHERE status = ? ORDER BY id DESC LIMIT 200',
  )
    .bind(st)
    .all()
  return json({ ok: true, reports: r.results })
}

async function setReport(req, env, id) {
  const b = await req.json().catch(() => ({}))
  if (!['new', 'reviewed', 'applied', 'rejected'].includes(b.status)) return json({ ok: false, error: 'status' }, 400)
  const r = await env.DB.prepare('UPDATE reports SET status = ?1, note = ?2, reviewed_at = ?3 WHERE id = ?4').bind(b.status, text(b.note, 200) || null, now(), id).run()
  return json({ ok: r.meta.changes === 1 })
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    try {
      if (path.startsWith('/api/')) {
        const cors = corsHeaders(req, env)
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
        if (path === '/api/places' && req.method === 'GET') return await getPlaces(req, env, ctx, cors)
        if (path === '/api/report' && req.method === 'POST') return await postReport(req, env, cors)
        if (path === '/api/health') return json({ ok: true }, 200, cors)
        return json({ ok: false, error: 'not-found' }, 404, cors)
      }
      if (path.startsWith('/admin/')) {
        if (!env.ADMIN_TOKEN) return json({ ok: false, error: 'not-ready' }, 503)
        if (!authorized(req, env)) return json({ ok: false, error: 'auth' }, 401)
        if (path === '/admin/status' && req.method === 'GET') return await status(env)
        if (path === '/admin/ingest' && req.method === 'POST') return await ingest(req, env)
        if (path === '/admin/diff' && req.method === 'GET') return await diff(env)
        if (path === '/admin/publish' && req.method === 'POST') return await publish(req, env)
        if (path === '/admin/rollback' && req.method === 'POST') return await rollback(req, env)
        if (path === '/admin/reports' && req.method === 'GET') return await listReports(url, env)
        const m = /^\/admin\/reports\/(\d+)$/.exec(path)
        if (m && req.method === 'POST') return await setReport(req, env, Number(m[1]))
        return json({ ok: false, error: 'not-found' }, 404)
      }
      return json({ ok: false, error: 'not-found' }, 404)
    } catch (e) {
      // 오류 내용(쿼리·값)은 밖으로 내보내지 않는다
      const msg = String(e?.message || e)
      console.error(msg)
      // D1·Workers 무료 한도를 넘으면 쿼리가 실패한다 → 화면이 이유를 알 수 있게 따로 알린다
      if (/daily|limit|quota|exceeded/i.test(msg)) return json({ ok: false, error: 'quota' }, 503)
      return json({ ok: false, error: 'server' }, 500)
    }
  },
}
