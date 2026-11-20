// 탕방 도구함: 측근에게만 수집 프로그램·제보함 설치 파일을 나눠 주고, 앱이 새 버전을 알 수 있게 한다.
//
// 사람(브라우저)
//   GET  /                      로그인 안 됐으면 비밀번호 화면, 됐으면 도구함 화면
//   POST /api/login {code}      비밀번호 확인 → 쿠키(30일). 틀린 횟수 제한(접속 주소별 5회/15분, 전체 30회/1시간)
//   POST /api/me {name}         프로필 이름 정하기(받은 기록에 남는 이름) · POST /api/logout
//   GET  /api/catalog           프로그램별 최신 버전·지난 버전·바뀐 점(로그인 필요)
//   GET  /api/file/{app}/{ver}/{name}   설치 파일 받기(로그인 또는 업데이트 열쇠)
// 앱(업데이트 확인, 헤더 X-Update-Key: UPDATE_KEY)
//   GET  /api/update/{app}/{target}/{arch}/{current}   Tauri 업데이터 형식. 새 버전이 없으면 204
// GitHub Actions(헤더 Authorization: Bearer RELEASE_TOKEN)
//   PUT  /api/release/{app}/{ver}/files/{name}   설치 파일 올리기(SHA-256은 서버가 계산해 붙인다)
//   PUT  /api/release/{app}/{ver}/manifest       버전 정보(바뀐 점·파일 목록·업데이트 서명) 올리기 → 최신이면 latest로
//
// 비밀번호(DOWNLOAD_CODE)는 숫자 4~10자리. 바꾸면 그전 로그인 쿠키는 모두 풀린다.
import PAGE from './page.html'
import COLORS from '../../web/src/styles/tangbang-colors.css'
import MOTION from '../../web/src/styles/motion.css'
import LOGO from '../../web/src/assets/onsen-logo-sheep/character-sheep.svg'

export const APPS = {
  collector: { title: '수집 프로그램', desc: '네이버 후기·블로그를 모아 목욕탕 정보를 판정하고, 서비스 데이터를 만드는 데스크톱 앱' },
  'report-desk': { title: '제보함', desc: '사이트로 들어온 제보를 근거와 맞춰 보고, 확인한 값만 반영해 내보내는 프로그램' },
}
const APP_RE = /^(collector|report-desk)$/
const VER_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/
const NAME_RE = /^[A-Za-z0-9._-]{1,120}$/ // 파일 이름: 경로 문자·한글 없이(GitHub가 만든 이름과 같게)
const PLATFORM_RE = /^(windows|darwin|linux)-(x86_64|aarch64|universal)$/
const COOKIE = 'tbdl'
const COOKIE_DAYS = 30
const MAX_UPLOAD = 90 * 1024 * 1024 // Worker 요청 본문 한도(무료 100MB)보다 조금 작게
const FAIL_RULES = [
  { scope: 'ip', max: 5, win: 15 * 60_000, lock: 15 * 60_000 },
  { scope: 'all', max: 30, win: 60 * 60_000, lock: 60 * 60_000 },
]

const enc = new TextEncoder()
const now = () => Date.now()
const kstDay = () => new Date(now() + 9 * 3600_000).toISOString().slice(0, 10)
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const sha256 = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data))
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })

// 같은 길이일 때만 한 글자씩 끝까지 비교한다(맞힌 글자 수가 시간으로 새지 않게)
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
const bearer = (req) => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')

export function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

