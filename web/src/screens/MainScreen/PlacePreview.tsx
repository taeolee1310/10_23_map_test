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

export default function PlacePreview({ place: d, total, pricedCount, unconfirmedCount, me, fav, swapKey, onFav, onDetail, onReport }: Props) {
  if (!d) {
    return (
      <div className="preview" id="preview">
        <div className="hint">
          <HintPin />
          <div>
            <b>핀이나 목록의 목욕탕을 눌러 보세요</b>
            서울 {total}곳 · 요금 확인 {pricedCount}곳 · 미확인 {unconfirmedCount}곳
            <br />
            요금은 직접 확인한 곳만 숫자로 보여 드려요. 이동 시간은 길찾기에서 볼 수 있어요.
          </div>
        </div>
      </div>
    )
  }
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
