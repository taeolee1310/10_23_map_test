import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react'
import { CATEGORIES, catLabel, chaptersOf, fetchStories, fetchStory, go, isStoryKey, parseBody, storyDate, storyPath, type Story, type StoryCategory } from '../../lib/stories'
import { track } from '../../lib/track'
import './Magazine.css'

// 매거진: 웹(821px 이상)은 책장을 넘기는 펼침면, 모바일은 위에서 아래로 스크롤. 같은 데이터·같은 본문 해석을 쓰고 모양만 다르다.
const WIDE = '(min-width: 821px)'
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const m = window.matchMedia(WIDE)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const block = (e: { preventDefault: () => void }) => e.preventDefault()

export default function Magazine({ slug }: { slug: string | null }) {
  const [stories, setStories] = useState<Story[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    track('magazine_open')
    fetchStories().then(setStories, () => setFailed(true))
  }, [])
  useEffect(() => {
    document.title = slug ? '탕방 매거진' : '탕방 매거진 · 목욕에 이야기를 담다'
    window.scrollTo(0, 0)
  }, [slug])

  return (
    // 독자 화면은 글·그림을 긁어 가지 못하게 한다: 글자 선택·복사·오른쪽 버튼 메뉴·그림 끌어 저장을 막는다(주소 공유는 '공유하기'로).
    // 화면 캡처나 개발자 도구까지 막을 수는 없다. 작성 화면에는 적용하지 않는다
    <div className="mag mag--lock" onCopy={block} onCut={block} onContextMenu={block} onDragStart={block}>
      <TopBar compact={!!slug} />
      {slug ? <StoryView slug={slug} stories={stories ?? []} /> : <StoryList stories={stories} failed={failed} />}
    </div>
  )
}

// 글을 읽는 화면에서는 머리를 한 줄로 줄여 책·본문에 자리를 내준다
function TopBar({ compact }: { compact: boolean }) {
  return (
    <header className={`mag-top${compact ? ' mag-top--compact' : ''}`}>
      <a className="mag-logo" href="/magazine" onClick={(e) => (e.preventDefault(), go('/magazine'))}>
        TANGBANG Magazine
        <span>목욕에 이야기를 담다</span>
      </a>
      <nav className="mag-nav" aria-label="서비스 메뉴">
        <a href="/" onClick={(e) => (e.preventDefault(), go('/'))}>목욕탕 지도</a>
        <a href="/magazine" aria-current="page" onClick={(e) => (e.preventDefault(), go('/magazine'))}>매거진</a>
      </nav>
    </header>
  )
}

function Cover({ story, className = '', eager = false }: { story: Pick<Story, 'cover' | 'title'>; className?: string; eager?: boolean }) {
  // 대표 사진이 없으면 빈 줄무늬 자리를 둔다(임의 그림을 만들어 넣지 않는다)
  return story.cover ? <img className={`mag-cover ${className}`} src={story.cover} alt="" loading={eager ? 'eager' : 'lazy'} /> : <div className={`mag-cover mag-cover--empty ${className}`} aria-hidden="true" />
}

function DateLine({ story }: { story: Story }) {
  const d = storyDate(story.published_at)
  return (
    <div className="mag-date">
      <span>
        <b>{d.md}</b>
        <i>({d.wd})</i>
      </span>
      <span className="mag-pill">{catLabel(story.category)}</span>
    </div>
  )
}

function StoryList({ stories, failed }: { stories: Story[] | null; failed: boolean }) {
  const [cat, setCat] = useState<StoryCategory | 'all'>('all')
  const list = useMemo(() => (stories ?? []).filter((s) => cat === 'all' || s.category === cat), [stories, cat])
  const count = (c: StoryCategory) => (stories ?? []).filter((s) => s.category === c).length
  return (
    <main className="mag-list">
      <h1 className="mag-h">STORIES</h1>
      <div className="mag-cats" role="tablist" aria-label="카테고리">
        <button role="tab" aria-selected={cat === 'all'} onClick={() => setCat('all')}>
          전체<sup>{stories?.length ?? 0}</sup>
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.value} role="tab" aria-selected={cat === c.value} onClick={() => setCat(c.value)}>
            {c.label}
            <sup>{count(c.value)}</sup>
          </button>
        ))}
      </div>
      {failed && <p className="mag-empty">이야기를 불러오지 못했어요. 잠시 뒤에 다시 들러 주세요.</p>}
      {stories && !failed && !list.length && <p className="mag-empty">{stories.length ? '이 카테고리에는 아직 이야기가 없어요.' : '첫 이야기를 준비하고 있어요.'}</p>}
      <div className="mag-grid">
        {list.map((s, i) => (
          // 맨 앞(가장 최근) 글 한 편은 크게 보여 준다. 대표 사진이 없는 글은 빈 사진 자리 없이 글만 둔다
          <a key={s.id} className={`mag-card${i === 0 ? ' mag-card--lead' : ''}${s.cover ? '' : ' mag-card--text'}`} style={{ '--i': i } as CSSProperties} href={storyPath(s)} onClick={(e) => (e.preventDefault(), go(storyPath(s)))}>
            <h2>{s.title}</h2>
            <DateLine story={s} />
            {s.cover && <Cover story={s} />}
            {s.summary && <p className="mag-sum">{s.summary}</p>}
          </a>
        ))}
      </div>
    </main>
  )
}

