import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { CATEGORIES, catLabel, fetchStories, fetchStory, go, isStoryKey, parseBody, storyDate, storyPath, type Story, type StoryCategory } from '../../lib/stories'
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
    <div className="mag">
      <TopBar />
      {slug ? <StoryView slug={slug} stories={stories ?? []} /> : <StoryList stories={stories} failed={failed} />}
    </div>
  )
}

function TopBar() {
  return (
    <header className="mag-top">
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

function Cover({ story, className = '' }: { story: Pick<Story, 'cover' | 'title'>; className?: string }) {
  // 대표 사진이 없으면 빈 줄무늬 자리를 둔다(임의 그림을 만들어 넣지 않는다)
  return story.cover ? <img className={`mag-cover ${className}`} src={story.cover} alt="" loading="lazy" /> : <div className={`mag-cover mag-cover--empty ${className}`} aria-hidden="true" />
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
          <a key={s.id} className="mag-card" style={{ '--i': i } as CSSProperties} href={storyPath(s)} onClick={(e) => (e.preventDefault(), go(storyPath(s)))}>
            <h2>{s.title}</h2>
            <DateLine story={s} />
            <Cover story={s} />
            {s.summary && <p className="mag-sum">{s.summary}</p>}
          </a>
        ))}
      </div>
    </main>
  )
}

// 본문 블록: 글자는 모두 textContent로 들어간다(HTML 해석 안 함)
export function ArticleBody({ body }: { body: string }) {
  const blocks = useMemo(() => parseBody(body), [body])
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'img' ? (
          <figure key={i} className="mag-fig">
            <img src={b.src} alt={b.alt} loading="lazy" />
            {b.alt && <figcaption>{b.alt}</figcaption>}
          </figure>
        ) : b.kind === 'h' ? (
          <h3 key={i}>{b.text}</h3>
        ) : b.kind === 'quote' ? (
          <blockquote key={i}>{b.text}</blockquote>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </>
  )
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
function Scroll({ story, next }: { story: Story; next: Story | null }) {
  const end = useRef<HTMLDivElement>(null)
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
  return (
    <article className="mag-scroll">
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
  )
}

// 웹: 책. 본문을 CSS 다단(column)으로 흘려 쪽을 나누고, 왼쪽·오른쪽 쪽은 같은 본문을 창으로 잘라 보여 준다.
// 넘길 때는 한 장(앞면=지금 쪽, 뒷면=다음 쪽)이 책등을 축으로 3D로 돌아간다(StPageFlip 연출 참고, 라이브러리 없이 CSS 3D).
// 첫 쪽은 대표 사진.
// 움직임 원칙: 버튼으로 넘길 때만 책장이 돈다. ← → 키는 자주 반복하는 동작이라 바로 바뀐다.
// 넘기는 중에 또 누르면 지금 장을 빠르게 마저 넘기고 다음 장으로 이어 간다(누른 것을 버리지 않음).
// 모션 줄이기면 회전 없이 짧게 흐려졌다 나타난다.
type Geo = { w: number; g: number; pad: number }
const FLIP_MS = 650
const FLIP_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)' // motion.css --ease-drawer: 처음이 빨라 누르자마자 장이 들린다
const FLIP_RUSH = 3 // 넘기는 중 다시 누르면 남은 회전을 3배 빠르게
const FADE_MS = 180

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

