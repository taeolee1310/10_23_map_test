import { useEffect, useRef, type CSSProperties } from 'react'
import sheetUrl from '../../assets/bathhouse/duck-float-sheet.png'
import sheet from '../../assets/bathhouse/duck-float-sheet.json'

/**
 * 욕탕 수면 위를 천천히 떠다니는 오리. 누르면 효과음이 난다(위에 작은 안내). 스프라이트 시트의 프레임은 JSON의 실제 영역으로 오려 쓰고,
 * 모든 프레임을 같은 가로 크기·아래 가운데 기준점에 맞춘다. 프레임 바꾸기(눈 깜빡임)와 화면 이동·떠오름은 따로 움직인다.
 * 기본 그림은 왼쪽을 본다. 오른쪽으로 갈 때만 오리를 좌우로 뒤집는다.
 *
 * 위치는 인트로 무대(1536×1024) 좌표다. 무대가 cover로 깔리고 잘리는 만큼 화면에 보이는 범위를 계산해서 그 안으로 맞춘다.
 */
const frame = (name: string) => sheet.frames.find((f) => f.name === name)!
const BASE = frame('float-01') // 가장 안정적인 기본 프레임(눈 뜬 모습)을 계속 보여 준다
const BLINK = frame('float-03') // 눈 감은 프레임: 4~7초마다 아주 잠깐만

// 수면 안의 짧은 구간(무대 좌표). 욕탕 수면 모양(mask-water: 245,602 기준)의 안쪽이고, 글·버튼·캐릭터(x≈600~790)와 겹치지 않는 곳이다.
const WIDE = { x0: 930, x1: 1200, y: 830, w: 72 } // 가로가 넓은 화면
const NARROW = { x0: 845, x1: 965, y: 850, w: 52 } // 세로로 긴 화면(폰)
const MOVE_S = 11 // 한쪽 끝에서 반대쪽 끝까지 가는 데 걸리는 시간
const HOLD_S = 2 // 방향을 바꾸기 전에 머무는 시간 (한 번 왕복 = 26초)
const CYCLE_S = (MOVE_S + HOLD_S) * 2
const BOB_PX = 2 // 위아래 떠오름
const TILT_DEG = 1 // 아주 작은 기울기
const BLINK_S = 0.16
const WAKE_EVERY_S = 0.9 // 움직이는 동안 이 간격으로 물결을 하나씩 남긴다
const WAKE_LIFE_MS = 3400 // 남은 물결이 퍼지며 사라지는 시간
const MAX_WAKES = 6

const smooth = (t: number) => t * t * (3 - 2 * t)
const rand = (a: number, b: number) => a + Math.random() * (b - a)

const frameVars = (f: typeof BASE) =>
  ({ '--fx': f.frame.x, '--fy': f.frame.y, '--fw': f.frame.w, '--fh': f.frame.h }) as CSSProperties

type DuckProps = {
  /** 오리를 눌렀을 때(효과음을 낸다) */
  onPress: () => void
  /** 오리 위의 작은 안내를 보여 줄지 */
  hint: boolean
}

