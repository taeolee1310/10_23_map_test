import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { API_BASE, fetchPlaces } from '../../lib/api'
import { CATEGORIES, EDITOR_KEY, catLabel, editorCall, go, storyPath, type Story, type StoryCategory } from '../../lib/stories'
import type { Place } from '../../lib/onsen'
import { PHOTO_ACCEPT, PhotoAuthError, PhotoError, shrinkPhoto, uploadPhoto } from '../../lib/photos'
import { ArticleBody, Book } from './Magazine'
import './Magazine.css'
import './Editor.css'

// 매거진 작성 화면(운영자 전용). 서비스 화면 어디에도 링크하지 않고, 편집 토큰(.env의 TANGBANG_EDITOR_TOKEN)을 넣어야 열린다.
// 토큰은 이 브라우저 탭에만 기억한다(sessionStorage). 편집 토큰은 글만 쓸 수 있고 목욕탕 데이터 공개는 못 한다.
// 글 주소(/magazine/<글 번호>)는 처음 저장할 때 서버가 정한다. 작성 화면에서 따로 입력하지 않는다.
// 사진은 '사진 고르기'(대표 사진)·'본문에 사진 넣기'(본문)로 올린다. 브라우저에서 1600px JPEG로 줄여(위치 정보 제거, lib/photos.ts) Worker→R2에 올리고, 받은 주소를 칸에 넣는다. 주소를 붙여 넣는 예전 방식도 그대로 된다.
type Draft = { id?: number; title: string; category: StoryCategory | ''; summary: string; cover: string; body: string; author: string; place_ids: string[]; status: Story['status'] }
// 글쓴이 프리셋. 운영자 본인의 닉네임 '이노곤'을 새 글의 기본값으로 둔다
const AUTHORS = ['이노곤', '탕방 편집부']
const empty = (): Draft => ({ title: '', category: '', summary: '', cover: '', body: '', author: AUTHORS[0], place_ids: [], status: 'draft' })
const STATUS_LABEL: Record<Story['status'], string> = { draft: '임시 저장', published: '공개 중', hidden: '내림' }
const IMG_LINE = /^!\[[^\]]*\]\(.*\)$/ // 사진 한 줄 ![설명](주소)
const SYNTAX ='빈 줄 = 새 문단 · ## 소제목 · > 인용문 · ![사진 설명](https://사진주소) 한 줄 = 사진'

// 암호를 틀렸을 때 안내. 같은 곳에서 5번 틀리면 15분 잠긴다(Worker FAIL_RULES)
type AuthFail = { left?: number; retry?: number }
function authText(status: number, d: AuthFail) {
  if (status === 429) return `여러 번 틀려서 잠시 잠겼어요. ${Math.max(1, Math.ceil((d.retry ?? 60) / 60))}분 뒤에 다시 해 주세요.`
  return d.left ? `암호가 맞지 않아요. ${d.left}번 더 틀리면 15분 동안 잠겨요.` : '암호가 맞지 않아요.'
}

type PreviewView = 'mobile' | 'web'
const VIEW_KEY = 'tangbang:editor-view'
// 웹 미리보기: 실제 매거진의 책(Book)을 1120×640 무대에 그리고 미리보기 칸 너비에 맞춰 줄인다.
// 책 안의 링크·버튼은 누르지 못하게 막는다(작성 중인 글을 두고 다른 화면으로 가지 않게). 양옆 넘김 버튼은 쓸 수 있다
const STAGE_W = 1120
const STAGE_H = 640
function WebPreview({ story }: { story: Story }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(el.clientWidth / STAGE_W)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="ed-web" style={{ height: STAGE_H * scale }}>
      <div className="mag ed-web-stage" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
        <Book story={story} next={null} preview />
      </div>
    </div>
  )
}

