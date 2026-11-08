import { useEffect, useRef, useState } from 'react'
import { KIND_CLASS, PRICE_NOTE, fmtDist, mapLinks, safeTel, safeUrl, won, type LatLng, type PlaceWithDist } from '../../lib/onsen'
import { FactsDetails, FeeDetails, Notices, TopWorries, hoursText, towelText, unknownList } from './PlaceFacts'
import { MiniMap } from '../../components/KakaoMap/KakaoMap'
import { catLabel, go, storyPath, type Story } from '../../lib/stories'

// 모바일(820px 이하, MainScreen.css와 같은 기준)에서만 상세에 작은 지도를 넣는다. 데스크톱은 옆에 큰 지도가 보인다
const MOBILE = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 820px)').matches
// 전체 지도로 볼 때 아래 바텀시트가 보이는 높이(이름·주소·길찾기까지). MainScreen.css의 --sheet-peek와 같은 값
const SHEET_PEEK = 300

type Props = {
  place: PlaceWithDist | null
  open: boolean
  me: LatLng | null
  onClose: () => void
  onLocate: () => void
  onReport: (id: string) => void
  stories?: Story[] // 이 목욕탕이 나온 매거진 글(공개된 것만)
}

function PriceBlock({ d, onReport }: { d: PlaceWithDist; onReport: (id: string) => void }) {
  const p = d.price
  const ex = d.price_example // 가상 값. 항상 '예시'로 표시한다
  if (!p && (ex || d.price_estimate)) {
    return (
      <section className="sec core unknown-box">
        <h3>이용 요금</h3>
        {ex ? (
          <div className="price-hero example">
            <b>{won(ex.adult)}</b>
            <span>예시 · 성인 1인 ({ex.basis})</span>
          </div>
        ) : (
          <b className="price-hero unknown">요금 미확인</b>
        )}
        <div className="price-note">
          <button className="linkbtn" onClick={() => onReport(d.id)}>요금 제보</button>
        </div>
        <p className="small">가기 전에 카카오맵 장소 페이지나 공식 채널에서 요금을 확인해 주세요.</p>
      </section>
    )
  }
  if (!p) {
    return (
      <section className="sec core unknown-box">
        <h3>이용 요금</h3>
        <b className="price-hero unknown">가격 정보 없음</b>
        <p className="small">입장료를 알 수 있는 자료가 아직 없어요. 가기 전에 카카오맵 장소 페이지나 공식 채널에서 찾아봐 주세요.</p>
      </section>
    )
  }
  const row = (k: string, v: string) => (
    <div className="pr">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  )
  return (
    <section className="sec core">
      <h3>이용 요금</h3>
      {p.adult != null && (
        <div className="price-hero">
          <b>{won(p.adult)}</b>
          <span>성인 1인 (평일)</span>
        </div>
      )}
      <div className="price-note" style={{ marginBottom: 6 }}>{PRICE_NOTE.confirmed}</div>
      {p.weekend != null && row('성인 1인 (주말)', won(p.weekend))}
      {p.towel != null && row('수건', p.towel === 0 ? '무료' : '별도 ' + won(p.towel))}
      {p.parking != null && row('주차', p.parking === 0 ? '무료' : won(p.parking))}
      {p.jjimjil != null && row('찜질 이용 시 추가', '+' + won(p.jjimjil))}
      {p.adult != null && p.towel != null && (
        <div className="total">예상 지출 (평일 성인 1인, 수건 포함) {won(p.adult + p.towel)}</div>
      )}
      <FeeDetails price={p} fees={d.facts?.fees} />
      {/* 수건 요금을 모를 때: TOP 3에 수건 제공 정보가 있으면 그쪽을 가리키고, 없으면 수건까지 모른다고 쓴다(두 문장이 어긋나 보이지 않게) */}
      {p.adult != null && p.towel == null && (
        <p className="small">
          {towelText(d.facts?.towel) ? '수건 제공은 위 TOP 3에서 볼 수 있어요. 대여용품 같은 별도 비용은 알 수 없어요.' : '수건·대여용품 같은 별도 비용은 알 수 없어요.'}
        </p>
      )}
      {p.none && <p className="small">추가 요금 없음 (확인됨)</p>}
      {p.memo && <p className="small">{p.memo}</p>}
      <p className="small">
        확인일 {p.checked || '미상'} · 출처{' '}
        {/^https?:\/\//.test(p.source || '') ? (
          <a href={p.source} target="_blank" rel="noopener noreferrer">보기</a>
        ) : (
          p.source || '미상'
        )}
      </p>
    </section>
  )
}