// ───────── 로그인 쿠키 ─────────
// 내용: 이름·만료·비밀번호 지문. 비밀번호를 바꾸면 지문이 달라져 예전 쿠키는 통하지 않는다
const codeOk = (env) => /^\d{4,10}$/.test(env.DOWNLOAD_CODE || '')
const codePrint = async (env) => (await sha256(`code|${env.DOWNLOAD_CODE}|${env.COOKIE_KEY}`)).slice(0, 12)
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.COOKIE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}
async function makeCookie(env, name) {
  const body = b64u(enc.encode(JSON.stringify({ n: name, e: now() + COOKIE_DAYS * 86400_000, p: await codePrint(env) })))
  const sig = b64u(await hmac(env, body))
  return `${COOKIE}=${body}.${sig}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`
}
export async function readSession(req, env) {
  if (!codeOk(env) || !env.COOKIE_KEY) return null
  const raw = (req.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='))
  if (!raw) return null
  const [body, sig] = raw.slice(COOKIE.length + 1).split('.')
  if (!body || !sig || !same(sig, b64u(await hmac(env, body)))) return null
  try {
    const s = JSON.parse(new TextDecoder().decode(unb64u(body)))
    if (!s || s.e < now() || s.p !== (await codePrint(env))) return null
    return { name: typeof s.n === 'string' ? s.n : '' }
  } catch {
    return null
  }
}

// ───────── 틀린 횟수 제한 ─────────
async function failKeys(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || ''
  return { ip: 'ip:' + (await sha256(`dl|${ip}|${env.COOKIE_KEY}`)).slice(0, 24), all: 'all' }
}
async function lockedUntil(env, keys) {
  const r = await env.DB.prepare('SELECT MAX(locked_until) AS u FROM dl_fails WHERE k IN (?1, ?2)').bind(keys.ip, keys.all).first()
  return r && r.u > now() ? r.u : 0
}
async function recordFail(env, keys) {
  const t = now()
  const up = env.DB.prepare(
    `INSERT INTO dl_fails (k, n, first_at, locked_until) VALUES (?1, 1, ?2, 0)
     ON CONFLICT (k) DO UPDATE SET
       n = CASE WHEN first_at < ?2 - ?3 THEN 1 ELSE n + 1 END,
       first_at = CASE WHEN first_at < ?2 - ?3 THEN ?2 ELSE first_at END,
       locked_until = CASE WHEN first_at >= ?2 - ?3 AND n + 1 >= ?4 THEN ?2 + ?5 ELSE locked_until END`,
  )
  const [ipRule, allRule] = FAIL_RULES
  await env.DB.batch([
    up.bind(keys.ip, t, ipRule.win, ipRule.max, ipRule.lock),
    up.bind(keys.all, t, allRule.win, allRule.max, allRule.lock),
    env.DB.prepare('DELETE FROM dl_fails WHERE first_at < ?1 AND locked_until < ?2').bind(t - 86_400_000, t),
  ])
  const row = await env.DB.prepare('SELECT n, locked_until AS u FROM dl_fails WHERE k = ?1').bind(keys.ip).first()
  const until = Math.max(row?.u || 0, await lockedUntil(env, keys))
  return { until: until > t ? until : 0, left: Math.max(0, ipRule.max - (row?.n || 0)) }
}

async function login(req, env) {
  if (!codeOk(env) || !env.COOKIE_KEY) return json({ ok: false, error: 'not-ready' }, 503)
  const keys = await failKeys(req, env)
  const until = await lockedUntil(env, keys)
  if (until) return json({ ok: false, error: 'locked', until }, 429)
  const b = await req.json().catch(() => ({}))
  if (!same(String(b?.code ?? ''), env.DOWNLOAD_CODE)) {
    const f = await recordFail(env, keys)
    return f.until ? json({ ok: false, error: 'locked', until: f.until }, 429) : json({ ok: false, error: 'code', left: f.left }, 401)
  }
  await env.DB.prepare('DELETE FROM dl_fails WHERE k = ?1').bind(keys.ip).run()
  const prev = await readSession(req, env) // 이름을 정해 둔 사람이 다시 들어오면 이름을 그대로 둔다
  return json({ ok: true, name: prev?.name || '' }, 200, { 'Set-Cookie': await makeCookie(env, prev?.name || '') })
}

// 프로필 이름: 받은 기록에 남는 이름. 2~20자, 글자·숫자·공백·몇 가지 기호만
export const cleanName = (v) => String(v ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20)
async function setName(req, env, s) {
  const b = await req.json().catch(() => ({}))
  const name = cleanName(b?.name)
  if (name.length < 2) return json({ ok: false, error: 'name' }, 400)
  return json({ ok: true, name }, 200, { 'Set-Cookie': await makeCookie(env, name) })
}

// ───────── 버전 정보(R2) ─────────
// {app}/{ver}/{file}           설치 파일(customMetadata.sha256)
// {app}/releases/{ver}.json    버전 정보 { app, version, notes, pub_date, files: [{ platform, kind, name, sha256, size, signature? }] }
// {app}/latest.json            가장 높은 버전의 정보
const getJson = async (env, key) => {
  const o = await env.FILES.get(key)
  return o ? JSON.parse(await o.text()) : null
}
async function history(env, app, limit = 12) {
  const list = await env.FILES.list({ prefix: `${app}/releases/` })
  const vers = list.objects.map((o) => o.key.slice(`${app}/releases/`.length, -5)).filter((v) => VER_RE.test(v))
  vers.sort((a, b) => cmpVer(b, a))
  return Promise.all(vers.slice(0, limit).map((v) => getJson(env, `${app}/releases/${v}.json`)))
}
async function catalog(env, s) {
  const apps = []
  for (const [id, info] of Object.entries(APPS)) {
    const releases = (await history(env, id)).filter(Boolean).map(publicRelease)
    apps.push({ id, ...info, latest: releases[0] || null, history: releases.slice(1) })
  }
  return json({ ok: true, me: { name: s.name }, apps })
}
// 화면에 주는 버전 정보: 업데이트 서명은 빼고, 사람이 받을 파일(installer)만
const publicRelease = (r) => ({
  version: r.version,
  notes: r.notes || '',
  pub_date: r.pub_date,
  files: (r.files || []).filter((f) => f.kind === 'installer').map(({ platform, name, sha256, size }) => ({ platform, name, sha256, size, url: `/api/file/${r.app}/${r.version}/${name}` })),
})

async function getFile(req, env, ctx, s, viaUpdate, app, ver, name) {
  const o = await env.FILES.get(`${app}/${ver}/${name}`)
  if (!o) return json({ ok: false, error: 'not-found' }, 404)
  // 받은 기록: 사이트에서 받으면 프로필 이름, 앱이 스스로 받으면 'update'
  const who = viaUpdate ? 'update' : s?.name || '(이름 없음)'
  ctx.waitUntil(
    env.DB.prepare('INSERT INTO dl_log (day, name, app, version, file, via) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO UPDATE SET n = n + 1')
      .bind(kstDay(), who, app, ver, name, viaUpdate ? 'update' : 'page')
      .run()
      .catch(() => {}),
  )
  return new Response(o.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(o.size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      ...(o.customMetadata?.sha256 ? { 'X-Sha256': o.customMetadata.sha256 } : {}),
    },
  })
}

