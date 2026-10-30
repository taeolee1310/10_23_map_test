import feeAdult from '../../assets/price-icon/fee-adult.svg'
import feeChild from '../../assets/price-icon/fee-child.svg'
import feeClothes from '../../assets/price-icon/fee-clothes.svg'
import feeNight from '../../assets/price-icon/fee-night.svg'
import feeNightPlus from '../../assets/price-icon/fee-night-plus.svg'
import feeOvertime from '../../assets/price-icon/fee-overtime.svg'
import feeOvertimePlus from '../../assets/price-icon/fee-overtime-plus.svg'
import top3Towel from '../../assets/price-icon/top3-towel.svg'
import top3Hairdryer from '../../assets/price-icon/top3-hairdryer.svg'
import top3Scrub from '../../assets/price-icon/top3-scrub.svg'
import './PriceIcon.css'

export type PriceIconName = 'adult' | 'child' | 'clothes' | 'night' | 'overtime' | 'towel' | 'hairdryer' | 'scrub'

type Layer = { src: string; inset: string } // inset: 32px 틀 안 위·오른쪽·아래·왼쪽 여백(%)
const ICONS: Record<PriceIconName, { art: Layer; plus?: Layer }> = {
  // 에셋은 Figma `탕방/Icon/Fee/*`(노드 437:9469), `탕방/Icon/Top3/*`(노드 450:93)의 32px 버전이다. 여백 값도 Figma 그대로.
  adult: { art: { src: feeAdult, inset: '10.04% 5.33% 10.01% 1.79%' } },
  child: { art: { src: feeChild, inset: '27.21% 18.41% 11.58% 8.75%' } },
  clothes: { art: { src: feeClothes, inset: '20.24% 6.69% 11.57% 7.34%' } },
  night: { art: { src: feeNight, inset: '14.73% 12.96% 11.95% 12.78%' }, plus: { src: feeNightPlus, inset: '13.75% 9.06% 48.75% 53.44%' } },
  overtime: { art: { src: feeOvertime, inset: '20% 11.75% 13.67% 16.15%' }, plus: { src: feeOvertimePlus, inset: '-1.25% -5% 63.75% 67.5%' } },
  towel: { art: { src: top3Towel, inset: '25.79% 8.92% 13.7% 9.49%' } },
  hairdryer: { art: { src: top3Hairdryer, inset: '17.85% 9.38% 13.65% 10.25%' } },
  scrub: { art: { src: top3Scrub, inset: '15.43% 10.44% 15.78% 10.22%' } },
}

/** 요금·걱정 항목 아이콘(32px). 글자가 항목을 말해 주므로 스크린 리더에는 숨긴다. */
export default function PriceIcon({ name }: { name: PriceIconName }) {
  const { art, plus } = ICONS[name]
  return (
    <span className="price-icon" aria-hidden="true">
      <span style={{ inset: art.inset }}>
        <img src={art.src} alt="" />
      </span>
      {plus && (
        <span style={{ inset: plus.inset }}>
          <img src={plus.src} alt="" />
        </span>
      )}
    </span>
  )
}