export default function Editor() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(EDITOR_KEY) || ''
    } catch {
      return ''
    }
  })
  const [list, setList] = useState<Story[] | null>(null)
  const [d, setD] = useState<Draft>(empty)
  // 미리보기 모양(모바일·웹). 이 브라우저에만 기억한다
  const [view, setView] = useState<PreviewView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'web' ? 'web' : 'mobile'
    } catch {
      return 'mobile'
    }
  })
  const pickView = (v: PreviewView) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* 기억 못 해도 지금 화면은 바뀜 */
    }
  }
  const previewStory = useMemo<Story>(
    () => ({ id: d.id ?? 0, slug: 'preview', title: d.title || '제목', category: (d.category || 'unknown') as StoryCategory, summary: d.summary, cover: d.cover, author: d.author, place_ids: d.place_ids, status: d.status, published_at: null, updated_at: '', body: d.body }),
    [d],
  )
  const [msg, setMsg] = useState<{ ok: boolean; text: string; problems?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  // 사진 올리기: 올리는 동안 사진 버튼은 잠그고, 실패 안내는 누른 버튼 바로 아래에 보여 준다
  const [uploading, setUploading] = useState<'cover' | 'body' | null>(null)
  const [photoErr, setPhotoErr] = useState<{ where: 'cover' | 'body'; text: string } | null>(null)
  const coverFile = useRef<HTMLInputElement>(null)
  const bodyFile = useRef<HTMLInputElement>(null)
  const bodyBox = useRef<HTMLTextAreaElement>(null)
  const bodyCursor = useRef<number | null>(null) // 본문 칸을 떠날 때(사진 버튼을 누를 때 등) 기억한 커서 위치. 한 번도 안 눌렀으면 null(맨 끝에 넣는다)
  const caretAfter = useRef<number | null>(null) // 사진을 넣은 뒤 커서를 둘 자리(설명 칸 [ ] 안)
  const bodyNow = useRef('') // 올리는 사이에 글이 바뀌어도 지금 본문에 넣으려고 최신 본문을 따로 쥐고 있는다
  const [places, setPlaces] = useState<Place[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    document.title = '매거진 작성 · 탕방'
    const m = document.createElement('meta')
    m.name = 'robots'
    m.content = 'noindex, nofollow'
    document.head.appendChild(m)
    return () => m.remove()
  }, [])
  useEffect(() => {
    fetchPlaces<{ places: Place[] }>().then((r) => setPlaces(r.places), () => {})
  }, [])

  const load = async (t = token) => {
    const r = await editorCall<{ ok: boolean; stories: Story[] } & AuthFail>('GET', t)
    if (r.status === 401 || r.status === 429) {
      setMsg({ ok: false, text: authText(r.status, r.data) })
      setList(null)
      return false
    }
    if (r.status === 503) {
      setMsg({ ok: false, text: '작성 기능이 아직 준비되지 않았어요(Worker에 암호가 없음). node worker/setup-editor.mjs를 실행해 주세요.' })
      return false
    }
    if (!r.data.ok) {
      setMsg({ ok: false, text: '글 목록을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.' })
      return false
    }
    setList(r.data.stories)
    return true
  }
  useEffect(() => {
    if (token) load(token)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (t: string) => {
    if (await load(t)) {
      setToken(t)
      setMsg(null)
      try {
        sessionStorage.setItem(EDITOR_KEY, t)
      } catch {
        /* 탭을 닫으면 다시 넣는다 */
      }
    }
  }
  const logout = () => {
    setToken('')
    setList(null)
    try {
      sessionStorage.removeItem(EDITOR_KEY)
    } catch {
      /* 무시 */
    }
  }

  const save = async (status: Story['status']) => {
    if (status === 'published' && !confirm(d.status === 'published' ? '고친 내용을 바로 사용자에게 보여 줄까요?' : '이 글을 공개할까요? 사용자 매거진에 바로 나와요.')) return
    if (status === 'hidden' && !confirm('이 글을 내릴까요? 사용자 매거진에서 사라져요(지우지는 않아요).')) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await editorCall<{ ok: boolean; id?: number; problems?: string[]; error?: string } & AuthFail>('POST', token, { ...d, status })
      if (r.data.ok) {
        setD((x) => ({ ...x, id: r.data.id, status }))
        setMsg({ ok: true, text: status === 'published' ? '공개했어요. 1분 안에 매거진에 보여요.' : status === 'hidden' ? '내렸어요.' : '임시 저장했어요(사용자에게는 안 보여요).' })
        await load()
      } else if (r.status === 401 || r.status === 429) setMsg({ ok: false, text: authText(r.status, r.data) })
      else setMsg({ ok: false, text: '저장하지 못했어요.', problems: r.data.problems })
    } catch {
      setMsg({ ok: false, text: '인터넷 연결을 확인하고 다시 눌러 주세요. 쓴 글은 화면에 그대로 있어요.' })
    }
    setBusy(false)
  }

  const matches = useMemo(() => {
    const s = q.trim()
    if (!s) return []
    return places.filter((p) => p.name.includes(s) && !d.place_ids.includes(p.id)).slice(0, 6)
  }, [q, places, d.place_ids])
  const nameOf = (id: string) => places.find((p) => p.id === id)?.name ?? id
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  bodyNow.current = d.body

  // 본문의 커서 자리(없으면 맨 끝)에 사진 한 줄을 넣는다. 사진은 앞뒤에 빈 줄이 있어야 사진으로 읽힌다(parseBody가 빈 줄로 문단을 나눔).
  // 설명은 비워 두고 커서를 [ ] 안에 둔다.
  const insertPhoto = (url: string) => {
    const body = bodyNow.current
    const ta = bodyBox.current
    const cursor = ta && document.activeElement === ta ? ta.selectionStart : bodyCursor.current // 올리는 사이에 본문을 다시 누르고 있으면 지금 커서
    let at = Math.min(cursor ?? body.length, body.length)
    // 커서가 사진 줄(![설명](주소)) 안에 있으면 그 줄을 쪼개지 않고 줄 끝으로 옮긴다(방금 넣은 사진의 설명 칸에 커서가 있는 채로 다시 누르는 경우)
    const nl = body.indexOf('\n', at)
    const lineEnd = nl < 0 ? body.length : nl
    if (IMG_LINE.test(body.slice(body.lastIndexOf('\n', at - 1) + 1, lineEnd).trim())) at = lineEnd
    const before = body.slice(0, at)
    const after = body.slice(at)
    const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const line = `![](${url})`
    const tail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
    caretAfter.current = at + lead.length + 2
    bodyCursor.current = at + lead.length + line.length + tail.length
    set('body', before + lead + line + tail + after)
  }
  useEffect(() => {
    const c = caretAfter.current
    const ta = bodyBox.current
    if (c == null || !ta) return
    caretAfter.current = null
    ta.focus()
    ta.setSelectionRange(c, c)
  }, [d.body])

  const pickPhoto = async (where: 'cover' | 'body', file: File | undefined) => {
    if (!file || uploading) return
    setUploading(where)
    setPhotoErr(null)
    try {
      const url = await uploadPhoto(token, await shrinkPhoto(file))
      if (where === 'cover') set('cover', url)
      else insertPhoto(url)
    } catch (e) {
      const text = e instanceof PhotoAuthError ? authText(e.status, e.data) : e instanceof PhotoError ? e.message : '사진을 올리지 못했어요. 잠시 뒤 다시 해 주세요.'
      setPhotoErr({ where, text })
    }
    setUploading(null)
  }
  const fileInput = (where: 'cover' | 'body', ref: RefObject<HTMLInputElement>) => (
    <input
      ref={ref}
      type="file"
      accept={PHOTO_ACCEPT}
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = '' // 같은 사진을 다시 골라도 반응하도록
        void pickPhoto(where, f)
      }}
    />
  )

  if (!API_BASE) return <p className="ed-wrap">데이터 API 주소가 없어 작성할 수 없어요.</p>
  if (!token || !list)
    return (
      <div className="ed-wrap ed-login">
        <h1>매거진 작성</h1>
        <p>운영자만 쓰는 화면이에요. 암호를 넣어 주세요.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const t = String(new FormData(e.currentTarget).get('t') || '').trim()
            if (t) login(t)
          }}
        >
          <input name="t" type="password" autoComplete="off" placeholder="암호" aria-label="암호" />
          <button className="mag-btn mag-btn--primary" type="submit">들어가기</button>
        </form>
        {msg && <p className={msg.ok ? 'ed-ok' : 'ed-err'}>{msg.text}</p>}
        <a href="/magazine" onClick={(e) => (e.preventDefault(), go('/magazine'))}>매거진 보기</a>
      </div>
    )

  return (
    <div className="ed-wrap">
      <header className="ed-head">
        <h1>매거진 작성</h1>
        <div>
          <a className="mag-btn" href="/magazine" target="_blank" rel="noopener">매거진 새 창으로</a>
          <button className="mag-btn" onClick={logout}>나가기</button>
        </div>
      </header>
      <div className={`ed-cols${view === 'web' ? ' ed-cols--web' : ''}`}>
        <aside className="ed-list">
          <button className="mag-btn" disabled={!!uploading} onClick={() => (setD(empty()), setMsg(null), setPhotoErr(null), (bodyCursor.current = null))}>+ 새 글</button>
          {list.map((s) => (
            <button key={s.id} className={`ed-item${d.id === s.id ? ' on' : ''}`} disabled={!!uploading} onClick={() => (setD({ ...s, body: s.body ?? '', category: s.category }), setMsg(null), setPhotoErr(null), (bodyCursor.current = null))}>
              <span className={`ed-st ed-st--${s.status}`}>{STATUS_LABEL[s.status]}</span>
              <strong>{s.title}</strong>
              <small>{catLabel(s.category)}</small>
            </button>
          ))}
        </aside>

        <form className="ed-form" onSubmit={(e) => e.preventDefault()}>
          <label>제목<input value={d.title} maxLength={80} onChange={(e) => set('title', e.target.value)} placeholder="수건 한 장이 건네는 것들" /></label>
          <div className="ed-row">
            <label>카테고리
              <select value={d.category} onChange={(e) => set('category', e.target.value as StoryCategory)}>
                <option value="">고르기</option>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label>글쓴이
              <input value={d.author} maxLength={40} onChange={(e) => set('author', e.target.value)} />
              <span className="ed-chips">
                {AUTHORS.map((a) => (
                  <button type="button" key={a} className={`ed-chip${d.author === a ? ' on' : ''}`} aria-pressed={d.author === a} onClick={() => set('author', a)}>{a}</button>
                ))}
              </span>
            </label>
          </div>
          <p className="ed-help">{d.id ? `주소: tangbang.vercel.app${storyPath({ id: d.id })}` : '주소는 처음 저장할 때 글 번호로 자동으로 정해져요.'}</p>
          <label>한 줄 요약<input value={d.summary} maxLength={200} onChange={(e) => set('summary', e.target.value)} placeholder="목록과 글 머리에 나와요" /></label>
          <div className="ed-photo">
            <label>대표 사진 주소<input value={d.cover} onChange={(e) => set('cover', e.target.value)} placeholder="https://… (비우면 빈 자리)" /></label>
            <button type="button" className="mag-btn" disabled={!!uploading} onClick={() => coverFile.current?.click()}>{uploading === 'cover' ? '올리는 중…' : '사진 고르기'}</button>
            {fileInput('cover', coverFile)}
          </div>
          {photoErr?.where === 'cover' && <p className="ed-err" role="alert">{photoErr.text}</p>}
          <label>본문
            <textarea
              ref={bodyBox}
              value={d.body}
              rows={18}
              onChange={(e) => set('body', e.target.value)}
              onBlur={(e) => (bodyCursor.current = e.currentTarget.selectionStart)}
              placeholder={SYNTAX}
            />
          </label>
          <div className="ed-photo-body">
            <button type="button" className="mag-btn" disabled={!!uploading} onClick={() => bodyFile.current?.click()}>{uploading === 'body' ? '올리는 중…' : '본문에 사진 넣기'}</button>
            {fileInput('body', bodyFile)}
          </div>
          {photoErr?.where === 'body' && <p className="ed-err" role="alert">{photoErr.text}</p>}
          <p className="ed-help">{SYNTAX}</p>
          <div className="ed-places">
            <span>이 글에 나온 목욕탕 (상세 화면에 '이 목욕탕 이야기'로 나와요)</span>
            <div className="ed-chips">
              {d.place_ids.map((id) => (
                <button type="button" key={id} className="ed-chip" onClick={() => set('place_ids', d.place_ids.filter((x) => x !== id))}>{nameOf(id)} ✕</button>
              ))}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="목욕탕 이름으로 찾기" />
            {matches.map((p) => (
              <button type="button" key={p.id} className="ed-match" onClick={() => (set('place_ids', [...d.place_ids, p.id]), setQ(''))}>{p.name} · {p.gu}</button>
            ))}
          </div>
          {msg && (
            <div className={msg.ok ? 'ed-ok' : 'ed-err'}>
              {msg.text}
              {msg.problems && <ul>{msg.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            </div>
          )}
          <div className="ed-actions">
            <button className="mag-btn" disabled={busy || !!uploading} onClick={() => save(d.status === 'published' ? 'published' : 'draft')}>{d.status === 'published' ? '고친 내용 반영' : '임시 저장'}</button>
            {d.status !== 'published' && <button className="mag-btn mag-btn--primary" disabled={busy || !!uploading} onClick={() => save('published')}>공개하기</button>}
            {d.id && d.status === 'published' && <button className="mag-btn" disabled={busy || !!uploading} onClick={() => save('hidden')}>내리기</button>}
          </div>
        </form>

        <section className="ed-preview" aria-label="미리보기">
          <div className="ed-view" role="group" aria-label="미리보기 모양" data-view={view}>
            <button type="button" aria-pressed={view === 'mobile'} onClick={() => pickView('mobile')}>모바일</button>
            <button type="button" aria-pressed={view === 'web'} onClick={() => pickView('web')}>웹</button>
          </div>
          {view === 'web' ? (
            <div className="ed-swap" key="web">
              <WebPreview story={previewStory} />
            </div>
          ) : (
          <div className="mag ed-phone ed-swap" key="mobile">
            {d.cover ? <img className="mag-cover mag-cover--hero" src={d.cover} alt="" /> : <div className="mag-cover mag-cover--hero mag-cover--empty" />}
            <div className="mag-scroll-in">
              <header className="mag-art-head">
                <div className="mag-date"><span><b>--.--</b></span>{d.category && <span className="mag-pill">{catLabel(d.category)}</span>}</div>
                <h1>{d.title || '제목'}</h1>
                <p className="mag-by">글 {d.author}</p>
                {d.summary && <p className="mag-lead">{d.summary}</p>}
              </header>
              <div className="mag-body"><ArticleBody body={d.body} /></div>
            </div>
          </div>
          )}
        </section>
      </div>
    </div>
  )
}