// Tauri 업데이터 형식(https://v2.tauri.app/plugin/updater/ 의 '동적 서버' 응답). 새 버전이 없으면 204
async function update(req, env, app, target, arch, current) {
  const r = await getJson(env, `${app}/latest.json`)
  if (!r || !VER_RE.test(current) || cmpVer(r.version, current) <= 0) return new Response(null, { status: 204 })
  const want = [`${target}-${arch}`, `${target}-universal`]
  const f = (r.files || []).find((x) => x.kind === 'updater' && want.includes(x.platform))
  if (!f) return new Response(null, { status: 204 })
  const base = new URL(req.url).origin
  return json({
    version: r.version,
    notes: r.notes || '',
    pub_date: r.pub_date,
    url: `${base}/api/file/${app}/${r.version}/${f.name}`,
    signature: f.signature || '',
    sha256: f.sha256,
    size: f.size,
    page: base + '/', // 앱이 '바뀐 점 보기'로 열 도구함 주소
  })
}

async function putFile(req, env, app, ver, name) {
  const len = Number(req.headers.get('Content-Length') || 0)
  if (len > MAX_UPLOAD) return json({ ok: false, error: 'too-large' }, 413)
  const buf = await req.arrayBuffer()
  if (!buf.byteLength || buf.byteLength > MAX_UPLOAD) return json({ ok: false, error: 'size' }, 400)
  const hash = await sha256(buf)
  await env.FILES.put(`${app}/${ver}/${name}`, buf, { customMetadata: { sha256: hash } })
  return json({ ok: true, name, size: buf.byteLength, sha256: hash })
}

async function putManifest(req, env, app, ver) {
  const b = await req.json().catch(() => null)
  if (!b || !Array.isArray(b.files) || !b.files.length) return json({ ok: false, error: 'body' }, 400)
  const files = []
  for (const f of b.files) {
    if (!PLATFORM_RE.test(f?.platform || '') || !['installer', 'updater'].includes(f?.kind) || !NAME_RE.test(f?.name || '')) return json({ ok: false, error: 'file', file: f?.name }, 400)
    const head = await env.FILES.head(`${app}/${ver}/${f.name}`)
    if (!head) return json({ ok: false, error: 'missing', file: f.name }, 400) // 파일을 먼저 올려야 한다
    files.push({ platform: f.platform, kind: f.kind, name: f.name, sha256: head.customMetadata?.sha256 || '', size: head.size, ...(f.signature ? { signature: String(f.signature) } : {}) })
  }
  const rel = { app, version: ver, notes: String(b.notes || '').slice(0, 4000), pub_date: new Date().toISOString(), files }
  const body = JSON.stringify(rel)
  await env.FILES.put(`${app}/releases/${ver}.json`, body, { httpMetadata: { contentType: 'application/json' } })
  const latest = await getJson(env, `${app}/latest.json`)
  const isLatest = !latest || cmpVer(ver, latest.version) >= 0
  if (isLatest) await env.FILES.put(`${app}/latest.json`, body, { httpMetadata: { contentType: 'application/json' } })
  return json({ ok: true, version: ver, latest: isLatest, files: files.length })
}

