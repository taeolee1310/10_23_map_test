import { KIND_CLASS, fmtDist, priceLabel, type PlaceWithDist } from '../../lib/onsen'
import { IconHeart } from './Icons'

type Props = {
  list: PlaceWithDist[]
  total: number // 필터는 맞지만 지도 범위 때문에 빠진 곳까지 센 수
  shown: number
  selId: string | null
  hotId: string | null
  favs: Set<string>
  animKey: number
  onSelect: (id: string) => void
  onFav: (id: string) => void
  onHover: (id: string | null) => void
  onMore: () => void
  onReset: () => void
}

export default function PlaceList({ list, total, shown, selId, hotId, favs, animKey, onSelect, onFav, onHover, onMore, onReset }: Props) {
  if (!list.length) {
    return (
      <ol id="list">
        <li className="empty">
          <b>조건에 맞는 온천이 없어요</b>
          {total ? "지도를 움직이거나 '지도 범위로 보기'를 꺼 보세요." : '필터를 바꿔 보세요.'}
          <br />
          <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={onReset}>
            필터 초기화
          </button>
        </li>
      </ol>
    )
  }
  return (
    <ol id="list" className="anim" key={animKey}>
      {list.slice(0, shown).map((d, i) => (
        <li
          key={d.id}
          className={`item${selId === d.id ? ' on' : ''}${hotId === d.id ? ' hot' : ''}`}
          style={{ '--i': i } as React.CSSProperties}
          onMouseEnter={() => onHover(d.id)}
          onMouseLeave={() => onHover(null)}
        >
          <button className="open" onClick={() => onSelect(d.id)}>
            <div className="nm">{d.name}</div>
            <div className="ad">{d.addr}</div>
            <div className="meta">
              {d.kind && <span className={`pill kind ${KIND_CLASS[d.kind] || ''}`}>{d.kind}</span>}
              <span className={`pill price${d.price ? '' : ' unknown'}`}>{priceLabel(d)}</span>
              {d.dist != null && <span className="pill dist">직선 {fmtDist(d.dist)}</span>}
              {d.lat == null && <span className="pill unknown">지도에 없음</span>}
            </div>
          </button>
          <button className="heart" aria-pressed={favs.has(d.id)} aria-label={`${d.name} 담아두기`} onClick={() => onFav(d.id)}>
            <IconHeart size={20} />
          </button>
          <i className="steamy" aria-hidden="true">
            <b />
            <b />
            <b />
          </i>
        </li>
      ))}
      {list.length > shown && (
        <li>
          <button className="btn ghost more" onClick={onMore}>
            더 보기 ({list.length - shown}곳)
          </button>
        </li>
      )}
    </ol>
  )
}