function Book({ story, next }: { story: Story; next: Story | null }) {
  const book = useRef<HTMLDivElement>(null)
  const flow = useRef<HTMLDivElement>(null)
  const leaf = useRef<HTMLDivElement>(null)
  const frontShade = useRef<HTMLDivElement>(null)
  const backShade = useRef<HTMLDivElement>(null)
  const castL = useRef<HTMLDivElement>(null) // 뒤로 넘길 때 드러나는 왼쪽 쪽의 그림자
  const castR = useRef<HTMLDivElement>(null) // 앞으로 넘길 때 드러나는 오른쪽 쪽의 그림자
  const [spread, setSpread] = useState(0)
  const [spreads, setSpreads] = useState(1)
  const [geo, setGeo] = useState<Geo>({ w: 0, g: 0, pad: 0 })
  const [flip, setFlip] = useState<0 | 1 | -1>(0)
  // 1단계: 책 크기에서 쪽 너비를 계산
  const measure = useCallback(() => {
    const el = book.current
    if (!el) return
    const pad = parseFloat(getComputedStyle(el).getPropertyValue('--book-pad')) || 48
    const g = pad * 2
    const w = (el.clientWidth - pad * 2 - g) / 2
    setGeo((o) => (o.w === w && o.pad === pad ? o : { w, g, pad }))
  }, [])
  // 2단계: 그 너비로 흘린 본문이 몇 쪽인지 센다
  const count = useCallback(() => {
    const el = flow.current
    if (!el || !geo.w) return
    const cols = Math.max(1, Math.round((el.scrollWidth + geo.g) / (geo.w + geo.g)))
    setSpreads(Math.ceil(cols / 2))
  }, [geo])
  useLayoutEffect(() => {
    setSpread(0)
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
  }, [count, story.slug])
  useEffect(() => setSpread((s) => Math.min(s, spreads - 1)), [spreads])

  const anims = useRef<Animation[]>([])
  const queued = useRef<{ d: 1 | -1; instant: boolean } | null>(null)
  const fadeNext = useRef(false)
  const turn = useCallback(
    (d: 1 | -1, instant = false) => {
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
    const opt = { duration: FLIP_MS, easing: FLIP_EASE, fill: 'forwards' as const }
    const [front, back, cast] = [frontShade.current, backShade.current, flip === 1 ? castR.current : castL.current]
    const list = [
      el.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${flip === 1 ? -180 : 180}deg)` }], opt),
      front?.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0.55 }], opt),
      back?.animate([{ opacity: 0.55 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0 }], opt),
      cast?.animate([{ opacity: 0.5 }, { opacity: 0 }], opt),
    ].filter(Boolean) as Animation[]
    anims.current = list
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
    }
  }, [flip])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowRight') turn(1, true)
      if (e.key === 'ArrowLeft') turn(-1, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn])
  const readSent = useRef(false)
  useEffect(() => {
    readSent.current = false
  }, [story.slug])
  useEffect(() => {
    if (spreads > 0 && spread === spreads - 1 && !readSent.current) {
      readSent.current = true
      track('story_read')
    }
  }, [spread, spreads])

  // 본문 사본 4개가 같은 요소 객체를 쓰면 쪽을 넘길 때 React가 본문 안을 다시 비교하지 않는다
  const content = useMemo(
    () => (
      <>
        <div className="mag-page-cover">
          <Cover story={story} />
        </div>
        <Head story={story} />
        <div className="mag-body">
          <ArticleBody body={story.body ?? ''} />
        </div>
        <EndBlock story={story} next={next} />
      </>
    ),
    [story, next],
  )
  // 깔린 쪽 번호: 앞으로 넘길 땐 오른쪽에 다음 장의 오른쪽 쪽, 뒤로 넘길 땐 왼쪽에 이전 장의 왼쪽 쪽
  const L = flip === -1 ? 2 * spread - 2 : 2 * spread
  const R = flip === 1 ? 2 * spread + 3 : 2 * spread + 1
  // 넘기는 장은 늘 깔아 두고(숨김) 넘길 때 보이기만 한다. 넘길 때마다 새로 만들면 본문 사본 2개를 그리고 배치하느라 첫 프레임이 늦다
  const back = flip === -1
  const leafSide = back ? 'left' : 'right'

  return (
    <main className="mag-book-stage">
      <button className="mag-turn mag-turn--prev" aria-label="이전 장" disabled={spread === 0} onClick={() => turn(-1)}>‹</button>
      <div className="mag-book" ref={book}>
        {/* 아래에 깔린 두 쪽. 넘기는 동안 오른쪽(앞으로)·왼쪽(뒤로)은 넘긴 뒤 보일 쪽을 미리 깐다 */}
        {/* 왼쪽 쪽이 본문 원본(화면 읽기 프로그램이 읽음), 나머지는 같은 본문을 잘라 보여 주는 사본 */}
        <Half side="left" col={L} geo={geo} flowRef={flow} extra={<div ref={castL} className="mag-shade mag-shade--r" />}>
          {content}
        </Half>
        <Half side="right" col={R} geo={geo} hidden extra={<div ref={castR} className="mag-shade mag-shade--l" />}>
          {content}
        </Half>
        <div ref={leaf} className={`mag-leaf mag-leaf--${leafSide}${flip ? ' is-flipping' : ''}`} aria-hidden="true">
          <Half side={leafSide} col={back ? 2 * spread : 2 * spread + 1} geo={geo} className="mag-face" extra={<div ref={frontShade} className={`mag-shade mag-shade--${back ? 'r' : 'l'}`} />}>
            {content}
          </Half>
          <Half side={back ? 'right' : 'left'} col={back ? 2 * spread - 1 : 2 * spread + 2} geo={geo} className="mag-face mag-face--back" extra={<div ref={backShade} className={`mag-shade mag-shade--${back ? 'l' : 'r'}`} />}>
            {content}
          </Half>
        </div>
        <div className="mag-gutter" aria-hidden="true" />
      </div>
      <button className="mag-turn mag-turn--next" aria-label="다음 장" disabled={spread >= spreads - 1} onClick={() => turn(1)}>›</button>
      <div className="mag-progress">
        <span>
          {spread + 1} / {spreads}
        </span>
        <span className="mag-hint">← → 키나 양옆 버튼으로 넘겨요</span>
      </div>
    </main>
  )
}
