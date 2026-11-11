import { BATH_MARK } from './paths'
import './BathBadge.css'

export type BathSide = 'women' | 'men'
export const BATH_LABEL: Record<BathSide, string> = { women: '여탕', men: '남탕' }

/** 어느 탕의 정보인지 알려 주는 배지(그림 + '여탕'·'남탕' 글자). 사용자를 성별로 가르는 표시가 아니라 값이 어느 탕 것인지를 말한다.
 *  그림은 장식이라 화면 읽기 프로그램에는 글자만 읽힌다. */
export default function BathBadge({ side }: { side: BathSide }) {
  const m = BATH_MARK[side]
  return (
    <span className={`bath-badge bath-badge--${side}`}>
      <svg viewBox={`0 0 ${m.w} ${m.h}`} aria-hidden="true" focusable="false">
        <path d={m.d} fillRule="evenodd" />
      </svg>
      <span>{BATH_LABEL[side]}</span>
    </span>
  )
}
