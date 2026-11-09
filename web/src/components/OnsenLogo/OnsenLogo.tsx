import tile from '../../assets/onsen-logo-sheep/tile-bath.svg'
import rippleLeft from '../../assets/onsen-logo-sheep/ripple-left.svg'
import rippleCenter from '../../assets/onsen-logo-sheep/ripple-center.svg'
import rippleRight from '../../assets/onsen-logo-sheep/ripple-right.svg'
import character from '../../assets/onsen-logo-sheep/character-sheep.svg'
import steamLeft from '../../assets/onsen-logo-sheep/steam-left.svg'
import steamRight from '../../assets/onsen-logo-sheep/steam-right.svg'
import { useEffect, useRef, useState } from 'react'
import './OnsenLogo.css'

/**
 * 탕방 캐릭터 로고. Figma '탕방 캐릭터 · 양머리 + 타일탕 · 수증기 2개 · 6초 모션'(539:153)을 그대로 옮겼다.
 * 에셋은 Figma 원본 SVG이고, 모션(6초 한 바퀴)은 OnsenLogo.css에 있다. 배경은 투명하다.
 * SVG는 모양(알파)만 쓰고 색은 CSS에서 컬러 시스템 토큰으로 칠한다(--logo-*).
 *
 * 모션은 계속 반복하지 않는다. 처음 나타날 때 한 바퀴(cycle초) 보여 주고 멈추며,
 * playKey 값이 바뀔 때마다(예: 마우스를 올렸을 때) 다시 한 바퀴 재생한다. 재생 중에 또 바뀌면 무시한다.
 */
const FRAME = 1254 // Figma 프레임 크기(정사각)
const CROP = { x: 220, y: 184, w: 814, h: 858 } // 캐릭터·수증기·타일탕이 움직이는 범위까지만 잘라 쓴다

type Box = { x: number; y: number; w: number; h: number }
type Inset = [top: number, right: number, bottom: number, left: number] // %

// Figma가 준 inset(%) → 프레임 px
const box = ([t, r, b, l]: Inset): Box => ({ x: (l / 100) * FRAME, y: (t / 100) * FRAME, w: (1 - (l + r) / 100) * FRAME, h: (1 - (t + b) / 100) * FRAME })

// 아래 순서가 Figma 레이어 순서(뒤 → 앞). out = 움직이는 틀, svg = 획이 틀 밖으로 나간 만큼(틀 크기 대비 %, 음수)
const PARTS: { cls: string; src: string; out: Inset; svg: Inset }[] = [
  { cls: 'tile', src: tile, out: [59.31, 19.14, 18.82, 19.14], svg: [-5.11, -1.81, -5.11, -1.81] },
  { cls: 'ripple', src: rippleLeft, out: [63.48, 66.83, 34.75, 26.24], svg: [-45.1, -11.5, -45.09, -11.5] },
  { cls: 'ripple', src: rippleCenter, out: [66.03, 46.17, 33.65, 47.13], svg: [-250.05, -11.91, -250, -11.91] },
  { cls: 'ripple', src: rippleRight, out: [63.56, 26.32, 34.66, 66.67], svg: [-44.69, -11.36, -44.69, -11.36] },
  { cls: 'character', src: character, out: [33.25, 26.78, 34.92, 26.78], svg: [-3.51, -2.4, -3.51, -2.4] },
  { cls: 'steam onsen-logo__steam--left', src: steamLeft, out: [17.46, 51.93, 70.26, 45.05], svg: [-11.04, -44.9, -11.04, -44.91] },
  { cls: 'steam onsen-logo__steam--right', src: steamRight, out: [19.86, 43.61, 68.98, 53.96], svg: [-12.14, -55.89, -12.14, -55.89] },
]

type Props = {
  /** 로고 높이. 숫자(px) 또는 CSS 값 */
  height?: number | string
  /** 접근성 이름. 없으면 장식으로 처리한다 */
  title?: string
  className?: string
  /** 이 값이 바뀌면 모션을 한 번 다시 재생한다. 처음 나타날 때는 값과 상관없이 한 번 재생한다 */
  playKey?: number
  /** 모션 한 바퀴의 길이(초). 기본 6(Figma 값) */
  cycle?: number
  /** false면 처음 나타날 때 재생하지 않고, playKey가 바뀔 때만 재생한다. 기본 true */
  autoPlay?: boolean
  /** 처음 재생을 시작하기 전에 기다리는 시간(ms). 화면이 먼저 자리 잡은 뒤 움직이게 할 때 쓴다 */
  delay?: number
  /** true면 한 번 재생하고 rest(ms) 쉬었다가 계속 반복한다. 화면에 오래 머무는 장면에 쓴다 */
  loop?: boolean
  /** true면 쉬는 틈 없이 모션을 끝없이 반복한다(loop보다 우선) */
  endless?: boolean
  /** loop일 때 한 번 재생이 끝나고 다음 재생까지 쉬는 시간(ms). 기본 2500 */
  rest?: number
}

const pct = (v: number, size: number, origin = 0) => `${((v - origin) / size) * 100}%`
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function OnsenLogo({ height = 64, title, className, playKey = 0, cycle = 6, autoPlay = true, delay = 0, loop = false, endless = false, rest = 2500 }: Props) {
  const h = typeof height === 'number' ? `${height}px` : height
  const [playing, setPlaying] = useState(false)
  const busy = useRef(false)

  // 처음 나타날 때, 그리고 playKey가 바뀔 때 한 번 재생. 이미 재생 중이면 그대로 둔다.
  useEffect(() => {
    if (loop || endless) return // 반복할 때는 아래 효과가 맡는다
    if (busy.current) return
    if (!autoPlay && playKey === 0) return
    if (reduced()) return // 모션 줄이기 설정이면 정지 상태 그대로
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
  }, [playKey, cycle, loop]) // eslint-disable-line react-hooks/exhaustive-deps

  // 반복: 재생 → 쉬기 → 재생 … (모션 줄이기 설정이면 하지 않는다)
  useEffect(() => {
    if (!loop || endless || reduced()) return
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

  // 끝없이 반복: 재생 상태를 계속 켜 두고 CSS가 모션을 무한 반복한다
  useEffect(() => {
    if (!endless || reduced()) return
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
        {PARTS.map(({ cls, src, out, svg }) => {
          const b = box(out)
          const [t, r, bt, l] = svg
          return (
            <span key={src} className={`onsen-logo__part onsen-logo__${cls}`} style={{ left: pct(b.x, CROP.w, CROP.x), top: pct(b.y, CROP.h, CROP.y), width: pct(b.w, CROP.w), height: pct(b.h, CROP.h) }}>
              <i className="onsen-logo__fill" style={{ top: `${t}%`, right: `${r}%`, bottom: `${bt}%`, left: `${l}%`, ['--mask' as string]: `url("${src}")` }} />
            </span>
          )
        })}
      </span>
    </span>
  )
}
