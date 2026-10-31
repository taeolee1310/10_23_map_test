import rimUrl from '../../assets/glass-button/glass-rim.webp'
import causticsUrl from '../../assets/glass-button/water-caustics.webp'

// 유리 테두리 + 물빛 CTA의 그림 부분(장식). 글자·클릭·포커스는 바깥 <button>이 맡는다.
// 레이어 순서: 크림 반투명 바탕 → 물결 모양으로 잘린 물빛 → 글자 가독성 막 → 유리 테두리
// 테두리 그림은 이미지의 투명 여백을 잘라 낸 2095×539(원본 2172×724에서 x 39~2134, y 80~619). 아래 좌표는 모두 이 크기 기준이다.
const W = 2095
const H = 539

// 물 영역: 테두리 안쪽 구멍(x 94~1992, y 약 60~480)보다 조금 작은 알약 모양. 가장자리를 물결로 일렁이게 해서 테두리와 물 사이로 크림색이 비친다.
const CX = 1043
const CY = 269.5
const RX = 931
const RY = 185
const N = 44 // 둘레 점 개수. 모든 변형이 같은 개수여야 SMIL이 모양을 이어서 바꾼다
// 변형 3개의 위상. 첫 모양으로 돌아와 한 바퀴를 이룬다
const PHASES: [number, number][] = [
  [0, 0.4],
  [2.1, 3.3],
  [4.2, 5.6],
]

const r1 = (n: number) => Math.round(n * 10) / 10

function blob([p1, p2]: [number, number]) {
  const pts: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    // 알약에 가까운 초타원(양 끝이 둥글고 위·아래는 평평)
    const x = CX + RX * Math.sign(c) * Math.abs(c) ** 0.62
    const y = CY + RY * Math.sign(s) * Math.abs(s) ** 0.62
    // 위·아래 변은 파도처럼, 양 끝은 조금만 흔든다
    const wave = 9 * Math.sin((x / 900) * Math.PI * 2 + p1) + 5 * Math.sin((x / 470) * Math.PI * 2 + p2)
    pts.push([x + 5 * Math.cos(p2 + t * 2) * Math.abs(c), y + wave * Math.abs(s) ** 0.5 * Math.sign(s || 1)])
  }
  // 닫힌 Catmull-Rom 곡선을 3차 베지어로 바꾼다
  const at = (i: number) => pts[(i + N) % N]
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`
  for (let i = 0; i < N; i++) {
    const p0 = at(i - 1)
    const p1_ = at(i)
    const p2_ = at(i + 1)
    const p3 = at(i + 2)
    const c1 = [p1_[0] + (p2_[0] - p0[0]) / 6, p1_[1] + (p2_[1] - p0[1]) / 6]
    const c2 = [p2_[0] - (p3[0] - p1_[0]) / 6, p2_[1] - (p3[1] - p1_[1]) / 6]
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2_[0])} ${r1(p2_[1])}`
  }
  return d + 'Z'
}

const SHAPES = PHASES.map(blob)
const SHAPE_VALUES = [...SHAPES, SHAPES[0]].join(';')
const MORPH_DUR = '18s'
const MORPH_SPLINES = '0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1' // 천천히 가속·감속

function Morph({ animate }: { animate: boolean }) {
  return animate ? (
    <animate attributeName="d" values={SHAPE_VALUES} dur={MORPH_DUR} repeatCount="indefinite" calcMode="spline" keyTimes="0;0.333;0.667;1" keySplines={MORPH_SPLINES} />
  ) : null
}

/** animate=false이면 모양·무늬가 멈춘 한 장면만 그린다(움직임 줄이기, iOS 점검 단계) */
export default function GlassWater({ animate }: { animate: boolean }) {
  return (
    <svg className="bh__glass" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="bh-glass-water">
          <path d={SHAPES[0]}>
            <Morph animate={animate} />
          </path>
        </clipPath>
        {/* 글자 뒤만 크림색으로 살짝 덮어 물빛이 짙은 곳에서도 글자가 읽히게 한다 */}
        <radialGradient id="bh-glass-veil" cx="50%" cy="50%" r="50%">
          <stop offset="0" className="bh__glass-veil-stop" />
          <stop offset="0.6" className="bh__glass-veil-stop" />
          <stop offset="1" className="bh__glass-veil-stop bh__glass-veil-stop--end" />
        </radialGradient>
      </defs>
      <rect className="bh__glass-bg" x="14" y="14" width={W - 28} height={H - 28} rx={(H - 28) / 2} />
      <g clipPath="url(#bh-glass-water)">
        {/* 물빛 무늬는 이어 붙여 반복하지 않고, 크게 깐 한 장을 아주 조금 옮기고 키우기만 한다 */}
        <image className={animate ? 'bh__glass-tex bh__glass-tex--drift' : 'bh__glass-tex'} href={causticsUrl} x="-80" y="-106" width="2255" height="751" preserveAspectRatio="xMidYMid slice" />
        <ellipse className="bh__glass-veil" cx={W / 2} cy={H / 2} rx="740" ry="200" fill="url(#bh-glass-veil)" />
      </g>
      {/* 물결 경계의 가는 밝은 선: 굵은 번짐 하나 + 가는 선 하나 */}
      <path className="bh__glass-edge bh__glass-edge--glow" d={SHAPES[0]} vectorEffect="non-scaling-stroke">
        <Morph animate={animate} />
      </path>
      <path className="bh__glass-edge" d={SHAPES[0]} vectorEffect="non-scaling-stroke">
        <Morph animate={animate} />
      </path>
      <image href={rimUrl} x="0" y="0" width={W} height={H} />
    </svg>
  )
}
