import bath from '../../assets/onsen-logo/stone-bath.svg'
import character from '../../assets/onsen-logo/character-towel.svg'
import ripple1 from '../../assets/onsen-logo/water-ripple-1.svg'
import ripple2 from '../../assets/onsen-logo/water-ripple-2.svg'
import ripple3 from '../../assets/onsen-logo/water-ripple-3.svg'
import ripple4 from '../../assets/onsen-logo/water-ripple-4.svg'
import overflow1 from '../../assets/onsen-logo/overflow-1.svg'
import overflow2 from '../../assets/onsen-logo/overflow-2.svg'
import overflow3 from '../../assets/onsen-logo/overflow-3.svg'
import overflow4 from '../../assets/onsen-logo/overflow-4.svg'
import { useEffect, useRef, useState } from 'react'
import { STEAM_CURLS, type SteamGroup } from './steamCurls'
import './OnsenLogo.css'

// 김 곡선 조각 132개(assets/onsen-logo/steam/left-01.svg …)의 주소 모음
const STEAM_URLS = import.meta.glob<string>('../../assets/onsen-logo/steam/*.svg', { eager: true, query: '?url', import: 'default' })

/**
 * 온천 캐릭터 로고. Figma 'image 5 [Vectorized]'(292:28)를 그대로 옮겼다.
 * 에셋은 Figma 원본 SVG이고, 모션은 OnsenLogo.css에 있다. 배경은 투명하다. SVG는 모양(알파)만 쓰고 색은 CSS에서 컬러 시스템 토큰으로 칠한다(아래 --logo-* 참고).
 *
 * 모션은 계속 반복하지 않는다. 처음 나타날 때 한 번(cycle초) 보여 주고 멈추며,
 * playKey 값이 바뀔 때마다(예: 마우스를 올렸을 때) 다시 한 번 재생한다. 재생 중에 또 바뀌면 무시한다.
 */
const FRAME = 1254 // Figma 프레임 크기(정사각)
const CROP = { x: 236, y: 262, w: 784, h: 808 } // 캐릭터와 물줄기가 들어가는 부분만 잘라 쓴다

type Box = { x: number; y: number; w: number; h: number }

// Figma가 준 inset(%) → 프레임 px
const inset = (top: number, right: number, bottom: number, left: number): Box => ({
  x: (left / 100) * FRAME,
  y: (top / 100) * FRAME,
  w: (1 - (left + right) / 100) * FRAME,
  h: (1 - (top + bottom) / 100) * FRAME,
})

// 아래 순서가 Figma 레이어 순서(뒤 → 앞)
const PARTS: { cls: string; src: string; box: Box }[] = [
  { cls: 'ripple', src: ripple1, box: inset(61.82, 62.15, 33.59, 31.09) },
  { cls: 'ripple', src: ripple2, box: inset(62.3, 30.68, 33.49, 63.36) },
  { cls: 'ripple', src: ripple3, box: inset(66.76, 52.91, 31.61, 39.9) },
  { cls: 'ripple', src: ripple4, box: inset(66.84, 38.16, 31.46, 56.65) },
  { cls: 'bath', src: bath, box: { x: 251.82, y: 635.86, w: 751.487, h: 370.721 } },
  { cls: 'character', src: character, box: { x: 414.12, y: 494.89, w: 426.793, h: 340.868 } },
  { cls: 'overflow--1', src: overflow1, box: { x: 418, y: 921, w: 25.427, h: 94 } },
  { cls: 'overflow--2', src: overflow2, box: { x: 506, y: 965, w: 12.157, h: 77 } },
  { cls: 'overflow--3', src: overflow3, box: { x: 785, y: 961, w: 25, h: 79 } },
  { cls: 'overflow--4', src: overflow4, box: { x: 878, y: 914, w: 28.113, h: 91 } },
]