function page(env, s) {
  const n = codeOk(env) ? env.DOWNLOAD_CODE.length : 0
  // 화면에 넣는 값은 숫자·true/false뿐이라 HTML에 그대로 넣어도 안전하다(이름은 화면이 /api/catalog로 받아 textContent로 넣는다)
  const html = PAGE.replace('/*__COLORS__*/', COLORS)
    .replace('/*__MOTION__*/', MOTION)
    .replaceAll('<!--__LOGO__-->', LOGO.replace(/<svg /, '<svg aria-hidden="true" focusable="false" '))
    .replace('__BOOT__', JSON.stringify({ n, in: !!s, named: !!s?.name }))
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    try {
      if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } })
      if (path === '/' && req.method === 'GET') return page(env, await readSession(req, env))

      // 같은 사이트에서 보낸 요청만 받는다(다른 사이트가 로그인한 사람의 브라우저로 보내는 요청을 막는다)
      const crossSite = req.method !== 'GET' && req.headers.get('Origin') && req.headers.get('Origin') !== url.origin
      if (path === '/api/login' && req.method === 'POST') return crossSite ? json({ ok: false, error: 'origin' }, 403) : await login(req, env)
      if (path === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` })

      // 앱의 업데이트 확인
      let m = /^\/api\/update\/([a-z-]+)\/([a-z]+)\/([a-z0-9_]+)\/([0-9.]+)$/.exec(path)
      if (m && req.method === 'GET') {
        if (!env.UPDATE_KEY || !same(req.headers.get('X-Update-Key') || '', env.UPDATE_KEY)) return json({ ok: false, error: 'auth' }, 401)
        if (!APP_RE.test(m[1])) return json({ ok: false, error: 'app' }, 404)
        return await update(req, env, m[1], m[2], m[3], m[4])
      }
      // 설치 파일 받기: 로그인한 사람 또는 업데이트 열쇠를 가진 앱
      m = /^\/api\/file\/([a-z-]+)\/([0-9.]+)\/([^/]+)$/.exec(path)
      if (m && req.method === 'GET') {
        const viaUpdate = !!env.UPDATE_KEY && same(req.headers.get('X-Update-Key') || '', env.UPDATE_KEY)
        const s = viaUpdate ? null : await readSession(req, env)
        if (!viaUpdate && !s) return json({ ok: false, error: 'auth' }, 401)
        if (!APP_RE.test(m[1]) || !VER_RE.test(m[2]) || !NAME_RE.test(m[3])) return json({ ok: false, error: 'not-found' }, 404)
        return await getFile(req, env, ctx, s, viaUpdate, m[1], m[2], m[3])
      }
      // 설치 파일 올리기(GitHub Actions)
      m = /^\/api\/release\/([a-z-]+)\/([0-9.]+)\/(files\/([^/]+)|manifest)$/.exec(path)
      if (m && req.method === 'PUT') {
        if (!env.RELEASE_TOKEN || !same(bearer(req), env.RELEASE_TOKEN)) return json({ ok: false, error: 'auth' }, 401)
        if (!APP_RE.test(m[1]) || !VER_RE.test(m[2])) return json({ ok: false, error: 'version' }, 400)
        if (m[3] === 'manifest') return await putManifest(req, env, m[1], m[2])
        if (!NAME_RE.test(m[4])) return json({ ok: false, error: 'name' }, 400)
        return await putFile(req, env, m[1], m[2], m[4])
      }

      const s = await readSession(req, env)
      if (path.startsWith('/api/') && !s) return json({ ok: false, error: 'auth' }, 401)
      if (path === '/api/me' && req.method === 'POST') return crossSite ? json({ ok: false, error: 'origin' }, 403) : await setName(req, env, s)
      if (path === '/api/catalog' && req.method === 'GET') return await catalog(env, s)
      return json({ ok: false, error: 'not-found' }, 404)
    } catch (e) {
      console.error(String(e?.message || e))
      return json({ ok: false, error: 'server' }, 500)
    }
  },
}
