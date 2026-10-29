import { useState } from 'react'
import { KIND_CLASS, PRICE_NOTE, fmtDist, mapLinks, priceClass, priceLabel, priceState, type LatLng, type PlaceWithDist } from '../../lib/onsen'
import { HintPin, IconBanana } from './Icons'

type Props = {
  place: PlaceWithDist | null
  total: number
  pricedCount: number
  unconfirmedCount: number
  me: LatLng | null
  fav: boolean
  swapKey: string
  onFav: (id: string) => void
  onDetail: () => void
  onReport: (id: string) => void
}

const HINT_KEY = 'tangbang:map-hint'

// 지도 사용 안내: 처음에는 펼쳐서 보여 주고, 접으면 한 줄만 남는다(접은 상태는 기억한다). 핀이나 목록에서 고르면 선택한 곳의 요약으로 바뀐다.
// 시간이 지나도 저절로 사라지지 않아서 다 읽기 전에 없어지는 일이 없다.
function MapHint({ total, pricedCount, unconfirmedCount }: { total: number; pricedCount: number; unconfirmedCount: number }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(HINT_KEY, v ? 'closed' : 'open')
      } catch {
        /* 저장할 수 없으면 이번 방문에만 적용 */
      }
      return !v
    })
  }
  return (
    <div className={`preview hintcard${open ? '' : ' collapsed'}`} id="preview">
      <button type="button" className="hint-head" aria-expanded={open} aria-controls="hint-body" onClick={toggle}>
        <HintPin />
        <b>핀이나 목록의 목욕탕을 눌러 보세요</b>
        <span className="hint-chev" aria-hidden="true" />
        <span className="sr">{open ? '안내 접기' : '안내 펼치기'}</span>
      </button>
      {open && (
        <div className="hint-body" id="hint-body">
          서울 {total}곳 · 요금 확인 {pricedCount}곳 · 미확인 {unconfirmedCount}곳
          <br />
          요금은 직접 확인한 곳만 숫자로 보여 드려요. 이동 시간은 길찾기에서 볼 수 있어요.
        </div>
      )}
    </div>
  )
}

export default function PlacePreview({ place: d, total, pricedCount, unconfirmedCount, me, fav, swapKey, onFav, onDetail, onReport }: Props) {
  if (!d) return <MapHint total={total} pricedCount={pricedCount} unconfirmedCount={unconfirmedCount} />
  const near = d.parking && d.parking.length ? d.parking[0] : null
  return (
    <div className="preview swap" id="preview" key={swapKey}>
      <div className="top">
        <div>
          <div className="nm">{d.name}</div>
          <div className="ad">{d.addr}</div>
        </div>
        <button className="heart" style={{ position: 'static' }} aria-pressed={fav} aria-label="담아두기" onClick={() => onFav(d.id)}>
          <IconBanana on={fav} size={24} />
        </button>
      </div>
      <div className="row">
        {d.kind && <span className={`pill kind ${KIND_CLASS[d.kind] || ''}`}>{d.kind}</span>}
        {d.women_only && <span className="pill women">여성전용</span>}
        <span className={`pill price${priceClass(d)}`}>{priceLabel(d)}</span>
        {d.dist != null && <span className="pill dist">직선 {fmtDist(d.dist)}</span>}
        {near && <span className="pill">주차장 {near.dist}m</span>}
      </div>
      <div className="actions" style={{ margin: 0 }}>
        <button className="btn sm" onClick={onDetail}>자세히 보기</button>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={mapLinks(d, me).car}>길찾기</a>
      </div>
      {priceState(d) !== 'none' && (
        <div className="price-note">
          {PRICE_NOTE[priceState(d) as 'confirmed' | 'estimate']}
          {priceState(d) === 'estimate' && <button className="linkbtn" onClick={() => onReport(d.id)}>요금 제보</button>}
        </div>
      )}
    </div>
  )
}
