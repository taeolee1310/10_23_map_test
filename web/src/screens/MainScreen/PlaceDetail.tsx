import { useEffect, useRef } from 'react'
import { KIND_CLASS, PRICE_NOTE, fmtDist, mapLinks, safeTel, safeUrl, won, type LatLng, type PlaceWithDist } from '../../lib/onsen'
import { FactsDetails, FeeDetails, TopWorries, hoursText, unknownList, worries } from './PlaceFacts'

type Props = {
  place: PlaceWithDist | null
  open: boolean
  me: LatLng | null
  onClose: () => void
  onLocate: () => void
  onReport: (id: string) => void
}

function PriceBlock({ d, onReport }: { d: PlaceWithDist; onReport: (id: string) => void }) {
  const p = d.price
  const est = d.price_estimate // 평균 추정값은 숫자로 보여 주지 않고 '미확인'으로만 쓴다
  if (!p && est) {
    return (
      <section className="sec core unknown-box">
        <h3>이용 요금</h3>
        <b className="price-hero unknown">요금 미확인</b>
        <div className="price-note">
          {PRICE_NOTE.estimate}
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
      {p.adult != null && p.towel == null && <p className="small">수건·대여용품 같은 별도 비용은 알 수 없어요.</p>}
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

export default function PlaceDetail({ place: d, open, me, onClose, onLocate, onReport }: Props) {
  // 손가락으로 오른쪽으로 밀면 '목록으로'(모바일의 뒤로 가기 제스처). 세로 스크롤과 구분하려고 가로로 충분히 길고 빠를 때만 본다.
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    boxRef.current?.scrollTo({ top: 0 })
    backRef.current?.focus({ preventScroll: true }) // 화면 밖에서 슬라이드해 들어오는 중이라 스크롤이 튀지 않게
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, d?.id, onClose])

  const l = d ? mapLinks(d, me) : null
  const hasWorries = d ? worries(d.facts).length > 0 : false
  const kakao = d ? safeUrl(d.url) : ''
  const tel = d ? safeTel(d.tel) : ''
  return (
    <article
      id="detail"
      ref={boxRef}
      onTouchStart={(e) => {
        const p = e.touches[0]
        swipe.current = { x: p.clientX, y: p.clientY, t: Date.now() }
      }}
      onTouchEnd={(e) => {
        const s = swipe.current
        swipe.current = null
        if (!s || !open) return
        const p = e.changedTouches[0]
        const dx = p.clientX - s.x
        const dy = p.clientY - s.y
        if (dx > 80 && Math.abs(dy) < dx * 0.5 && Date.now() - s.t < 700) onClose()
      }}
      onTouchCancel={() => (swipe.current = null)} className={open ? 'open' : ''} aria-hidden={!open} tabIndex={open ? 0 : -1} aria-label="목욕탕 상세 (방향키로 스크롤)">
      {d && l && (
        <>
          <button className="back" ref={backRef} onClick={onClose}>← 목록으로</button>
          <div className={`pill kind ${KIND_CLASS[d.kind] || ''}`}>{d.gu}{d.kind ? ` · ${d.kind}` : ''}</div>
          <h2>{d.name}</h2>
          {d.women_only && <span className="pill women">여성전용</span>}
          <div className="small" style={{ margin: 0 }}>{d.addr}</div>
          {hoursText(d.facts) && <div className="hours-line">{hoursText(d.facts)}</div>}
          {/* 바로 할 일: 길찾기·전화 */}
          <div className="actions d-actions">
            <a className="btn sm" target="_blank" rel="noopener noreferrer" href={l.car}>자동차 길찾기</a>
            <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={l.pt}>대중교통 길찾기</a>
            {tel && <a className="btn ghost sm" href={`tel:${tel}`}>전화 {tel}</a>}
          </div>

          {/* 1. 이용 결정에 필요한 핵심: 가기 전 걱정, 요금 */}
          {hasWorries && <TopWorries facts={d.facts} />}
          <PriceBlock d={d} onReport={onReport} />

          {/* 2. 이용 전에 확인할 정보 */}
          <div className="grp">
            <p className="grp-label">가기 전에 확인해요</p>
            {!hasWorries && <TopWorries facts={d.facts} onAsk={() => onReport(d.id)} />}
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
  )
}
