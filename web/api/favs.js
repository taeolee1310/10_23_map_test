// 담아둔 곳 백업(Vercel 서버 기능). 로그인 없이 쓰는 서비스라 담아둔 곳은 브라우저(localStorage)에 둔다.
// 그런데 아이폰·맥 사파리는 사이트를 7일 넘게 안 열면 스크립트가 쓴 저장소(localStorage)를 지운다(ITP).
// 서버가 응답으로 심은 쿠키(같은 사이트, HttpOnly)는 그 7일 삭제 대상이 아니라서, 같은 목록을 쿠키에도 적어 두고
// localStorage가 비었을 때 여기서 되살린다. 저장하는 것은 목욕탕 ID 목록뿐이다(개인 정보·접속 주소 없음, DB에도 안 남김).
//   GET  /api/favs          → { ok, ids: [...] }   (쿠키에 적힌 목록)
//   POST /api/favs {ids}    → 쿠키를 새 목록으로 덮어씀(빈 목록이면 쿠키를 지움)
// 한계: 같은 브라우저 안에서만 살아난다. 다른 기기·다른 브라우저로 옮기려면 로그인이 필요하다(지금은 없음).

const COOKIE = 'tb_favs'
const MAX_IDS = 150 // 쿠키 한 개 4KB 안에 들어가게(ID 하나 평균 10~12자)
const MAX_AGE = 400 * 86400 // 브라우저가 허용하는 가장 긴 보관 기간(크롬 400일 상한)
const ID = /^[A-Za-z0-9_-]{1,40}$/

export const parseIds = (raw) =>
  [...new Set(String(raw || '').split('.').filter((s) => ID.test(s)))].slice(0, MAX_IDS)

export const readCookie = (header) => {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return ''
}

export const cookieFor = (ids) =>
  ids.length
    ? `${COOKIE}=${ids.join('.')}; Max-Age=${MAX_AGE}; Path=/api/favs; HttpOnly; Secure; SameSite=Lax`
    : `${COOKIE}=; Max-Age=0; Path=/api/favs; HttpOnly; Secure; SameSite=Lax`

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET') return res.status(200).json({ ok: true, ids: parseIds(readCookie(req.headers.cookie)) })
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' })
  let b
  try {
    b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  } catch {
    return res.status(400).json({ ok: false, error: 'body' })
  }
  if (!Array.isArray(b.ids)) return res.status(400).json({ ok: false, error: 'ids' })
  const ids = parseIds(b.ids.map(String).join('.'))
  res.setHeader('Set-Cookie', cookieFor(ids))
  return res.status(200).json({ ok: true, count: ids.length })
}