function ParkingBlock({ d }: { d: PlaceWithDist }) {
  const r = d.parking_radius
  return (
    <section className="sec">
      <h3>근처 주차장{r ? ` (반경 ${r}m)` : ''}</h3>
      {d.parking == null ? (
        <p className="small" style={{ margin: 0 }}>주차장은 아직 찾아보지 않았어요.</p>
      ) : !d.parking.length ? (
        <p className="small" style={{ margin: 0 }}>반경 {r}m 안에 카카오에 등록된 주차장이 없어요. 가기 전에 주차할 수 있는지 알아봐 주세요.</p>
      ) : (
        <>
          {d.parking.map((p) => {
            const u = safeUrl(p.url)
            return (
              <div className="pr" key={p.name + p.addr}>
                <span>
                  {u ? <a href={u} target="_blank" rel="noopener noreferrer">{p.name}</a> : p.name}
                  <br />
                  <span className="small">{p.kind} · {p.addr}</span>
                </span>
                <b>{p.dist}m</b>
              </div>
            )
          })}
          <p className="small">주차 요금은 카카오 데이터에 없어요. 장소 페이지를 확인해 주세요.</p>
        </>
      )}
      <p className="small">목욕탕 시설 자체의 주차 정책이 아니라, 근처에 등록된 주차장이에요.</p>
    </section>
  )
}