// 본문 블록: 글자는 모두 textContent로 들어간다(HTML 해석 안 함)
// 장 여는 사진: 장 나누기 바로 다음 줄이 사진이면 그 사진이 장을 연다(사진 → 장 번호 → 장 제목 순).
// 책에서는 왼쪽 쪽 전체가 그 사진, 오른쪽 쪽이 글이다. pads[n]이 참이면 n장 앞에 빈 쪽을 하나 둬서 사진이 왼쪽 쪽에 오게 한다.
// inline[n]이 참이면(글이 한 쪽에 다 안 들어가는 장) 사진을 줄여 같은 쪽에서 글이 시작한다. 둘 다 Book이 계산한다
export function ArticleBody({ body, pads, inline, eager = false }: { body: string; pads?: boolean[]; inline?: boolean[]; eager?: boolean }) {
  const blocks = useMemo(() => parseBody(body), [body])
  const loading = eager ? 'eager' : 'lazy'
  const out: ReactNode[] = []
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1]
    if (b.kind === 'ch') {
      const lead = blocks[i + 1]
      if (lead?.kind === 'img') {
        if (pads?.[b.n]) out.push(<div key={`pad${i}`} className="mag-blank" aria-hidden="true">· · ·</div>)
        out.push(
          <figure key={i + 1} className={`mag-fig mag-fig--lead${inline?.[b.n] ? ' mag-fig--inline' : ''}`} data-ch={b.n}>
            <img src={lead.src} alt={lead.alt} loading={loading} />
            {lead.alt && <figcaption>{lead.alt}</figcaption>}
          </figure>,
        )
      }
      out.push(
        // 장 나누기: 짧은 굵은 선 + 장 번호
        <div key={i} className="mag-ch" data-ch={b.n}>
          <span>CHAPTER {String(b.n).padStart(2, '0')}</span>
        </div>,
      )
    } else if (b.kind === 'img') {
      if (prev?.kind === 'ch') return // 장 여는 사진은 위에서 이미 넣었다
      out.push(
        <figure key={i} className="mag-fig">
          <img src={b.src} alt={b.alt} loading={loading} />
          {b.alt && <figcaption>{b.alt}</figcaption>}
        </figure>,
      )
    } else if (b.kind === 'h') out.push(<h3 key={i}>{b.text}</h3>)
    else if (b.kind === 'quote') out.push(<blockquote key={i}>{b.text}</blockquote>)
    else out.push(<p key={i}>{b.text}</p>)
  })
  return <>{out}</>
}

function StoryView({ slug, stories }: { slug: string; stories: Story[] }) {
  const wide = useWide()
  const [story, setStory] = useState<Story | null | undefined>(undefined)
  useEffect(() => {
    setStory(undefined)
    fetchStory(slug).then(
      (s) => {
        setStory(s)
        if (s) {
          document.title = `${s.title} · 탕방 매거진`
          // 예전 영문 주소로 들어오면 주소창을 번호 주소로 바꿔 둔다(공유할 때 번호 주소가 퍼지게)
          if (location.pathname !== storyPath(s)) history.replaceState(history.state, '', storyPath(s))
        }
      },
      () => setStory(null),
    )
  }, [slug])
  const next = useMemo(() => {
    const i = stories.findIndex((s) => isStoryKey(s, slug))
    return i >= 0 ? stories[(i + 1) % stories.length] : stories[0]
  }, [stories, slug])

  if (story === undefined) return <p className="mag-empty">불러오는 중…</p>
  if (story === null)
    return (
      <p className="mag-empty">
        이야기를 찾지 못했어요.{' '}
        <a href="/magazine" onClick={(e) => (e.preventDefault(), go('/magazine'))}>매거진으로 돌아가기</a>
      </p>
    )
  const nextStory = next && next.id !== story.id ? next : null
  return wide ? <Book story={story} next={nextStory} /> : <Scroll story={story} next={nextStory} />
}

function EndBlock({ story, next }: { story: Story; next: Story | null }) {
  const share = async () => {
    const url = location.origin + storyPath(story)
    try {
      if (navigator.share) await navigator.share({ title: story.title, url })
      else {
        await navigator.clipboard.writeText(url)
        alert('주소를 복사했어요')
      }
    } catch {
      /* 공유 취소 */
    }
  }
  return (
    <div className="mag-end">
      <div className="mag-dots" aria-hidden="true">· · ·</div>
      <div className="mag-actions">
        <button className="mag-btn" onClick={share}>공유하기</button>
        <a className="mag-btn" href="/" onClick={(e) => (e.preventDefault(), go('/'))}>서울 목욕탕 지도 보기</a>
      </div>
      {next && (
        <div className="mag-next">
          <span>NEXT STORY</span>
          <strong>{next.title}</strong>
          <a className="mag-btn mag-btn--primary" href={storyPath(next)} onClick={(e) => (e.preventDefault(), go(storyPath(next)))}>
            다음 이야기 읽기
          </a>
        </div>
      )}
    </div>
  )
}

function Head({ story }: { story: Story }) {
  return (
    <header className="mag-art-head">
      <DateLine story={story} />
      <h1>{story.title}</h1>
      <p className="mag-by">글 {story.author}</p>
      {story.summary && <p className="mag-lead">{story.summary}</p>}
    </header>
  )
}

