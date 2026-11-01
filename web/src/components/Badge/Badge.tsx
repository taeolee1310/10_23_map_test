import facilityIcon from '../../assets/badge/facility.svg'
import womenIcon from '../../assets/badge/women.svg'
import wonIcon from '../../assets/badge/won.svg'
import './Badge.css'

// Figma '탕방 디자인 시스템' Badge 시안 03 (목욕탕·사우나 481:138 · 여성전용 483:138 · 성인 요금 483:147)
// 왼쪽 32px 색 칸에 흰 아이콘, 오른쪽에 라벨. 'example'은 확인 전 예시 요금(Figma 시안 없음, 미확인 배지 색 사용)
const ICON = { facility: facilityIcon, women: womenIcon, price: wonIcon, example: wonIcon } as const
export type BadgeTone = keyof typeof ICON

export default function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`tb-badge tb-badge--${tone}`}>
      <span className="tb-badge__icon" aria-hidden="true">
        <img src={ICON[tone]} alt="" width={20} height={20} />
      </span>
      <span className="tb-badge__label">{children}</span>
    </span>
  )
}
