import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, catLabel, fetchStories, fetchStory, go, parseBody, storyDate, type Story, type StoryCategory } from '../../lib/stories'
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
        {list.map((s) => (
          <a key={s.id} className="mag-card" href={`/magazine/${s.slug}`} onClick={(e) => (e.preventDefault(), go(`/magazine/${s.slug}`))}>
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
        if (s) document.title = `${s.title} · 탕방 매거진`
      },
      () => setStory(null),
    )
  }, [slug])
  const next = useMemo(() => {
    const i = stories.findIndex((s) => s.slug === slug)
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
  const nextStory = next && next.slug !== story.slug ? next : null
  return wide ? <Book story={story} next={nextStory} /> : <Scroll story={story} next={nextStory} />
}

function EndBlock({ story, next }: { story: Story; next: Story | null }) {
  const share = async () => {
    const url = `${location.origin}/magazine/${story.slug}`
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
          <a className="mag-btn mag-btn--primary" href={`/magazine/${next.slug}`} onClick={(e) => (e.preventDefault(), go(`/magazine/${next.slug}`))}>
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

// 웹: 책. 본문을 CSS 다단(column)으로 흘려 쪽을 나누고, 두 쪽씩 옆으로 넘긴다. 첫 쪽은 대표 사진.
function Book({ story, next }: { story: Story; next: Story | null }) {
  const flow = useRef<HTMLDivElement>(null)
  const [spread, setSpread] = useState(0)
  const [spreads, setSpreads] = useState(1)
  const [geo, setGeo] = useState({ w: 0, g: 0 })
  const measure = useCallback(() => {
    const el = flow.current
    if (!el) return
    const cs = getComputedStyle(el)
    const g = parseFloat(cs.columnGap) || 0
    const w = (el.clientWidth - g) / 2
    const cols = Math.max(1, Math.round((el.scrollWidth + g) / (w + g)))
    setGeo({ w, g })
    setSpreads(Math.ceil(cols / 2))
  }, [])
  useLayoutEffect(() => {
    setSpread(0)
    measure()
    const ro = new ResizeObserver(measure)
    if (flow.current) ro.observe(flow.current)
    document.fonts?.ready.then(measure)
    const imgs = flow.current?.querySelectorAll('img') ?? []
    imgs.forEach((im) => im.addEventListener('load', measure, { once: true }))
    return () => ro.disconnect()
  }, [story.slug, measure])
  const turn = useCallback((d: number) => setSpread((s) => Math.min(spreads - 1, Math.max(0, s + d))), [spreads])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') turn(1)
      if (e.key === 'ArrowLeft') turn(-1)
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

  return (
    <main className="mag-book-stage">
      <button className="mag-turn mag-turn--prev" aria-label="이전 장" disabled={spread === 0} onClick={() => turn(-1)}>‹</button>
      <div className="mag-book">
        <div
          ref={flow}
          className="mag-flow"
          style={{ transform: `translateX(${-spread * 2 * (geo.w + geo.g)}px)`, transition: reduceMotion() ? 'none' : undefined }}
        >
          <div className="mag-page-cover">
            <Cover story={story} />
          </div>
          <Head story={story} />
          <div className="mag-body">
            <ArticleBody body={story.body ?? ''} />
          </div>
          <EndBlock story={story} next={next} />
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
