import { KIND_CLASS, fmtDist, mapLinks, priceLabel, type LatLng, type PlaceWithDist } from '../../lib/onsen'
import { HintPin, IconHeart } from './Icons'

type Props = {
  place: PlaceWithDist | null
  total: number
  pricedCount: number
  me: LatLng | null
  fav: boolean
  swapKey: string
  onFav: (id: string) => void
  onDetail: () => void
}

export default function PlacePreview({ place: d, total, pricedCount, me, fav, swapKey, onFav, onDetail }: Props) {
  if (!d) {
    return (
      <div className="preview" id="preview">
        <div className="hint">
          <HintPin />
          <div>
            <b>핀이나 목록의 온천을 눌러 보세요</b>
            전국 {total}곳 · 요금이 확인된 곳 {pricedCount}곳
            <br />
            가격은 확인된 것만 보여 드려요. 이동 시간은 길찾기에서 볼 수 있어요.
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
          <IconHeart size={20} />
        </button>
      </div>
      <div className="row">
        {d.kind && <span className={`pill kind ${KIND_CLASS[d.kind] || ''}`}>{d.kind}</span>}
        <span className={`pill price${d.price ? '' : ' unknown'}`}>{priceLabel(d)}</span>
        {d.dist != null && <span className="pill dist">직선 {fmtDist(d.dist)}</span>}
        {near && <span className="pill">주차장 {near.dist}m</span>}
      </div>
      <div className="actions" style={{ margin: 0 }}>
        <button className="btn sm" onClick={onDetail}>자세히 보기</button>
        <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={mapLinks(d, me).car}>길찾기</a>
      </div>
    </div>
  )
}
