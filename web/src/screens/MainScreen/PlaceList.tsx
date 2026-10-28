import { KIND_CLASS, PRICE_NOTE, fmtDist, priceClass, priceLabel, priceState, type PlaceWithDist } from '../../lib/onsen'
import { IconBanana } from './Icons'

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
  onReport: (id: string) => void
}

export default function PlaceList({ list, total, shown, selId, hotId, favs, animKey, onSelect, onFav, onHover, onMore, onReset, onReport }: Props) {
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
    <ol id="list" className="anim" key={animKey} tabIndex={0} aria-label="목록 (방향키로 스크롤)">
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
              {d.women_only && <span className="pill women">여성전용</span>}
              <span className={`pill price${priceClass(d)}`}>{priceLabel(d)}</span>
              {d.dist != null && <span className="pill dist">직선 {fmtDist(d.dist)}</span>}
              {d.lat == null && <span className="pill unknown">지도에 없음</span>}
            </div>
          </button>
          {priceState(d) !== 'none' && (
            <div className="price-note">
              {PRICE_NOTE[priceState(d) as 'confirmed' | 'estimate']}
              {priceState(d) === 'estimate' && <button className="linkbtn" onClick={() => onReport(d.id)}>요금 제보</button>}
            </div>
          )}
          <button className="heart" aria-pressed={favs.has(d.id)} aria-label={`${d.name} 담아두기`} onClick={() => onFav(d.id)}>
            <IconBanana on={favs.has(d.id)} size={24} />
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