// 모바일: 위에서 아래로. 끝이 보이면 '끝까지 읽음'을 센다
// 맨 위 가는 선은 읽은 만큼 찬다(스크롤마다 다시 그리지 않고 선의 transform만 바꾼다).
// 사진·장 번호·장 제목은 화면에 들어올 때 한 번 조용히 떠오른다. 글 문단은 움직이지 않는다(읽는 글은 가만히 둔다)
function Scroll({ story, next }: { story: Story; next: Story | null }) {
  const end = useRef<HTMLDivElement>(null)
  const art = useRef<HTMLElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = end.current
    if (!el) return
    let done = false
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !done) {
        done = true
        track('story_read')
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [story.slug])
  useEffect(() => {
    let raf = 0
    const paint = () => {
      raf = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0})`
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(paint)
    }
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    paint()
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [story.slug])
  useEffect(() => {
    const root = art.current
    if (!root || reduceMotion() || !('IntersectionObserver' in window)) return
    const els = [...root.querySelectorAll<HTMLElement>('.mag-body .mag-fig, .mag-body .mag-ch, .mag-body .mag-ch + h3')]
    const io = new IntersectionObserver(
      (list) =>
        list.forEach((e) => {
          if (!e.isIntersecting) return
          e.target.classList.add('is-in')
          io.unobserve(e.target)
        }),
      { rootMargin: '0px 0px -10% 0px' },
    )
    els.forEach((el) => {
      el.classList.add('mag-rv')
      io.observe(el)
    })
    return () => {
      io.disconnect()
      els.forEach((el) => el.classList.remove('mag-rv', 'is-in'))
    }
  }, [story.slug, story.body])
  return (
    <>
      {/* 떠오르는 본문(transform) 밖에 둬야 화면 맨 위에 붙는다 */}
      <div className="mag-read" aria-hidden="true">
        <div ref={bar} />
      </div>
    <article className="mag-scroll" ref={art}>
      <Cover story={story} className="mag-cover--hero" />
      <div className="mag-scroll-in">
        <Head story={story} />
        <div className="mag-body">
          <ArticleBody body={story.body ?? ''} />
        </div>
        <div ref={end}>
          <EndBlock story={story} next={next} />
        </div>
      </div>
    </article>
    </>
  )
}

// 웹: 책. 본문을 CSS 다단(column)으로 흘려 쪽을 나누고, 왼쪽·오른쪽 쪽은 같은 본문을 창으로 잘라 보여 준다.
// 넘길 때는 한 장(앞면=지금 쪽, 뒷면=다음 쪽)이 책등을 축으로 3D로 돌아간다(StPageFlip 연출 참고, 라이브러리 없이 CSS 3D).
// 넘기는 장은 세로 띠 STRIPS개로 나뉘어 띠마다 조금씩 더 꺾인다: 들릴 때는 바깥 끝이 먼저 가고, 내려앉을 때는 바깥 끝이 늦게 따라온다(종이가 휘는 모양).
// 띠 경계마다 기울기에 맞춘 그늘을 이어 붙여 휜 면처럼 보이게 한다. 움직이는 것은 transform·opacity뿐이다.
// 쪽 바깥 여백을 잡고 끌어도 넘어간다: 끄는 만큼 장이 따라오고, 반 넘게 끌거나 빠르게 밀고 놓으면 마저 넘어가고 아니면 돌아온다.
// 쪽 어디서나(링크·버튼 위는 빼고) 넘길 방향으로 8px 넘게 끌면 끌기가 시작된다. 쪽 안을 그냥 누르는 것은 넘기지 않는다.
// 마우스를 여백에 올리면 장 끝이 살짝 들려 잡을 수 있다는 것을 알린다. 여백을 그냥 누르면 한 장 넘어간다.
// 첫 쪽은 대표 사진. 장 여는 사진이 있는 장은 왼쪽 쪽 전체가 사진, 오른쪽 쪽이 글이다.
// 움직임 원칙: 버튼으로 넘길 때만 책장이 돈다. ← → 키는 자주 반복하는 동작이라 바로 바뀐다.
// 넘기는 중에 또 누르면 지금 장을 빠르게 마저 넘기고 다음 장으로 이어 간다(누른 것을 버리지 않음).
// 모션 줄이기면 회전 없이 짧게 흐려졌다 나타난다.
type Geo = { w: number; g: number; pad: number; h: number }
const FLIP_MS = 720
const FLIP_RUSH = 3 // 넘기는 중 다시 누르면 남은 회전을 3배 빠르게
const FADE_MS = 180
const STRIPS = 4 // 넘기는 장을 나누는 세로 띠 수
const BEND = 13 // 띠 사이가 가장 많이 꺾일 때의 각도(도)
const SHADE = 0.26 // 장이 옆으로 섰을 때 그늘의 짙기
const FRAMES = 30
const PEEK = 0.03 // 마우스를 쪽 여백에 올렸을 때 장이 들리는 정도(0~1)

// motion.css --ease-drawer(0.32, 0.72, 0, 1)를 숫자로 푼다: 처음이 빨라 누르자마자 장이 들린다.
// 휘는 정도와 그늘을 '넘어간 정도'에 맞춰 계산하려고 곡선을 키프레임에 직접 굽는다
function easeDrawer(t: number) {
  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * 0.32 + u * u * u
  const by = (u: number) => 3 * (1 - u) * (1 - u) * u * 0.72 + 3 * (1 - u) * u * u + u * u * u
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2
    if (bx(m) < t) lo = m
    else hi = m
  }
  return by((lo + hi) / 2)
}
// 키프레임 시각마다의 '넘어간 정도'. 끌어서 넘길 때는 거꾸로, 넘어간 정도에서 애니메이션 시각을 찾는다
const EASED = Array.from({ length: FRAMES + 1 }, (_, k) => easeDrawer(k / FRAMES))
function timeOf(p: number) {
  const v = Math.max(0, Math.min(1, p))
  let k = 0
  while (k < FRAMES - 1 && EASED[k + 1] < v) k++
  const [a, b] = [EASED[k], EASED[k + 1]]
  return (k + (b > a ? (v - a) / (b - a) : 0)) / FRAMES
}
// 넘기는 장의 키프레임. dir 1 = 앞으로(오른쪽 장이 왼쪽으로), -1 = 뒤로
// strips[i]: i번째 띠의 회전(0번은 책등을 축으로 도는 전체 회전, 나머지는 앞 띠보다 더 꺾인 각도)
// front·back[e]: e번째 띠 경계의 그늘(앞면·뒷면). reveal: 장이 떠나며 드러나는 쪽의 그림자, land: 장이 내려앉는 쪽의 그림자
function flipFrames(dir: 1 | -1) {
  const sin = (deg: number) => Math.sin((deg * Math.PI) / 180)
  const mk = (n: number): Keyframe[][] => Array.from({ length: n }, () => [])
  const [strips, front, back] = [mk(STRIPS), mk(STRIPS + 1), mk(STRIPS + 1)]
  const reveal: Keyframe[] = []
  const land: Keyframe[] = []
  for (let k = 0; k <= FRAMES; k++) {
    const offset = k / FRAMES
    const p = EASED[k]
    const turn = 180 * p
    const bend = BEND * Math.sin(2 * Math.PI * p) * (p < 0.5 ? 1 : 0.55)
    for (let i = 0; i < STRIPS; i++) strips[i].push({ offset, transform: `rotateY(${(-dir * (i ? bend : turn)).toFixed(2)}deg)` })
    for (let e = 0; e <= STRIPS; e++) {
      const tilt = Math.max(0, Math.min(180, turn + bend * Math.max(0, Math.min(STRIPS - 1, e - 0.5))))
      front[e].push({ offset, opacity: +(SHADE * sin(Math.min(tilt, 90))).toFixed(3) })
      back[e].push({ offset, opacity: +(SHADE * sin(Math.max(tilt, 90))).toFixed(3) })
    }
    reveal.push({ offset, opacity: +(0.5 * (1 - p)).toFixed(3) })
    land.push({ offset, opacity: +(p > 0.5 ? 0.3 * sin(360 * (p - 0.5)) : 0).toFixed(3) })
  }
  return { strips, front, back, reveal, land }
}

// 쪽 하나: 같은 본문 흐름을 옆으로 밀어 col번째 단만 창에 보인다.
// 미는 것은 left가 아니라 transform이다: 쪽을 바꿀 때 다단 배치를 다시 계산하지 않고 합성만 한다
function Half(p: { side: 'left' | 'right'; col: number; geo: Geo; children: ReactNode; extra?: ReactNode; className?: string; flowRef?: Ref<HTMLDivElement>; hidden?: boolean }) {
  return (
    <div className={`mag-half mag-half--${p.side} ${p.className ?? ''}`} aria-hidden={p.hidden ? true : undefined}>
      <div ref={p.flowRef} className="mag-flow" style={{ transform: `translateX(${p.geo.pad - p.col * (p.geo.w + p.geo.g)}px)`, width: 2 * p.geo.w + p.geo.g }}>
        {p.children}
      </div>
      {p.extra}
    </div>
  )
}

// 넘기는 장의 띠. i번째 띠는 앞 띠의 바깥 끝에 매달려 있다(안쪽 띠가 돌면 바깥 띠가 함께 돈다).
// 띠마다 앞면(front번째 쪽)·뒷면(rear번째 쪽)을 제 자리만큼만 잘라 보여 준다. back: 뒤로 넘기는 장(책등이 오른쪽)
function Strips(p: { i?: number; back: boolean; front: number; rear: number; geo: Geo; children: ReactNode }) {
  const i = p.i ?? 0
  if (i >= STRIPS) return null
  const sw = (p.geo.w + 2 * p.geo.pad) / STRIPS
  const near = i * sw
  const far = (STRIPS - 1 - i) * sw
  const face = (col: number, off: number, rear: boolean) => (
    <div className={`mag-face${rear ? ' mag-face--back' : ''}`}>
      <div className="mag-flow" style={{ transform: `translateX(${p.geo.pad - col * (p.geo.w + p.geo.g) - off}px)`, width: 2 * p.geo.w + p.geo.g }}>
        {p.children}
      </div>
      <div className="mag-shade mag-sh--l" />
      <div className="mag-shade mag-sh--r" />
    </div>
  )
  return (
    <div className="mag-strip" style={{ width: i ? '100%' : sw }}>
      {face(p.front, p.back ? far : near, false)}
      {face(p.rear, p.back ? near : far, true)}
      <Strips {...p} i={i + 1} />
    </div>
  )
}

// 작성 화면에 알려 주는 쪽 배치: 전체 쪽 수와, 장마다 시작하는 쪽 번호(0 = 대표 사진 쪽). starts[0]은 여는 글, starts[n]은 n장
export type BookLayout = { pages: number; starts: number[] }

// preview: 작성 화면의 웹 미리보기. 행동 기록(끝까지 읽음)을 남기지 않고, ← → 키를 받지 않는다(본문을 쓰는 중이라)
// onLayout: 쪽을 다시 셀 때마다 장별 시작 쪽을 알려 준다. jump: 작성 화면의 장 목록에서 고른 펼침면으로 바로 넘긴다(key가 바뀔 때마다)
export function Book({ story, next, preview = false, onLayout, jump }: { story: Story; next: Story | null; preview?: boolean; onLayout?: (l: BookLayout) => void; jump?: { spread: number; key: number } }) {
  const onLayoutRef = useRef(onLayout)
  onLayoutRef.current = onLayout
  const book = useRef<HTMLDivElement>(null)
  const flow = useRef<HTMLDivElement>(null)
  const leaf = useRef<HTMLDivElement>(null)
  const castL = useRef<HTMLDivElement>(null) // 뒤로 넘길 때 드러나는 왼쪽 쪽의 그림자
  const castR = useRef<HTMLDivElement>(null) // 앞으로 넘길 때 드러나는 오른쪽 쪽의 그림자
  const [spread, setSpread] = useState(0)
  const [spreads, setSpreads] = useState(1)
  const [geo, setGeo] = useState<Geo>({ w: 0, g: 0, pad: 0, h: 0 })
  const [flip, setFlip] = useState<0 | 1 | -1>(0)
  const [starts, setStarts] = useState<number[]>([]) // 장마다 시작하는 쪽(0번은 여는 글)
  const [pads, setPads] = useState<boolean[]>([]) // 장 여는 사진이 왼쪽 쪽에 오도록 앞에 빈 쪽을 둘 장
  const [inline, setInline] = useState<boolean[]>([]) // 글이 한 쪽에 다 안 들어가서 사진을 줄여 싣는 장
  // 1단계: 책 크기에서 쪽 너비를 계산
  const measure = useCallback(() => {
    const el = book.current
    if (!el) return
    const pad = parseFloat(getComputedStyle(el).getPropertyValue('--book-pad')) || 48
    const g = pad * 2
    const w = (el.clientWidth - pad * 2 - g) / 2
    const h = el.clientHeight
    setGeo((o) => (o.w === w && o.pad === pad && o.h === h ? o : { w, g, pad, h }))
  }, [])
  // 2단계: 그 너비로 흘린 본문이 몇 쪽인지 센다
  const count = useCallback(() => {
    const el = flow.current
    if (!el || !geo.w) return
    const step = geo.w + geo.g
    const cols = Math.max(1, Math.round((el.scrollWidth + geo.g) / step))
    setSpreads(Math.ceil(cols / 2))
    // 장 시작 쪽: 다단 안에서 요소의 offsetLeft는 그 요소가 놓인 단의 왼쪽 끝(transform·확대와 상관없음)
    const colOf = (e: HTMLElement | null) => (e ? Math.max(0, Math.round(e.offsetLeft / step)) : 0)
    const chs = [...el.querySelectorAll<HTMLElement>('.mag-ch')]
    const first = chs.map((c) => {
      const prev = c.previousElementSibling as HTMLElement | null
      return prev?.classList.contains('mag-fig--lead') ? prev : c
    })
    const at = first.map(colOf)
    const st = [colOf(el.querySelector<HTMLElement>('.mag-body')), ...at]
    setStarts((o) => (o.join() === st.join() ? o : st))
    onLayoutRef.current?.({ pages: cols, starts: st })
    // 장의 글(사진 뺀 나머지)이 한 쪽에 다 들어가는지: 글 요소의 높이를 더해 쪽 높이와 견준다(쪽이 나뉜 요소는 조각 높이를 더한다).
    // 안 들어가면 사진을 한 쪽 가득 싣지 않고 줄여서 같은 쪽에 글을 잇는다. 화면이 낮은 노트북에서 장마다 빈 쪽이 생기는 것을 막는다
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1
    const tight: boolean[] = [false]
    chs.forEach((c, i) => {
      // 요소 높이 + 요소 사이 여백(위아래 여백은 큰 쪽 하나만 남는다). 마지막 요소의 아래 여백은 쪽 끝에서 잘리므로 세지 않는다
      let need = 0
      let below = 0
      for (let e: Element | null = c; e && e !== first[i + 1] && !e.classList.contains('mag-blank'); e = e.nextElementSibling) {
        const cs = getComputedStyle(e)
        need += Math.max(below, parseFloat(cs.marginTop) || 0)
        for (const r of e.getClientRects()) need += r.height / scale
        below = parseFloat(cs.marginBottom) || 0
      }
      tight.push(first[i] !== c && need > geo.h - geo.pad * 2 - 4)
    })
    setInline((o) => (o.join() === tight.join() ? o : tight))
    // 장 여는 사진은 왼쪽 쪽(짝수 번째 단)에 와야 한다. 앞 장의 글이 넘쳐 오른쪽 쪽에 걸리면 그 장 앞에 빈 쪽을 하나 둔다.
    // 빈 쪽 하나는 뒤를 정확히 한 단씩 밀기 때문에, 지금 놓인 자리에서 이미 둔 빈 쪽 수를 빼면 한 번에 계산된다
    let had = 0
    let add = 0
    const want: boolean[] = [false]
    chs.forEach((c, i) => {
      if (pads[i + 1]) had++
      const pad = first[i] !== c && !tight[i + 1] && (at[i] - had + add) % 2 === 1
      want.push(pad)
      if (pad) add++
    })
    setPads((o) => (o.join() === want.join() ? o : want))
  }, [geo, pads])
  useLayoutEffect(() => {
    setSpread(0)
    scrub.current = null
    setFlip(0)
    measure()
    const ro = new ResizeObserver(measure)
    if (book.current) ro.observe(book.current)
    return () => ro.disconnect()
  }, [story.slug, measure])
  useLayoutEffect(() => {
    count()
    document.fonts?.ready.then(count)
    const imgs = flow.current?.querySelectorAll('img') ?? []
    imgs.forEach((im) => im.addEventListener('load', count, { once: true }))
  }, [count, story.slug, story.body, inline])
  useEffect(() => setSpread((s) => Math.min(s, spreads - 1)), [spreads])
  useEffect(() => {
    if (!jump) return
    scrub.current = null
    setFlip(0)
    setSpread(Math.max(0, Math.min(jump.spread, spreads - 1)))
  }, [jump]) // eslint-disable-line react-hooks/exhaustive-deps

  const anims = useRef<Animation[]>([])
  const queued = useRef<{ d: 1 | -1; instant: boolean } | null>(null)
  const fadeNext = useRef(false)
  // 끌어서 넘기기: 넘기는 장의 애니메이션을 세워 두고, 넘어간 정도(p, 0~1)에 맞는 시각으로 옮긴다.
  // mode: peek = 마우스를 올려 살짝 들린 상태, drag = 끄는 중, settle = 놓은 뒤 마저 넘어가거나 돌아가는 중
  const scrub = useRef<{ dir: 1 | -1; mode: 'peek' | 'drag' | 'settle'; p: number; raf: number } | null>(null)
  const grab = useRef<{ x: number; p0: number; lastP: number; lastT: number; t0: number; v: number; moved: boolean } | null>(null)
  const plain = useRef(false) // 끌기를 시작하지 못한 누름(모션 줄이기 등): 누른 것으로만 넘긴다
  const setP = (p: number) => {
    const s = scrub.current
    if (!s) return
    s.p = p
    const t = timeOf(p) * FLIP_MS
    anims.current.forEach((a) => (a.currentTime = t))
  }
  const endScrub = (to: 0 | 1) => {
    const s = scrub.current
    if (!s) return
    cancelAnimationFrame(s.raf)
    scrub.current = null
    grab.current = null
    if (to === 1) setSpread((v) => v + s.dir)
    setFlip(0)
  }
  const tweenTo = (to: number, ms: number, done?: () => void) => {
    const s = scrub.current
    if (!s) return
    cancelAnimationFrame(s.raf)
    const from = s.p
    const t0 = performance.now()
    const step = (now: number) => {
      if (scrub.current !== s) return
      const k = Math.min(1, (now - t0) / ms)
      setP(from + (to - from) * (1 - Math.pow(1 - k, 3)))
      if (k < 1) s.raf = requestAnimationFrame(step)
      else done?.()
    }
    s.raf = requestAnimationFrame(step)
  }
  const settle = (to: 0 | 1) => {
    const s = scrub.current
    if (!s) return
    s.mode = 'settle'
    tweenTo(to, 180 + 380 * Math.abs(to - s.p), () => endScrub(to))
  }
  const begin = (d: 1 | -1, mode: 'peek' | 'drag') => {
    const t = spread + d
    if (flip || scrub.current || t < 0 || t > spreads - 1 || !geo.w || typeof Element.prototype.animate !== 'function' || reduceMotion()) return false
    scrub.current = { dir: d, mode, p: 0, raf: 0 }
    setFlip(d)
    return true
  }
  // 끄는 동안의 움직임·놓기는 책 전체에서 받는다(여백에서 시작한 끌기도 여기로 올라온다)
  const cand = useRef<{ x: number; d: 1 | -1; id: number } | null>(null) // 쪽 안에서 누른 뒤 아직 끌기로 정해지지 않은 상태
  const bookDrag = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || flip || scrub.current) return
      if ((e.target as HTMLElement).closest('a, button, .mag-grab')) return
      const r = e.currentTarget.getBoundingClientRect()
      cand.current = { x: e.clientX, d: e.clientX > r.left + r.width / 2 ? 1 : -1, id: e.pointerId }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const c = cand.current
      if (c) {
        if ((c.x - e.clientX) * c.d < 8) return
        cand.current = null
        if (!begin(c.d, 'drag')) return
        e.currentTarget.setPointerCapture(c.id)
        grab.current = { x: c.x, p0: 0, lastP: 0, lastT: e.timeStamp, t0: e.timeStamp, v: 0, moved: true }
      }
      const g = grab.current
      const s = scrub.current
      const half = e.currentTarget.getBoundingClientRect().width / 2
      if (!g || !s || !half) return
      // 장의 바깥 끝이 손을 따라온다: 끝의 가로 위치(책등에서 half ~ -half)를 넘어간 각도로 바꾼다
      const travel = (g.x - e.clientX) * s.dir
      if (Math.abs(travel) > 4) g.moved = true
      const edge = Math.max(-half, Math.min(half, half * Math.cos(Math.PI * g.p0) - travel))
      const p = Math.max(0.01, Math.acos(edge / half) / Math.PI)
      const dt = e.timeStamp - g.lastT
      if (dt > 0) {
        g.v = (p - g.lastP) / dt
        g.lastP = p
        g.lastT = e.timeStamp
      }
      setP(p)
    },
    onPointerUp: (e: ReactPointerEvent) => {
      cand.current = null
      const g = grab.current
      const s = scrub.current
      grab.current = null
      if (!g || !s) return
      const tap = !g.moved && e.timeStamp - g.t0 < 500 // 여백을 끌지 않고 누르기만 했으면 한 장 넘긴다
      const v = e.timeStamp - g.lastT > 120 ? 0 : g.v // 멈췄다가 놓으면 속도는 없는 것으로
      settle(tap || v > 0.0015 || (s.p > 0.5 && v > -0.0015) ? 1 : 0)
    },
    onPointerCancel: () => {
      cand.current = null
      grab.current = null
      if (scrub.current?.mode === 'drag') settle(0)
    },
  }
  const grabProps = (d: 1 | -1) => ({
    onPointerEnter: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && !e.buttons) begin(d, 'peek')
    },
    onPointerLeave: () => {
      if (scrub.current?.mode === 'peek') settle(0)
    },
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      const had = scrub.current
      if (had && (had.dir !== d || had.mode !== 'peek')) return
      if (!had && !begin(d, 'drag')) {
        plain.current = true
        return
      }
      const s = scrub.current
      if (!s) return
      cancelAnimationFrame(s.raf)
      s.mode = 'drag'
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
      grab.current = { x: e.clientX, p0: s.p, lastP: s.p, lastT: e.timeStamp, t0: e.timeStamp, v: 0, moved: false }
    },
    onClick: () => {
      if (!plain.current) return
      plain.current = false
      turn(d)
    },
  })
  const turn = useCallback(
    (d: 1 | -1, instant = false) => {
      const s = scrub.current
      if (flip && s) {
        // 살짝 들린 상태에서 버튼·키를 누르면: 같은 방향은 마저 넘기고, 키는 바로 바꾸고, 반대 방향은 내려놓은 뒤 넘긴다
        if (s.mode === 'peek') {
          if (instant) {
            const t = spread + d
            endScrub(0)
            if (t >= 0 && t <= spreads - 1) setSpread(t)
          } else if (d === s.dir) settle(1)
          else {
            queued.current = { d, instant }
            settle(0)
          }
        } else if (s.mode === 'settle') queued.current = { d, instant }
        return
      }
      if (flip) {
        queued.current = { d, instant }
        anims.current.forEach((a) => (a.playbackRate = FLIP_RUSH))
        return
      }
      const t = spread + d
      if (t < 0 || t > spreads - 1) return
      const canAnimate = !!geo.w && typeof Element.prototype.animate === 'function'
      if (instant || !canAnimate) setSpread(t)
      else if (reduceMotion()) {
        fadeNext.current = true
        setSpread(t)
      } else setFlip(d)
    },
    [flip, spread, spreads, geo.w],
  )
  // 넘기는 동안 눌러 둔 다음 장
  useEffect(() => {
    if (flip || !queued.current) return
    const q = queued.current
    queued.current = null
    turn(q.d, q.instant)
  }, [flip, turn])
  // 모션 줄이기: 회전 대신 쪽 글자가 짧게 옅어졌다 돌아온다
  useLayoutEffect(() => {
    if (!fadeNext.current) return
    fadeNext.current = false
    book.current?.querySelectorAll<HTMLElement>(':scope > .mag-half .mag-flow').forEach((el) => el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease' }))
  }, [spread])
  // 넘기는 장: 책등을 축으로 0 → ∓180도. 앞면은 넘어가며 어두워지고, 뒷면은 펴지며 밝아진다
  useLayoutEffect(() => {
    const el = leaf.current
    if (!flip || !el) return
    const opt = { duration: FLIP_MS, easing: 'linear', fill: 'forwards' as const } // 곡선은 flipFrames가 키프레임에 구워 넣었다
    const f = flipFrames(flip)
    const list: Animation[] = []
    el.querySelectorAll<HTMLElement>('.mag-strip').forEach((strip, i) => {
      list.push(strip.animate(f.strips[i], opt))
      strip.querySelectorAll<HTMLElement>(':scope > .mag-face').forEach((face, rear) => {
        const edge = rear ? f.back : f.front
        // 이 면에서 책등 쪽 가장자리가 왼쪽인 경우: 앞으로 넘기는 장의 앞면, 뒤로 넘기는 장의 뒷면
        const innerLeft = (flip === 1) !== (rear === 1)
        const l = face.querySelector<HTMLElement>('.mag-sh--l')
        const r = face.querySelector<HTMLElement>('.mag-sh--r')
        if (l) list.push(l.animate(edge[innerLeft ? i : i + 1], opt))
        if (r) list.push(r.animate(edge[innerLeft ? i + 1 : i], opt))
      })
    })
    const [reveal, land] = flip === 1 ? [castR.current, castL.current] : [castL.current, castR.current]
    if (reveal) list.push(reveal.animate(f.reveal, opt))
    if (land) list.push(land.animate(f.land, opt))
    if (!list.length) return
    anims.current = list
    // 끌어서 넘기는 중이면 세워 두고 손이 정한 자리로 옮긴다
    const sc = scrub.current
    if (sc) {
      list.forEach((a) => a.pause())
      setP(sc.p)
      if (sc.mode === 'peek') tweenTo(PEEK, 220)
    }
    let alive = true
    list[0].finished.then(
      () => {
        if (!alive) return
        setSpread((s) => s + flip)
        setFlip(0)
      },
      () => {},
    )
    return () => {
      alive = false
      list.forEach((a) => a.cancel())
      anims.current = []
      if (scrub.current) cancelAnimationFrame(scrub.current.raf)
      scrub.current = null
    }
  }, [flip])
  useEffect(() => {
    if (preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowRight') turn(1, true)
      if (e.key === 'ArrowLeft') turn(-1, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, preview])
  const readSent = useRef(false)
  useEffect(() => {
    readSent.current = false
  }, [story.slug])
  useEffect(() => {
    if (!preview && spreads > 0 && spread === spreads - 1 && !readSent.current) {
      readSent.current = true
      track('story_read')
    }
  }, [spread, spreads, preview])

  // 본문 사본 4개가 같은 요소 객체를 쓰면 쪽을 넘길 때 React가 본문 안을 다시 비교하지 않는다
  const content = useMemo(
    () => (
      <>
        <div className="mag-page-cover">
          <Cover story={story} eager />
        </div>
        <Head story={story} />
        <div className="mag-body">
          <ArticleBody body={story.body ?? ''} pads={pads} inline={inline} eager />
        </div>
        <EndBlock story={story} next={next} />
      </>
    ),
    [story, next, pads, inline],
  )
  // 책 아래 장 표시: 장 이름을 누르면 그 장이 시작하는 펼침면으로 간다. 바로 옆 장이면 책장이 넘어가고, 멀면 짧게 옅어졌다 바뀐다
  const chapters = useMemo(() => chaptersOf(story.body ?? ''), [story.body])
  const marks = starts.length === chapters.length ? chapters.slice(1).map((c) => ({ n: c.n, title: c.title, spread: Math.floor(starts[c.n] / 2) })) : []
  const cur = marks.reduce((a, m) => (m.spread <= spread ? m.n : a), 0)
  const goTo = (t: number) => {
    if (t === spread || t < 0 || t > spreads - 1) return
    if (flip) {
      if (scrub.current?.mode !== 'peek') return
      endScrub(0) // 살짝 들린 장은 내려놓고 바로 간다
      fadeNext.current = true
      setSpread(t)
      return
    }
    if (Math.abs(t - spread) === 1) return turn(t > spread ? 1 : -1)
    fadeNext.current = true
    setSpread(t)
  }
  // 깔린 쪽 번호: 앞으로 넘길 땐 오른쪽에 다음 장의 오른쪽 쪽, 뒤로 넘길 땐 왼쪽에 이전 장의 왼쪽 쪽
  const L = flip === -1 ? 2 * spread - 2 : 2 * spread
  const R = flip === 1 ? 2 * spread + 3 : 2 * spread + 1
  // 넘기는 장은 늘 깔아 두고(숨김) 넘길 때 보이기만 한다. 넘길 때마다 새로 만들면 본문 사본 2개를 그리고 배치하느라 첫 프레임이 늦다
  const back = flip === -1
  const leafSide = back ? 'left' : 'right'

  return (
    <main className="mag-book-stage">
      <button className="mag-turn mag-turn--prev" aria-label="이전 장" title="이전 장 (←)" disabled={spread === 0} onClick={() => turn(-1)}>‹</button>
      <div className="mag-book" ref={book} {...bookDrag}>
        {/* 아래에 깔린 두 쪽. 넘기는 동안 오른쪽(앞으로)·왼쪽(뒤로)은 넘긴 뒤 보일 쪽을 미리 깐다 */}
        {/* 왼쪽 쪽이 본문 원본(화면 읽기 프로그램이 읽음), 나머지는 같은 본문을 잘라 보여 주는 사본 */}
        <Half side="left" col={L} geo={geo} flowRef={flow} extra={<div ref={castL} className="mag-shade mag-shade--r" />}>
          {content}
        </Half>
        <Half side="right" col={R} geo={geo} hidden extra={<div ref={castR} className="mag-shade mag-shade--l" />}>
          {content}
        </Half>
        <div ref={leaf} className={`mag-leaf mag-leaf--${leafSide}${flip ? ' is-flipping' : ''}`} aria-hidden="true">
          <Strips back={back} front={back ? 2 * spread : 2 * spread + 1} rear={back ? 2 * spread - 1 : 2 * spread + 2} geo={geo}>
            {content}
          </Strips>
        </div>
        <div className="mag-gutter" aria-hidden="true" />
        {/* 쪽 바깥 여백: 잡고 끌거나 눌러서 넘긴다(넘길 쪽이 있을 때만). 화면 읽기 프로그램·키보드는 양옆 버튼을 쓴다 */}
        {spread > 0 && <div className="mag-grab mag-grab--prev" aria-hidden="true" {...grabProps(-1)} />}
        {spread < spreads - 1 && <div className="mag-grab mag-grab--next" aria-hidden="true" {...grabProps(1)} />}
      </div>
      <button className="mag-turn mag-turn--next" aria-label="다음 장" title="다음 장 (→)" disabled={spread >= spreads - 1} onClick={() => turn(1)}>›</button>
      <div className="mag-progress">
        {marks.length > 0 ? (
          <nav className="mag-marks" aria-label="장 바로 가기">
            <button aria-current={cur === 0 ? 'true' : undefined} onClick={() => goTo(0)}>처음</button>
            {marks.map((m) => (
              <button key={m.n} aria-current={cur === m.n ? 'true' : undefined} onClick={() => goTo(m.spread)}>
                <i>{String(m.n).padStart(2, '0')}</i>
                {m.title}
              </button>
            ))}
          </nav>
        ) : (
          <span className="mag-hint">쪽을 끌거나 ← → 키, 양옆 버튼으로 넘겨요</span>
        )}
        <span className="mag-count">
          {spread + 1} / {spreads}
        </span>
      </div>
    </main>
  )
}
