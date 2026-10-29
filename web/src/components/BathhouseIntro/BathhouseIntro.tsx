import { useEffect, useRef, useState } from 'react'
import stripUrl from '../../assets/bathhouse/stream-strip.png'
import Duck from './Duck'
import origUrl from '../../assets/bathhouse/orig.webp'
import { DUCK_ON, GHOST_ON, SCENE_ON, STEAM_ON, isIOS } from './iosLite'
import { bakeSteam, type SteamGroup } from './steamBake'
import GhostCursor from '../GhostCursor'
import { buildScene, STAGE_H, STAGE_W, type Scene } from './scene'
import { CANVAS_BOX, createWaterfall, LOOP_SECONDS } from './waterfall'
import soundOn from '../../assets/sound/sound-on.svg'
import soundOff from '../../assets/sound/sound-off.svg'
import ElasticSlider from '../ElasticSlider'
import { createBgm, type Bgm } from './bgm'
import { createSfx, type Sfx } from './sfx'
import './BathhouseIntro.css'

export type BathhouseIntroProps = {
  onEnter?: () => void
}

const LEAVE_MS = 700 // 눌렀을 때 화면이 천천히 옅어지는 시간 (CSS의 --leave와 같게)
const FRAME_MS = 1000 / 30 // 물줄기는 초당 30번 그린다
// 자동 화질: 물줄기를 그리는 데 걸리는 시간의 평균이 SLOW_DRAW_MS를 넘으면(느린 기기) 캔버스 배율을 0.75배씩 낮춘다(최대 2번).
const SLOW_DRAW_MS = 12
const SAMPLE_FRAMES = 30
const MAX_LEVEL = 2
const BGM_SRC = `${import.meta.env.BASE_URL}audio/intro.wav` // web/public/audio/intro.wav (인트로에서만 재생)
const QUACK_SRC = `${import.meta.env.BASE_URL}audio/duck-quack.wav` // 오리를 눌렀을 때 나는 효과음(web/public/audio/)
const BGM_VOLUME = 10// 처음 음량(0~100). 슬라이더 화면 값도 이 값에서 시작한다

/** 무대(1536×1024) 안의 위치·크기를 화면 크기에 맞는 길이로 바꾼다 */
const place = (b: { x: number; y: number; w: number; h: number }) => ({
  left: `calc(${b.x} * var(--u))`,
  top: `calc(${b.y} * var(--u))`,
  width: `calc(${b.w} * var(--u))`,
  height: `calc(${b.h} * var(--u))`,
})

/**
 * 인트로: Figma 'Bathhouse_Motion_v3 / 원본 질감 복원'(381:2)의 레이어를 그대로 쌓는다.
 *   고정 배경(하늘·해 포함) → 구름 덩어리 → 창틀·스카이라인(고정) → 해 밝기 → 수면 반사 → 물줄기(Canvas) → 수증기 3층
 * 모든 레이어가 같은 1536×1024 무대 안에 있어서 화면 크기가 바뀌어도 서로 어긋나지 않는다.
 */
