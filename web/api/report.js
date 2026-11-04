// 요금 제보 받는 곳(Vercel 서버 기능). 제보는 운영자의 구글 시트에 한 줄씩 쌓기만 하고 화면에 바로 보여 주지 않는다.
// 사람이 확인한 뒤에만 data/curated/ 에 반영한다.
// 시트에는 구글 Apps Script(docs/apps-script-report.gs)가 줄을 추가한다. 주소·비밀 값은 서버에만 둔다(화면에 넣지 않는다).
//   REPORT_SHEET_URL    : Apps Script 웹 앱 주소
//   REPORT_SHEET_SECRET : 주소가 알려져도 아무나 줄을 추가하지 못하게 하는 비밀 값(Apps Script 쪽 값과 같아야 한다)

import { createHash } from 'node:crypto'

const SOURCES = ['현장 가격표', '직접 냈어요', '공식 홈페이지·네이버', '기타']
const LIMIT_PER_HOUR = 5
const TOWEL = ['무제한', '1장', '2장', '3장 이상']
const DRYER = ['무료', '유료', '없음']
const PAY = ['현금만', '카드 가능']
const pick = (list, v) => (list.includes(v) ? v : '') // 정해진 값만 받는다
// 한 사람당 보낼 수 있는 횟수(시트에서 센다). 사람은 브라우저가 만든 익명 기기 ID로, 같은 접속 주소의 보조 한도는 시트 쪽(LIMIT_PER_IP)에 있다.
const MAX_WON = 200000

// 같은 사람이 계속 보내지 못하게 하는 간단한 횟수 제한. 서버 기능이 새로 뜨면 초기화되는 '대략적인' 제한이라,
// 정확한 방어는 아니다. 접속 주소는 해시로만 세고 저장하지 않는다.
const hits = new Map()
const tooMany = (who) => {
  const now = Date.now()
  const recent = (hits.get(who) || []).filter((t) => now - t < 3600_000)
  recent.push(now)
  hits.set(who, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k)
  return recent.length > LIMIT_PER_HOUR
}

// 업체 목록은 배포된 데이터 파일을 한 번 읽어 기억해 둔다. 못 읽으면(보호된 미리보기 등) 막지 않고 '미확인' 표시만 남긴다.
let placeMap = null
const loadPlaces = async (host) => {
  if (placeMap) return placeMap
  try {
    const r = await fetch(`https://${host}/data/onsen.json`)
    if (!r.ok) return null
    placeMap = new Map((await r.json()).places.map((p) => [String(p.id), p.name]))
    return placeMap
  } catch {
    return null
  }
}

// 사람이 검토할 때 눈에 띄게 하는 표시. 걸러내지는 않고 표시만 한다.
const RANGE = { adult: [3000, 30000], towel: [0, 5000], scrub: [5000, 60000] }
const contact = /\d[\d\s-]{7,}\d|https?:|www\.|@/i

const won = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= MAX_WON ? n : NaN
}
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' })
  if (!process.env.REPORT_SHEET_URL || !process.env.REPORT_SHEET_SECRET) return res.status(503).json({ ok: false, error: 'not-ready' })

  let b
  try {
    b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  } catch {
    return res.status(400).json({ ok: false, error: 'body' })
  }
  if (b.hp) return res.status(200).json({ ok: true }) // 숨은 칸이 채워져 있으면 자동 입력이라 조용히 버린다

  const placeId = text(b.placeId, 40)
  let placeName = text(b.placeName, 80)
  const adult = won(b.adult)
  const towel = won(b.towel)
  const scrub = won(b.scrub)
  const source = SOURCES.includes(b.source) ? b.source : ''
  const towelInfo = pick(TOWEL, b.towelInfo)
  // 드라이기는 여탕·남탕을 따로 받아 시트의 '드라이기' 한 칸에 '여탕 유료 · 남탕 무료'처럼 적는다(시트 칸은 그대로)
  const dryW = pick(DRYER, b.hairdryerW)
  const dryM = pick(DRYER, b.hairdryerM)
  const hairdryer = [dryW && `여탕 ${dryW}`, dryM && `남탕 ${dryM}`].filter(Boolean).join(' · ') || pick(DRYER, b.hairdryer)
  const seshinPay = pick(PAY, b.seshinPay)
  let memo = text(b.memo, 100)
  if (!placeId || !placeName) return res.status(400).json({ ok: false, error: 'place' })
  if ([adult, towel, scrub].some(Number.isNaN)) return res.status(400).json({ ok: false, error: 'price' })
  if (adult == null && towel == null && scrub == null && !towelInfo && !hairdryer && !seshinPay) return res.status(400).json({ ok: false, error: 'empty' })
  if (!source) return res.status(400).json({ ok: false, error: 'source' })

  const flags = []
  const places = await loadPlaces(req.headers.host)
  if (places) {
    if (!places.has(placeId)) return res.status(400).json({ ok: false, error: 'place' }) // 목록에 없는 업체
    if (places.get(placeId) !== placeName) flags.push('이름 불일치')
    placeName = places.get(placeId) // 이름은 서버 목록 기준으로 기록한다
  } else flags.push('업체 확인 못 함')
  for (const [k, label] of [['adult', '입장료'], ['towel', '수건'], ['scrub', '세신']]) {
    const v = { adult, towel, scrub }[k]
    if (v != null && (v < RANGE[k][0] || v > RANGE[k][1])) flags.push(`${label} 이상값`)
  }
  if (contact.test(memo)) {
    flags.push('연락처 의심')
    memo = '[연락처 의심, 가림]' // 개인 연락처는 시트에도 남기지 않는다
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  // 기기 ID와 접속 주소는 한 방향으로 섞어(해시) 시트에 남긴다. 원래 값은 저장하지 않는다.
  const hash = (v) => createHash('sha256').update(`${v}|${process.env.REPORT_SHEET_SECRET}`).digest('hex').slice(0, 16)
  const deviceId = text(b.deviceId, 64)
  const who = hash(deviceId ? `device:${deviceId}` : `ip:${ip}`)
  const ipHash = hash(`ip:${ip}`)
  if (tooMany(`${ip}|${req.headers['user-agent'] || ''}`)) return res.status(429).json({ ok: false, error: 'rate' })

  try {
    const r = await fetch(process.env.REPORT_SHEET_URL, {
      method: 'POST',
      redirect: 'follow', // Apps Script는 결과를 다른 주소로 넘겨 준다
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: process.env.REPORT_SHEET_SECRET, placeId, placeName, adult, towel, scrub, source, memo, flags: flags.join(', '), who, ip: ipHash, towelInfo, hairdryer, seshinPay }),
    })
    const j = await r.json().catch(() => ({}))
    if (j.error === 'limit') return res.status(429).json({ ok: false, error: 'limit' }) // 한 사람이 보낼 수 있는 횟수를 넘음
    if (!r.ok || !j.ok) return res.status(502).json({ ok: false, error: 'store' })
    return res.status(200).json({ ok: true })
  } catch {
    return res.status(502).json({ ok: false, error: 'store' })
  }
}