type Props = {
  /** 로고 높이. 숫자(px) 또는 CSS 값 */
  height?: number | string
  /** 접근성 이름. 없으면 장식으로 처리한다 */
  title?: string
  className?: string
  /** 이 값이 바뀌면 모션을 한 번 다시 재생한다. 처음 나타날 때는 값과 상관없이 한 번 재생한다 */
  playKey?: number
  /** 모션 한 번의 길이(초). 기본 3 */
  cycle?: number
  /** false면 처음 나타날 때 재생하지 않고, playKey가 바뀔 때만 재생한다. 기본 true */
  autoPlay?: boolean
  /** 처음 재생을 시작하기 전에 기다리는 시간(ms). 화면이 먼저 자리 잡은 뒤 움직이게 할 때 쓴다 */
  delay?: number
  /** true면 한 번 재생하고 rest(ms) 쉬었다가 계속 반복한다. 인트로처럼 화면에 오래 머무는 장면에 쓴다 */
  loop?: boolean
  /** true면 쉬는 틈 없이 모션을 끝없이 반복한다(loop보다 우선). 사용자가 캐릭터를 누른 뒤처럼 계속 움직이게 할 때 쓴다 */
  endless?: boolean
  /** loop일 때 한 번 재생이 끝나고 다음 재생까지 쉬는 시간(ms). 기본 2500 */
  rest?: number
  /** true면 넘치는 물줄기 4개를 빼고 보여 준다(수증기·수면·캐릭터만). 절제된 장면에 쓴다 */
  calm?: boolean
}

const pct = (v: number, size: number, origin = 0) => `${((v - origin) / size) * 100}%`
const STEAM_GROUPS: SteamGroup[] = ['left', 'center', 'right']

export default function OnsenLogo({ height = 64, title, className, playKey = 0, cycle = 3, autoPlay = true, delay = 0, loop = false, endless = false, rest = 2500, calm = false }: Props) {
  const h = typeof height === 'number' ? `${height}px` : height
  const [playing, setPlaying] = useState(false)
  const busy = useRef(false)

  // 처음 나타날 때, 그리고 playKey가 바뀔 때 한 번 재생. 이미 재생 중이면 그대로 둔다.
  useEffect(() => {
    if (loop || endless) return // 반복할 때는 아래 효과가 맡는다
    if (busy.current) return
    if (!autoPlay && playKey === 0) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return // 모션 감소 설정이면 정지 상태 그대로
    busy.current = true
    const wait = playKey === 0 ? delay : 0
    const start = window.setTimeout(() => setPlaying(true), wait)
    const end = window.setTimeout(() => {
      setPlaying(false)
      busy.current = false
    }, wait + cycle * 1000 + 150)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(end)
      busy.current = false
    }
  }, [playKey, cycle, loop])

  // 반복: 재생 → 쉬기 → 재생 … (모션 감소 설정이면 하지 않는다)
  useEffect(() => {
    if (!loop || endless) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let timer = 0
    const play = () => {
      setPlaying(true)
      timer = window.setTimeout(() => {
        setPlaying(false)
        timer = window.setTimeout(play, rest)
      }, cycle * 1000 + 150)
    }
    timer = window.setTimeout(play, delay)
    return () => {
      window.clearTimeout(timer)
      setPlaying(false)
    }
  }, [loop, endless, cycle, rest, delay])

  // 끝없이 반복: 재생 상태를 계속 켜 두고 CSS가 모션을 무한 반복한다 (모션 감소 설정이면 하지 않는다)
  useEffect(() => {
    if (!endless) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    setPlaying(true)
    return () => setPlaying(false)
  }, [endless])

  return (
    <span
      className={`onsen-logo${playing ? ' is-playing' : ''}${endless ? ' is-infinite' : ''}${className ? ' ' + className : ''}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ height: h, width: `calc(${h} * ${CROP.w / CROP.h})`, ['--ol-t' as string]: `${cycle}s` }}
    >
      <span className="onsen-logo__box">
        {PARTS.filter((p) => !(calm && p.cls.startsWith('overflow'))).map(({ cls, src, box }) => (
          <span
            key={src}
            className={`onsen-logo__part onsen-logo__${cls}`}
            style={{
              left: pct(box.x, CROP.w, CROP.x),
              top: pct(box.y, CROP.h, CROP.y),
              width: pct(box.w, CROP.w),
              height: pct(box.h, CROP.h),
            }}
          >
            <i className="onsen-logo__fill" style={{ ['--mask' as string]: `url("${src}")` }} />
          </span>
        ))}
        {STEAM_GROUPS.map((group) => (
          <span key={group} className={`onsen-logo__steam onsen-logo__steam--${group}`}>
            {STEAM_CURLS.filter((c) => c.group === group).map((c) => (
              <span
                key={c.id}
                className={`onsen-logo__curl onsen-logo__curl--${group}-${c.id}`}
                style={{ left: pct(c.x, CROP.w, CROP.x), top: pct(c.y, CROP.h, CROP.y), width: pct(c.size, CROP.w), height: pct(c.size, CROP.h) }}
              >
                <i className="onsen-logo__fill" style={{ ['--mask' as string]: `url("${STEAM_URLS[`../../assets/onsen-logo/steam/${group}-${c.id}.svg`]}")` }} />
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  )
}