export default function BathhouseIntro({ onEnter }: BathhouseIntroProps) {
  const [isLeaving, setIsLeaving] = useState(false)
  const [scene, setScene] = useState<Scene | null>(null)
  // 고스트 커서 색은 컬러 시스템의 크림(--tb-cream-sun)에서 읽는다. 연기가 짙은 곳은 더 밝게 빛난다
  const [smoke] = useState(() => getComputedStyle(document.documentElement).getPropertyValue('--tb-cream-sun').trim() || '#FDF6D0')
  const timerRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const fallRef = useRef<HTMLCanvasElement>(null)

  const [volume, setVolume] = useState(BGM_VOLUME)
  const [duckPressed, setDuckPressed] = useState(false) // 오리를 한 번 눌렀는지(오리 위 안내는 그때까지만)
  // iOS는 수증기를 마스크 없이 미리 구운 그림으로 쓴다(steamBake.ts)
  const [steamBaked, setSteamBaked] = useState<Record<SteamGroup, string> | null>(null)
  // 글·버튼은 장면이 준비된 뒤에 나타난다(그림보다 글이 먼저 보이는 어색함을 막는다). 장면 만들기가 실패하거나 너무 오래 걸리면 글부터 보여 준다.
  const [loadGaveUp, setLoadGaveUp] = useState(false)
  const [soundAsked, setSoundAsked] = useState(false) // 첫 클릭·키 입력이 있었는지(오리 위 안내를 그때까지만 보여 준다)
  const bgmRef = useRef<Bgm | null>(null)
  const sfxRef = useRef<Sfx | null>(null)
  const volumeRef = useRef(volume)
  volumeRef.current = volume

  // 배경음악: 브라우저는 소리 자동재생을 막아서, 먼저 시도하고 안 되면 첫 클릭·키 입력에 시작한다.
  // 인트로가 사라져도 소리는 디졸브로 끝까지 줄어든다(bgm.ts).
  useEffect(() => {
    const bgm = createBgm(BGM_SRC, volumeRef.current / 100)
    bgmRef.current = bgm
    bgm.play()
    // 오리를 누를 때도 첫 클릭이라 배경음악이 함께 시작한다(오리 효과음은 따로 난다)
    const start = () => {
      bgm.play()
      setSoundAsked(true)
    }
    window.addEventListener('pointerdown', start)
    window.addEventListener('keydown', start)
    return () => {
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
      bgm.release()
      bgmRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isIOS() || !STEAM_ON) return
    let dead = false
    bakeSteam()
      .then((b) => !dead && setSteamBaked(b))
      .catch((e) => console.error(e))
    return () => {
      dead = true
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setLoadGaveUp(true), 6000)
    return () => window.clearTimeout(timer)
  }, [])

  // 오리 효과음
  useEffect(() => {
    const sfx = createSfx(QUACK_SRC)
    sfxRef.current = sfx
    return () => {
      sfx.release()
      sfxRef.current = null
    }
  }, [])

  useEffect(() => {
    bgmRef.current?.setVolume(volume / 100)
  }, [volume])

  // 나가기를 누르는 순간부터 소리를 줄이기 시작한다
  useEffect(() => {
    if (isLeaving) bgmRef.current?.fadeOut()
  }, [isLeaving])

  const handleEnter = () => {
    if (isLeaving) return
    setIsLeaving(true)
    timerRef.current = window.setTimeout(() => onEnter?.(), LEAVE_MS)
  }

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!SCENE_ON) return // iOS 점검 중: 캔버스 합성을 하지 않는다(iosLite.ts)
    const stage = stageRef.current
    const baseCanvas = baseRef.current
    const fall = fallRef.current
    if (!stage || !baseCanvas || !fall) return
    const fallCtx = fall.getContext('2d')
    if (!fallCtx) return
    let dead = false
    let raf = 0
    let k = 1 // 원본 1px당 캔버스 픽셀 수
    let level = 0 // 자동 화질 단계
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const fit = () => {
      const w = stage.getBoundingClientRect().width
      k = Math.max(0.75, (w / STAGE_W) * Math.min(window.devicePixelRatio || 1, 2) * Math.pow(0.75, level))
      fall.width = Math.round(CANVAS_BOX.w * k)
      fall.height = Math.round(CANVAS_BOX.h * k)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)

    const strip = new Image()
    strip.src = stripUrl
    Promise.all([buildScene(), strip.decode()])
      .then(([built]) => {
        if (dead) return
        baseCanvas.width = built.base.width
        baseCanvas.height = built.base.height
        baseCanvas.getContext('2d')!.drawImage(built.base, 0, 0)

        const c = document.createElement('canvas')
        c.width = strip.naturalWidth
        c.height = strip.naturalHeight
        const sctx = c.getContext('2d')!
        sctx.drawImage(strip, 0, 0)
        const waterfall = createWaterfall(sctx.getImageData(0, 0, c.width, c.height))
        setScene(built)
        if (reduce) {
          waterfall.draw(fallCtx, 0, k) // 모션 줄이기: 멈춘 한 컷
          return
        }
        const t0 = performance.now()
        let last = -FRAME_MS
        let sum = 0
        let count = 0
        const tick = (now: number) => {
          raf = requestAnimationFrame(tick)
          if (now - last < FRAME_MS) return
          last = now
          const began = performance.now()
          waterfall.draw(fallCtx, ((now - t0) / 1000) % LOOP_SECONDS, k)
          if (level < MAX_LEVEL) {
            sum += performance.now() - began
            if (++count >= SAMPLE_FRAMES) {
              if (sum / count > SLOW_DRAW_MS) {
                level++
                fit()
              }
              sum = 0
              count = 0
            }
          }
        }
        raf = requestAnimationFrame(tick)
      })
      .catch((e) => {
        console.error(e)
        setLoadGaveUp(true)
      })

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <main className={`bh${isLeaving ? ' bh--leaving' : ''}${scene || !SCENE_ON || loadGaveUp ? ' bh--ready' : ''}`} aria-labelledby="bh-title">
      <div className={`bh__stage${scene || !SCENE_ON ? ' bh__stage--ready' : ''}`} ref={stageRef} aria-hidden="true">
        {!SCENE_ON && <div className="bh__lite-bg" style={{ backgroundImage: `url(${origUrl})` }} />}
        {SCENE_ON && <canvas className="bh__base" ref={baseRef} />}

        {SCENE_ON && (
          <div className="bh__clouds">
            <div className="bh__cloud-tex" />
          </div>
        )}

        {SCENE_ON && scene && (
          <>
            <div className="bh__piece bh__piece--frame" style={{ ...place(scene.frame), backgroundImage: `url(${scene.frame.url})` }} />
            <div className="bh__piece bh__piece--sun" style={{ ...place(scene.sun), backgroundImage: `url(${scene.sun.url})` }} />
            <div className="bh__piece bh__piece--reflection" style={{ ...place(scene.reflection), backgroundImage: `url(${scene.reflection.url})` }} />
          </>
        )}

        {SCENE_ON && <canvas className="bh__fall" ref={fallRef} />}

        {/* 수면을 떠다니는 오리: 수증기 아래, 글과 겹치지 않는 수면 구간. 누르면 효과음이 난다 */}
        {DUCK_ON && (scene || !SCENE_ON) && (
          <Duck
            hint={!soundAsked && !duckPressed}
            onPress={() => {
              sfxRef.current?.play()
              setDuckPressed(true)
            }}
          />
        )}

        {STEAM_ON && scene && (!isIOS() || steamBaked) && (
          <div className="bh__steams">
            {(['back', 'mid', 'front'] as const).map((name) =>
              [0, 1].map((copy) =>
                steamBaked && copy ? null : ( // iOS는 층마다 한 장만(메모리). 구워 둔 그림을 쓰고 마스크는 쓰지 않는다
                  <div
                    key={`${name}${copy}`}
                    className={`bh__layer bh__steam bh__steam--${name}${copy ? ' bh__steam--late' : ''}${steamBaked ? ' bh__steam--baked' : ''}`}
                    style={steamBaked ? { backgroundImage: `url(${steamBaked[name]})` } : undefined}
                  />
                ),
              ),
            )}
          </div>
        )}
      </div>

      {/* 화면 전체에 깔리는 커서 연기. 그려 둔 에셋에 묶여 있지 않고 화면 위를 그대로 덮는다(마우스가 닿지 않는 장면 레이어는 그대로) */}
      {GHOST_ON && <GhostCursor color={smoke} size={72} trailLength={45} inertia={0.5} turbulence={0.5} drift={0.3} bloomStrength={0.5} bloomRadius={0.4} grainIntensity={0.04} brightness={0.7} zIndex={1} excludeSelector=".bh__link, .bh__duck-hit" excludeNearSelector=".bh__volume" excludeNearRatio={0.1} />}

      <div className="bh__copy">
        <p className="bh__brand">탕방</p>
        <h1 id="bh-title">
          일은 안 풀려도,
          <br />
          몸은 풀려야죠.
        </h1>
        <p className="bh__sub">서울의 목욕탕을 찾아서.</p>
        <button className="bh__link" type="button" onClick={handleEnter} disabled={isLeaving}>
          <span>목욕탕 찾아보기</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="bh__volume">
        {/* 아이콘은 검은색 SVG라서 마스크로 쓰고, 색은 글자색(currentColor)을 따른다 */}
        <ElasticSlider
          value={volume}
          onChange={setVolume}
          valuePosition="none"
          ariaLabel="배경음악 볼륨"
          thickness={4}
          activeThickness={8}
          leftIcon={<span className="bh__sound-icon" aria-hidden="true" style={{ '--icon': `url("${soundOff}")` } as React.CSSProperties} />}
          rightIcon={<span className="bh__sound-icon" aria-hidden="true" style={{ '--icon': `url("${soundOn}")` } as React.CSSProperties} />}
        />
      </div>

      <p className="bh__status" aria-live="polite">
        {isLeaving ? '목욕탕 찾기 화면으로 이동합니다.' : ''}
      </p>
    </main>
  )
}