export default function PlaceDetail({ place: d, open, me, onClose, onLocate, onReport, stories = [] }: Props) {
  // 손가락으로 오른쪽으로 밀면 '목록으로'(모바일의 뒤로 가기 제스처). 세로 스크롤과 구분하려고 가로로 충분히 길고 빠를 때만 본다.
  const backRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLElement>(null)
  // 모바일 '전체보기': 지도를 화면 가득 펴고 상세는 아래 바텀시트로 내린다. 위로 밀면 다시 상세 화면이 된다.
  const [sheet, setSheet] = useState(false)
  const [dragging, setDragging] = useState(false) // 손가락으로 시트를 끄는 중(전환 애니메이션 끔)
  const hasMap = MOBILE && d?.lat != null && d?.lng != null
  const live = useRef({ open, sheet, hasMap, onClose })
  live.current = { open, sheet, hasMap, onClose }

  useEffect(() => {
    setSheet(false)
  }, [open, d?.id])
  useEffect(() => {
    if (sheet) boxRef.current?.scrollTo({ top: 0 }) // 바텀시트에는 이름·주소·길찾기가 보이게
  }, [sheet])

  // 손가락 제스처. 세로로 끌 때 기본 스크롤을 막아야 해서(passive: false) React 대신 직접 단다.
  // - 오른쪽으로 빠르게 밀기: '목록으로'(모바일의 뒤로 가기 제스처)
  // - 상세 맨 위에서 아래로 끌기: 시트가 손가락을 따라 내려가고, 충분히 내리면 전체보기(지도 + 바텀시트)
  // - 바텀시트를 위로 끌기: 손가락을 따라 올라오고, 충분히 올리면 다시 상세 화면
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    let g: { x: number; y: number; t: number; base: number; atTop: boolean; mode: '' | 'x' | 'y' | 'scroll'; pos: number; vy: number; lt: number; ly: number } | null = null
    const H = () => window.innerHeight
    const peekTop = () => H() - SHEET_PEEK
    const start = (e: TouchEvent) => {
      const p = e.touches[0]
      const L = live.current
      if (!L.open || e.touches.length > 1) return (g = null)
      const base = L.sheet ? peekTop() : 0
      g = { x: p.clientX, y: p.clientY, t: Date.now(), base, atTop: el.scrollTop <= 0, mode: '', pos: base, vy: 0, lt: Date.now(), ly: p.clientY }
    }
    const move = (e: TouchEvent) => {
      if (!g) return
      const L = live.current
      const p = e.touches[0]
      const dx = p.clientX - g.x
      const dy = p.clientY - g.y
      if (!g.mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        if (Math.abs(dx) > Math.abs(dy)) g.mode = 'x'
        else if (L.sheet || (L.hasMap && g.atTop && dy > 0)) {
          g.mode = 'y'
          setDragging(true)
        } else g.mode = 'scroll'
      }
      if (g.mode !== 'y') return
      e.preventDefault()
      const now = Date.now()
      g.vy = (p.clientY - g.ly) / Math.max(1, now - g.lt)
      g.lt = now
      g.ly = p.clientY
      g.pos = Math.min(H() - 120, Math.max(0, g.base + dy))
      el.style.top = g.pos + 'px'
    }
    const end = (e: TouchEvent) => {
      const s = g
      g = null
      if (!s) return
      const L = live.current
      if (s.mode === 'y') {
        el.style.top = '' // 놓으면 CSS 전환으로 가까운 자리(상세 화면 / 바텀시트)에 붙는다
        setDragging(false)
        const moved = s.pos - s.base
        if (L.sheet) setSheet(!(moved < -80 || s.vy < -0.5))
        else setSheet(moved > 120 || s.vy > 0.5)
        return
      }
      const p = e.changedTouches[0]
      const dx = p.clientX - s.x
      const dy = p.clientY - s.y
      if (!L.sheet && dx > 80 && Math.abs(dy) < dx * 0.5 && Date.now() - s.t < 700) L.onClose()
    }
    const cancel = () => {
      if (g?.mode === 'y') {
        el.style.top = ''
        setDragging(false)
      }
      g = null
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', cancel)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', cancel)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    boxRef.current?.scrollTo({ top: 0 })
    backRef.current?.focus({ preventScroll: true }) // 화면 밖에서 슬라이드해 들어오는 중이라 스크롤이 튀지 않게
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, d?.id, onClose])

  const l = d ? mapLinks(d, me) : null
  const kakao = d ? safeUrl(d.url) : ''
  const tel = d ? safeTel(d.tel) : ''
  return (
    <>
    {/* 전체보기: 화면 가득한 지도. 상세(#detail)가 바텀시트로 내려가 이 위에 겹친다 */}
    {open && (sheet || dragging) && hasMap && d && (
      <div className="d-full">
        <MiniMap lat={d.lat!} lng={d.lng!} name={d.name} active interactive offsetY={SHEET_PEEK / 2} />
      </div>
    )}
    <article
      id="detail"
      ref={boxRef}
      className={`${open ? 'open' : ''}${sheet ? ' sheet' : ''}${dragging ? ' dragging' : ''}`} aria-hidden={!open} tabIndex={open ? 0 : -1} aria-label="목욕탕 상세 (방향키로 스크롤)">
      {d && l && (
        <>
          {sheet && (
            <button type="button" className="d-handle" aria-label="상세 정보 펼치기" onClick={() => setSheet(false)}>
              <i aria-hidden="true" />
            </button>
          )}
          <button className="back" ref={backRef} onClick={onClose}>← 목록으로</button>
          <div className={`pill kind ${KIND_CLASS[d.kind] || ''}`}>{d.gu}{d.kind ? ` · ${d.kind}` : ''}</div>
          <h2>{d.name}</h2>
          {d.women_only && <span className="pill women">여성전용</span>}
          <div className="small" style={{ margin: 0 }}>{d.addr}</div>
          {hoursText(d.facts) && <div className="hours-line">{hoursText(d.facts)}</div>}
          {/* 모바일: 상세가 지도를 가리므로, 길찾기 위에 이 장소 위치를 작은 지도로 먼저 보여 준다 */}
          {hasMap && !sheet && <MiniMap lat={d.lat!} lng={d.lng!} name={d.name} active={open} onExpand={() => setSheet(true)} />}
          {/* 바로 할 일: 길찾기·전화 */}
          <div className="actions d-actions">
            <a className="btn sm" target="_blank" rel="noopener noreferrer" href={l.car}>자동차 길찾기</a>
            <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={l.pt}>대중교통 길찾기</a>
            {tel && <a className="btn ghost sm" href={`tel:${tel}`}>전화 {tel}</a>}
          </div>

          {/* 1. 이용 결정에 필요한 핵심: 가기 전 걱정, 요금 */}
          <TopWorries facts={d.facts} onAsk={() => onReport(d.id)} /> {/* 정보가 없어도 같은 자리에서 알려 주기를 보여 준다 */}
          <Notices facts={d.facts} /> {/* 등록 정보와 실제가 다른 점(최근 후기 기준). 있을 때만 */}
          <PriceBlock d={d} onReport={onReport} />

          {/* 2. 이용 전에 확인할 정보 */}
          <div className="grp">
            <p className="grp-label">가기 전에 확인해요</p>
            <FactsDetails facts={d.facts} />
            <ParkingBlock d={d} />
            <section className="sec">
              <h3>내 위치에서</h3>
              {d.dist != null ? (
                <>
                  <div className="pr"><span>직선거리</span><b>{fmtDist(d.dist)}</b></div>
                  <p className="small">지도에서 잰 직선거리예요. 실제 도로 거리와 이동 시간은 위 길찾기에서 볼 수 있어요.</p>
                </>
              ) : (
                <>
                  <p className="small" style={{ margin: '0 0 8px' }}>
                    {d.lat == null ? '아직 지도에서 위치를 찾지 못해 직선거리를 알 수 없어요.' : '현재 위치를 허용하면 직선거리를 보여 드려요.'}
                  </p>
                  {d.lat != null && <button className="btn ghost sm" onClick={onLocate}>내 위치로 거리 보기</button>}
                </>
              )}
            </section>
          </div>

          {/* 매거진에 이 목욕탕 이야기가 있으면 읽으러 가는 길(없으면 자리를 두지 않는다: 정보 칸이 아니라 읽을거리 연결이다) */}
          {stories.length > 0 && (
            <section className="sec story-link">
              <h3>이 목욕탕 이야기</h3>
              {stories.map((s) => (
                <a key={s.id} className="btn ghost sm" href={storyPath(s)} onClick={(e) => (e.preventDefault(), go(storyPath(s)))}>
                  {catLabel(s.category)} · {s.title}
                </a>
              ))}
            </section>
          )}

          {/* 3. 참고(부가) 정보: 작고 옅게 */}
          <div className="grp">
            <p className="grp-label">참고</p>
            <section className="sec more">
              <h3>아직 모르는 정보</h3>
              <p className="small" style={{ margin: 0 }}>
                자료가 없어 비워 둔 항목: {unknownList(d.facts).join(', ')}. 카카오맵 장소 페이지에서 볼 수 있어요.
              </p>
              {kakao && (
                <div className="actions">
                  <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={kakao}>카카오맵 장소 페이지</a>
                </div>
              )}
            </section>
          <p className="small">
            출처: {d.source === '카카오' ? '카카오 로컬 API (장소 검색)' : d.source === '서울시 인허가' ? '서울시 목욕장업 인허가 정보(서울 열린데이터광장), 카카오 로컬 API(주소→좌표)' : '행정안전부 온천이용업소 현황' + (d.source === '행안부+카카오' ? ', 카카오 로컬 API' : '')} · 데이터 기준일 {d.checked_at}
          </p>
          </div>
        </>
      )}
    </article>
    </>
  )
}
