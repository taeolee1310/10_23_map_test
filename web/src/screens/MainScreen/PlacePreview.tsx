import { useState } from 'react'
import { PRICE_NOTE, fmtDist, mapLinks, priceClass, priceLabel, priceState, won, type LatLng, type PlaceWithDist } from '../../lib/onsen'
import Badge from '../../components/Badge/Badge'
import PriceIcon, { type PriceIconName } from '../../components/PriceIcon/PriceIcon'
import { HintPin, IconBanana } from './Icons'
import { InfoTip, towelText, worries } from './PlaceFacts'

type Props = {
  place: PlaceWithDist | null
  total: number
  pricedCount: number
  unconfirmedCount: number
  me: LatLng | null
  fav: boolean
  swapKey: string
  onFav: (id: string) => void
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
          핀을 한 번 더 누르면 자세한 정보로 넘어가요. 요금은 직접 확인한 곳만 숫자로 보여 드려요.
        </div>
      )}
    </div>
  )
}

export default function PlacePreview({ place: d, total, pricedCount, unconfirmedCount, me, fav, swapKey, onFav, onReport }: Props) {
  if (!d) return <MapHint total={total} pricedCount={pricedCount} unconfirmedCount={unconfirmedCount} />
  const near = d.parking && d.parking.length ? d.parking[0] : null
  const fees: { icon: PriceIconName; text: string; example?: boolean }[] = []
  if (d.price?.adult != null) fees.push({ icon: 'adult', text: '대인 ' + won(d.price.adult) })
  if (d.price?.child != null) fees.push({ icon: 'child', text: '소인 ' + won(d.price.child) })
  if (!d.price && d.price_example) fees.push({ icon: 'adult', text: '예시 · 대인 ' + won(d.price_example.adult), example: true }) // 가상 값은 항상 '예시'
  const top3 = worries(d.facts)
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
        {d.kind && <Badge tone="facility">{d.kind}</Badge>} {/* 목록 카드와 같은 시설 배지 */}
        {d.women_only && <Badge tone="women">여성전용</Badge>} {/* 목록 카드와 같은 배지 */}
        {d.dist != null && <span className="pill dist">직선 {fmtDist(d.dist)}</span>}
        {near && <span className="pill">주차장 {near.dist}m</span>}
      </div>
      {/* 요금 칩: 확인한 대인·소인 요금만 진하게. 확인 전이면 '예시'를 붙여 옅게 */}
      <ul className="chips" aria-label="요금">
        {fees.length ? (
          fees.map((f) => (
            <li key={f.icon} className={`icon-chip${f.example ? ' example' : ''}`}>
              <PriceIcon name={f.icon} />
              {f.text}
            </li>
          ))
        ) : (
          <li className={`pill price${priceClass(d)}`}>{priceLabel(d)}</li>
        )}
      </ul>
      {/* 가기 전 걱정 TOP 3: 확인한 항목만 칩으로. 하나도 없으면 알려 주기 칩 */}
      <ul className="chips" aria-label="가기 전 걱정 TOP 3">
        {top3.length ? (
          top3.map((w) => (
            <li key={w.label} className="icon-chip worry">
              <PriceIcon name={w.icon} />
              {w.icon === 'towel' ? towelText(d.facts?.towel) : `${w.label} ${w.text}`}
              {w.note && <InfoTip text={w.note} align="start" />}
            </li>
          ))
        ) : (
          <li>
            <button type="button" className="icon-chip ask" onClick={() => onReport(d.id)}>
              수건·드라이기·세신 정보 알려 주기
            </button>
          </li>
        )}
      </ul>
      <div className="actions" style={{ margin: 0 }}>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={mapLinks(d, me).car}>길찾기</a>
      </div>
      {priceState(d) !== 'none' && (
        <div className="price-note">
          {priceState(d) === 'confirmed' && PRICE_NOTE.confirmed}
          {priceState(d) === 'estimate' && <button className="linkbtn" onClick={() => onReport(d.id)}>요금 제보</button>}
        </div>
      )}
    </div>
  )
}
