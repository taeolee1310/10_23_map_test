import { PRICE_NOTE, fmtDist, priceLabel, priceState, type PlaceWithDist } from '../../lib/onsen'
import Badge from '../../components/Badge/Badge'
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
  onDetail: (id: string) => void // 모바일: 카드에서 바로 상세를 연다
  onFav: (id: string) => void
  onHover: (id: string | null) => void
  onMore: () => void
  onReset: () => void
  onReport: (id: string) => void
}

export default function PlaceList({ list, total, shown, selId, hotId, favs, animKey, onSelect, onDetail, onFav, onHover, onMore, onReset, onReport }: Props) {
  if (!list.length) {
    return (
      <ol id="list">
        <li className="empty">
          <b>조건에 맞는 목욕탕이 없어요</b>
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
            {/* 대표 사진 한 장(왼쪽). 사진이 없거나 못 불러오면 빈 자리만 남긴다 */}
            <span className="thumb" aria-hidden="true">
              {d.photo ? (
                <img src={d.photo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.hidden = true)} />
              ) : (
                <small>사진 준비 중</small>
              )}
            </span>
            <span className="txt">
            <div className="nm">{d.name}</div>
            <div className="ad">{d.addr}</div>
            <div className="meta">
              {d.kind && <Badge tone="facility">{d.kind}</Badge>}
              {d.women_only && <Badge tone="women">여성전용</Badge>}
              {priceState(d) === 'confirmed' ? (
                <Badge tone="price">{priceLabel(d)}</Badge>
              ) : priceState(d) === 'estimate' ? (
                <Badge tone="example">{priceLabel(d)}</Badge>
              ) : (
                <span className="pill price unknown">{priceLabel(d)}</span>
              )}
              {d.dist != null && <span className="pill dist">직선 {fmtDist(d.dist)}</span>}
              {d.lat == null && <span className="pill unknown">지도에 없음</span>}
            </div>
            </span>
          </button>
          {priceState(d) !== 'none' && (
            <div className="price-note">
              {PRICE_NOTE[priceState(d) as 'confirmed' | 'estimate']}
              {priceState(d) === 'estimate' && <button className="linkbtn" onClick={() => onReport(d.id)}>요금 제보</button>}
            </div>
          )}
          {/* 모바일에서는 미리보기 카드가 위쪽 지도 아래에 있어서, 카드에서 바로 상세로 들어가는 버튼을 둔다(데스크톱에서는 숨김) */}
          <div className="item-actions">
            <button className="btn ghost sm" aria-label={`${d.name} 자세히 보기`} onClick={() => onDetail(d.id)}>
              자세히 보기
            </button>
          </div>
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
