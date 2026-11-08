import { useEffect, useMemo, useState } from 'react'
import { API_BASE, fetchPlaces } from '../../lib/api'
import { CATEGORIES, EDITOR_KEY, catLabel, editorCall, go, storyPath, type Story, type StoryCategory } from '../../lib/stories'
import type { Place } from '../../lib/onsen'
import { ArticleBody } from './Magazine'
import './Magazine.css'
import './Editor.css'

// 매거진 작성 화면(운영자 전용). 서비스 화면 어디에도 링크하지 않고, 편집 토큰(.env의 TANGBANG_EDITOR_TOKEN)을 넣어야 열린다.
// 토큰은 이 브라우저 탭에만 기억한다(sessionStorage). 편집 토큰은 글만 쓸 수 있고 목욕탕 데이터 공개는 못 한다.
// 글 주소(/magazine/<글 번호>)는 처음 저장할 때 서버가 정한다. 작성 화면에서 따로 입력하지 않는다.
type Draft = { id?: number; title: string; category: StoryCategory | ''; summary: string; cover: string; body: string; author: string; place_ids: string[]; status: Story['status'] }
// 글쓴이 프리셋. 운영자 본인의 닉네임 '이노곤'을 새 글의 기본값으로 둔다
const AUTHORS = ['이노곤', '탕방 편집부']
const empty = (): Draft => ({ title: '', category: '', summary: '', cover: '', body: '', author: AUTHORS[0], place_ids: [], status: 'draft' })
const STATUS_LABEL: Record<Story['status'], string> = { draft: '임시 저장', published: '공개 중', hidden: '내림' }
const SYNTAX = '빈 줄 = 새 문단 · ## 소제목 · > 인용문 · ![사진 설명](https://사진주소) 한 줄 = 사진'

// 암호를 틀렸을 때 안내. 같은 곳에서 5번 틀리면 15분 잠긴다(Worker FAIL_RULES)
type AuthFail = { left?: number; retry?: number }
function authText(status: number, d: AuthFail) {
  if (status === 429) return `여러 번 틀려서 잠시 잠겼어요. ${Math.max(1, Math.ceil((d.retry ?? 60) / 60))}분 뒤에 다시 해 주세요.`
  return d.left ? `암호가 맞지 않아요. ${d.left}번 더 틀리면 15분 동안 잠겨요.` : '암호가 맞지 않아요.'
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string; problems?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
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
      <div className="ed-cols">
        <aside className="ed-list">
          <button className="mag-btn" onClick={() => (setD(empty()), setMsg(null))}>+ 새 글</button>
          {list.map((s) => (
            <button key={s.id} className={`ed-item${d.id === s.id ? ' on' : ''}`} onClick={() => (setD({ ...s, body: s.body ?? '', category: s.category }), setMsg(null))}>
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
          <label>대표 사진 주소<input value={d.cover} onChange={(e) => set('cover', e.target.value)} placeholder="https://… (비우면 빈 자리)" /></label>
          <label>본문<textarea value={d.body} rows={18} onChange={(e) => set('body', e.target.value)} placeholder={SYNTAX} /></label>
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
            <button className="mag-btn" disabled={busy} onClick={() => save(d.status === 'published' ? 'published' : 'draft')}>{d.status === 'published' ? '고친 내용 반영' : '임시 저장'}</button>
            {d.status !== 'published' && <button className="mag-btn mag-btn--primary" disabled={busy} onClick={() => save('published')}>공개하기</button>}
            {d.id && d.status === 'published' && <button className="mag-btn" disabled={busy} onClick={() => save('hidden')}>내리기</button>}
          </div>
        </form>

        <section className="ed-preview" aria-label="미리보기">
          <p className="ed-help">미리보기(모바일 모양)</p>
          <div className="mag ed-phone">
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
        </section>
      </div>
    </div>
  )
}