export default function Duck({ onPress, hint }: DuckProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const rigRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const blinkRef = useRef<HTMLSpanElement>(null)
  const wakeRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const rig = rigRef.current
    const body = bodyRef.current
    const blink = blinkRef.current
    const wake = wakeRef.current
    const tip = hintRef.current
    if (!root || !rig || !body || !blink || !wake) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let path = { x0: 0, x1: 0, ay: 0, u: 1, left: 0, vw: 0 }

    // 화면 크기가 바뀔 때: 무대 크기·보이는 범위·오리 크기를 다시 계산해서 이동 구간을 보이는 수면 안으로 맞춘다
    const layout = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const stageW = Math.max(vw, 1.5 * vh) // CSS의 --W와 같은 식
      const u = stageW / 1536
      const narrow = vw / vh <= 1
      const cfg = narrow ? NARROW : WIDE
      const dw = narrow ? cfg.w : vw >= 1000 ? cfg.w : 60
      const visL = (stageW - vw) / 2 / u
      const visR = visL + vw / u
      const margin = dw / 2 / u + 10
      let x0 = Math.max(cfg.x0, visL + margin)
      let x1 = Math.min(cfg.x1, visR - margin)
      if (x1 < x0) x0 = x1 = Math.min(Math.max((cfg.x0 + cfg.x1) / 2, visL + margin), visR - margin)
      root.style.setProperty('--dw', `${dw}px`)
      path = { x0, x1, ay: cfg.y * u, u, left: (vw - stageW) / 2, vw }
      rig.style.top = `${path.ay}px`
      rig.style.left = `0px`
      draw(0)
    }

    let t = 0 // 오리가 움직인 시간(멈춰 있던 동안은 세지 않는다)
    let nextBlink = rand(4, 7)
    let blinkUntil = 0
    let blinking = false
    let nextWake = 0

    const draw = (time: number) => {
      const c = time % CYCLE_S
      let x: number
      let dir = 1 // 1: 왼쪽을 봄(기본), -1: 오른쪽으로 뒤집음
      if (c < HOLD_S) {
        x = path.x0
        dir = c < HOLD_S / 2 ? 1 : -1 // 머문 뒤 방향을 바꾼다
      } else if (c < HOLD_S + MOVE_S) {
        x = path.x0 + (path.x1 - path.x0) * smooth((c - HOLD_S) / MOVE_S)
        dir = -1
      } else if (c < HOLD_S * 2 + MOVE_S) {
        x = path.x1
        dir = c - (HOLD_S + MOVE_S) < HOLD_S / 2 ? -1 : 1
      } else {
        x = path.x1 - (path.x1 - path.x0) * smooth((c - HOLD_S * 2 - MOVE_S) / MOVE_S)
        dir = 1
      }
      const bob = reduce ? 0 : Math.sin((time * 2 * Math.PI) / 3.4) * BOB_PX
      const tilt = reduce ? 0 : Math.sin((time * 2 * Math.PI) / 4.6 + 1) * TILT_DEG
      rig.style.transform = `translate3d(${x * path.u}px,0,0)`
      if (tip) {
        // 안내 말풍선이 화면 가장자리로 잘리지 않게 가로 위치를 보정하고, 꼬리는 오리를 가리키게 둔다
        const half = tip.offsetWidth / 2
        const center = path.left + x * path.u
        const shift = Math.min(Math.max(center, half + 8), path.vw - half - 8) - center
        tip.style.setProperty('--shift', `${shift}px`)
      }
      body.style.transform = `translate3d(0,${bob}px,0) rotate(${tilt}deg) scaleX(${dir === 1 ? 1 : -1})`
      // 잔상 물결: 오리가 움직이는 동안 지나간 자리(꼬리 쪽)에 옅은 타원 물결을 남긴다. 남은 물결은 제자리에서 퍼지며 사라진다
      const moving = (c >= HOLD_S && c < HOLD_S + MOVE_S) || c >= HOLD_S * 2 + MOVE_S
      if (!reduce && moving && time >= nextWake && wake.childElementCount < MAX_WAKES) {
        nextWake = time + WAKE_EVERY_S
        const dw = parseFloat(root.style.getPropertyValue('--dw')) || 72
        const behind = (dir === 1 ? 1 : -1) * dw * 0.32 // 왼쪽을 볼 때(왼쪽으로 가는 중)는 오른쪽이 꼬리
        const ring = document.createElement('i')
        ring.style.left = `${x * path.u + behind - dw * 0.6}px`
        ring.style.top = `${path.ay - dw * 0.11}px`
        ring.style.width = `${dw * 1.2}px`
        ring.style.height = `${dw * 0.22}px`
        wake.appendChild(ring)
        const anim = ring.animate(
          [
            { opacity: 0.8, transform: 'scale(0.55)' },
            { opacity: 0, transform: 'scale(2.1)' },
          ],
          { duration: WAKE_LIFE_MS, easing: 'ease-out', fill: 'forwards' },
        )
        anim.onfinish = () => ring.remove()
      }
      // 눈 깜빡임: 4~7초마다 눈 감은 프레임을 아주 잠깐만 보여 준다
      if (!reduce) {
        if (!blinking && time >= nextBlink) {
          blinking = true
          blinkUntil = time + BLINK_S
          blink.style.visibility = 'visible'
        } else if (blinking && time >= blinkUntil) {
          blinking = false
          nextBlink = time + rand(4, 7)
          blink.style.visibility = 'hidden'
        }
      }
    }

    layout()
    if (reduce) {
      // 움직임 줄이기: 정지한 오리(수면 구간 가운데, 왼쪽을 봄)
      t = HOLD_S * 2 + MOVE_S * 1.5
      draw(t)
      window.addEventListener('resize', layout)
      return () => window.removeEventListener('resize', layout)
    }

    // 탭이 숨겨졌거나 인트로가 화면 밖이면 멈춘다(시간도 세지 않아 돌아오면 이어서 움직인다)
    let visible = !document.hidden
    let onScreen = true
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = 0
      if (!(visible && onScreen)) return
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0
      last = now
      t += dt
      draw(t)
      root.classList.remove('is-paused')
      raf = requestAnimationFrame(tick)
    }
    const sync = () => {
      cancelAnimationFrame(raf)
      raf = 0
      last = 0
      if (visible && onScreen) raf = requestAnimationFrame(tick)
      else root.classList.add('is-paused')
      root.getAnimations({ subtree: true }).forEach((a) => (visible && onScreen ? a.play() : a.pause()))
    }
    const onVis = () => {
      visible = !document.hidden
      sync()
    }
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting
        sync()
      },
      { threshold: 0.01 },
    )
    io.observe(root.parentElement ?? root)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', layout)
    sync()
    return () => {
      cancelAnimationFrame(raf)
      wake.replaceChildren()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', layout)
    }
  }, [])

  const sprite = {
    '--sheet': `url(${sheetUrl})`,
    '--sw': sheet.size.w,
  } as CSSProperties

  return (
    <div className="bh__duck" ref={rootRef} style={sprite}>
      <div className="bh__duck-wake" ref={wakeRef} />
      <div className="bh__duck-rig" ref={rigRef}>
        {/* 오리를 누르면 효과음이 난다. 투명한 누르는 영역이 오리를 따라다닌다 */}
        <button type="button" className="bh__duck-hit" aria-label="오리 소리 듣기" onClick={onPress} />
        <span className={`bh__duck-hint${hint ? ' is-on' : ''}`} ref={hintRef} aria-hidden="true">
          오리를 누르면 소리가 들려요
        </span>
        <div className="bh__duck-ripple">
          <i />
          <i />
        </div>
        <div className="bh__duck-body" ref={bodyRef}>
          <span className="bh__duck-frame" style={frameVars(BASE)} />
          <span className="bh__duck-frame bh__duck-frame--blink" ref={blinkRef} style={frameVars(BLINK)} />
        </div>
      </div>
    </div>
  )
}
