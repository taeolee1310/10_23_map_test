import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { parseBody } from '../../lib/stories'

// 매거진 본문 WYSIWYG 편집기(작성 화면 전용). 네이버 블로그 글쓰기처럼 위 도구 막대 + 독자 화면과 같은 모양의 본문에 바로 쓴다.
// 저장 형식은 지금 글자 형식 그대로다(빈 줄 = 문단, '## ' = 장 제목·소제목, '> ' = 인용, '---' = 장 나누기, '![설명](https://…)' = 사진).
// 그래서 독자 화면·서버·이미 올린 글은 바뀌지 않는다. 화면(DOM)은 글자 형식에서 만들고, 쓸 때마다 화면을 읽어 글자 형식으로 되돌린다.
// 보안: 본문 내용은 모두 textContent·속성으로만 넣는다(innerHTML 안 씀). 붙여 넣기는 글자만 받는다. 굵게·기울임 같은 꾸밈은 저장 형식에 없어서 막는다.

export type RichBodyHandle = {
  /** 마지막 커서 자리 다음에 사진 블록을 넣는다(사진 올리기가 끝난 뒤 부른다) */
  insertPhoto: (url: string) => void
  /** 마지막 커서 자리 다음에 장 나누기를 넣고 그 아래 빈 문단으로 커서를 옮긴다 */
  insertChapter: () => void
}

type Props = {
  value: string
  onChange: (body: string) => void
  /** 도구 막대의 '사진' 버튼. 파일 고르기는 작성 화면이 맡는다 */
  onPickPhoto: () => void
  uploading: boolean
}

const BLOCK_TAGS = new Set(['P', 'H3', 'BLOCKQUOTE', 'FIGURE', 'DIV'])

// ── 글자 형식 → 화면 ──
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
// 문단 안 줄바꿈(\n)은 <br>로
function fillLines(e: HTMLElement, text: string) {
  e.textContent = ''
  text.split('\n').forEach((line, i) => {
    if (i) e.appendChild(document.createElement('br'))
    if (line) e.appendChild(document.createTextNode(line))
  })
  if (!text) e.appendChild(document.createElement('br')) // 빈 문단도 커서가 들어가게
  return e
}
function chapterEl() {
  const d = el('div', 'mag-ch rb-ch')
  d.contentEditable = 'false'
  d.appendChild(el('span'))
  return d
}
function figureEl(src: string, alt: string) {
  const f = el('figure', 'mag-fig rb-fig')
  f.contentEditable = 'false'
  const img = el('img')
  img.src = src
  img.alt = alt
  const cap = el('figcaption', 'rb-cap', alt)
  cap.contentEditable = 'true'
  cap.dataset.placeholder = '사진 설명 쓰기'
  const del = el('button', 'rb-del', '사진 빼기')
  del.type = 'button'
  f.append(img, cap, del)
  return f
}
function render(root: HTMLElement, body: string) {
  root.textContent = ''
  for (const b of parseBody(body)) {
    if (b.kind === 'ch') root.appendChild(chapterEl())
    else if (b.kind === 'img') root.appendChild(figureEl(b.src, b.alt))
    else if (b.kind === 'h') root.appendChild(el('h3', undefined, b.text))
    else if (b.kind === 'quote') root.appendChild(fillLines(el('blockquote'), b.text))
    else root.appendChild(fillLines(el('p'), b.text))
  }
  tidy(root)
}

// ── 화면 → 글자 형식 ──
function textOf(node: Node): string {
  let s = ''
  node.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE) s += c.textContent ?? ''
    else if (c.nodeName === 'BR') s += '\n'
    else if (c instanceof HTMLElement && BLOCK_TAGS.has(c.tagName)) s += (s && !s.endsWith('\n') ? '\n' : '') + textOf(c) + '\n'
    else s += textOf(c)
  })
  return s
}
const clean = (s: string) => s.replace(/ /g, ' ').replace(/\n+$/, '').replace(/^\n+/, '')
function serialize(root: HTMLElement): string {
  const out: string[] = []
  root.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = clean(n.textContent ?? '')
      if (t.trim()) out.push(t)
      return
    }
    if (!(n instanceof HTMLElement)) return
    if (n.classList.contains('rb-ch')) return void out.push('---')
    if (n.tagName === 'FIGURE') {
      const img = n.querySelector('img')
      const cap = clean(textOf(n.querySelector('figcaption') ?? n)).replace(/[\]\n]/g, ' ').trim()
      if (img) out.push(`![${cap}](${img.getAttribute('src') ?? ''})`)
      return
    }
    const t = clean(textOf(n))
    if (!t.trim()) return // 빈 문단은 저장하지 않는다(빈 줄은 문단 사이 구분일 뿐)
    if (n.tagName === 'H3') out.push(`## ${t.replace(/\n/g, ' ').trim()}`)
    else if (n.tagName === 'BLOCKQUOTE') out.push(t.split('\n').map((l) => `> ${l}`).join('\n'))
    else out.push(t) // 문단에 '---'·'## '를 직접 쳐도 저장한 뒤 다시 열면 그 블록이 된다(마크다운처럼)
  })
  return out.join('\n\n')
}

// 끝에 사진·장 나누기가 오면 그 뒤에 쓸 빈 문단을 두고, 장 번호를 다시 매긴다. 다 지워서 블록이 없으면 빈 문단 하나
function tidy(root: HTMLElement) {
  if (!root.querySelector(':scope > p, :scope > h3, :scope > blockquote, :scope > figure, :scope > div')) {
    root.textContent = ''
    const p = fillLines(el('p'), '')
    root.appendChild(p)
    if (document.activeElement === root) caretTo(p)
  }
  const last = root.lastElementChild
  if (!last || last.classList.contains('rb-ch') || last.tagName === 'FIGURE') root.appendChild(fillLines(el('p'), ''))
  let n = 0
  root.querySelectorAll<HTMLElement>(':scope > .rb-ch > span').forEach((s) => (s.textContent = `CHAPTER ${String(++n).padStart(2, '0')}`))
}

// 커서가 있는 본문 블록(root의 직계 자식)
function blockAt(root: HTMLElement, node: Node | null): HTMLElement | null {
  let n: Node | null = node
  while (n && n.parentNode !== root) n = n.parentNode
  return n instanceof HTMLElement ? n : null
}
function caretTo(e: HTMLElement, atEnd = false) {
  const r = document.createRange()
  r.selectNodeContents(e)
  r.collapse(!atEnd)
  const s = getSelection()
  s?.removeAllRanges()
  s?.addRange(r)
}

const RichBody = forwardRef<RichBodyHandle, Props>(function RichBody({ value, onChange, onPickPhoto, uploading }, ref) {
  const root = useRef<HTMLDivElement>(null)
  const last = useRef<string | null>(null) // 이 편집기가 마지막으로 내보낸 본문. 밖에서 다른 본문이 오면(다른 글 열기) 화면을 새로 그린다
  const caretBlock = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const r = root.current
    if (!r || value === last.current) return
    render(r, value)
    last.current = value
  }, [value])

  const emit = useCallback(() => {
    const r = root.current
    if (!r) return
    tidy(r)
    const text = serialize(r)
    last.current = text
    onChange(text)
  }, [onChange])

  // 커서 자리를 기억해 둔다(사진 고르기 창이 열리면 본문에서 커서가 빠지므로)
  useEffect(() => {
    const onSel = () => {
      const r = root.current
      const s = getSelection()
      if (!r || !s?.anchorNode || !r.contains(s.anchorNode)) return
      caretBlock.current = blockAt(r, s.anchorNode)
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const current = () => {
    const r = root.current!
    const b = caretBlock.current
    return b && b.parentNode === r ? b : (r.lastElementChild as HTMLElement | null)
  }
  // 지금 블록 다음에 새 블록을 넣는다. 지금 블록이 빈 문단이면 그 자리를 쓴다
  const placeAfter = (node: HTMLElement) => {
    const r = root.current!
    const b = current()
    if (b && b.tagName === 'P' && !clean(textOf(b)).trim()) r.replaceChild(node, b)
    else if (b) b.after(node)
    else r.appendChild(node)
    let next = node.nextElementSibling as HTMLElement | null
    if (!next || next.tagName !== 'P') {
      next = fillLines(el('p'), '')
      node.after(next)
    }
    return next
  }

  const insertPhoto = (url: string) => {
    const f = figureEl(url, '')
    placeAfter(f)
    emit()
    const cap = f.querySelector('figcaption') as HTMLElement
    cap.focus()
    caretTo(cap)
  }
  const insertChapter = () => {
    const next = placeAfter(chapterEl())
    emit()
    root.current?.focus()
    caretTo(next)
  }
  useImperativeHandle(ref, () => ({ insertPhoto, insertChapter }))

  // 도구 막대: 지금 블록을 문단·장 제목·인용으로 바꾼다
  const setKind = (tag: 'p' | 'h3' | 'blockquote') => {
    const b = current()
    if (!b || !['P', 'H3', 'BLOCKQUOTE', 'DIV'].includes(b.tagName)) return
    const want = b.tagName === tag.toUpperCase() ? 'p' : tag // 같은 버튼을 다시 누르면 문단으로
    const t = clean(textOf(b))
    const n = want === 'h3' ? el('h3', undefined, t.replace(/\n/g, ' ')) : fillLines(el(want), t)
    b.replaceWith(n)
    caretBlock.current = n
    emit()
    root.current?.focus()
    caretTo(n, true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = root.current!
    const s = getSelection()
    // 꾸밈(굵게·기울임·밑줄)은 저장 형식에 없다
    if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) return e.preventDefault()
    const inCap = (s?.anchorNode && (s.anchorNode instanceof HTMLElement ? s.anchorNode : s.anchorNode.parentElement)?.closest('figcaption')) as HTMLElement | null
    if (e.key === 'Enter' && inCap) {
      // 사진 설명은 한 줄. Enter면 사진 아래 문단으로 내려간다
      e.preventDefault()
      const fig = inCap.closest('figure') as HTMLElement
      let p = fig.nextElementSibling as HTMLElement | null
      if (!p || p.tagName !== 'P') {
        p = fillLines(el('p'), '')
        fig.after(p)
      }
      r.focus()
      caretTo(p)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const b = s?.anchorNode ? blockAt(r, s.anchorNode) : null
      // 장 제목·인용 끝에서 Enter면 다음 줄은 보통 문단으로
      if (b && (b.tagName === 'H3' || b.tagName === 'BLOCKQUOTE')) {
        const range = s!.getRangeAt(0)
        const tail = document.createRange()
        tail.setStart(range.endContainer, range.endOffset)
        tail.setEndAfter(b.lastChild ?? b)
        if (!tail.toString()) {
          e.preventDefault()
          const p = fillLines(el('p'), '')
          b.after(p)
          caretTo(p)
          emit()
        }
      }
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    // 붙여 넣기는 글자만. 문법(---·##·사진 줄)이 들어 있으면 화면을 다시 그려 블록으로 보여 준다
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    if (!text) return
    document.execCommand('insertText', false, text)
    if (/^(-{3,}[ \t]*|## .*|>.*|!\[[^\]]*\]\(https:\/\/[^)\s]+\))$/m.test(text) && root.current) {
      const merged = serialize(root.current)
      render(root.current, merged.replace(/\n(?=(-{3,}|## |>|!\[))/g, '\n\n'))
      emit()
      caretTo(root.current.lastElementChild as HTMLElement, true)
    }
  }

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (t.classList.contains('rb-del')) {
      e.preventDefault()
      t.closest('figure')?.remove()
      emit()
    }
  }

  // 도구 막대 버튼은 눌러도 본문 커서를 빼앗지 않는다(mousedown 기본 동작 막기)
  const keep = (e: MouseEvent) => e.preventDefault()
  return (
    <div className="rb">
      <div className="rb-bar" role="toolbar" aria-label="본문 꾸미기">
        <button type="button" onMouseDown={keep} onClick={onPickPhoto} disabled={uploading}>
          <span aria-hidden="true">▣</span>
          {uploading ? '올리는 중…' : '사진'}
        </button>
        <button type="button" onMouseDown={keep} onClick={insertChapter}>
          <span aria-hidden="true">―</span>장 나누기
        </button>
        <button type="button" onMouseDown={keep} onClick={() => setKind('h3')}>
          <span aria-hidden="true">T</span>장 제목
        </button>
        <button type="button" onMouseDown={keep} onClick={() => setKind('blockquote')}>
          <span aria-hidden="true">“</span>인용
        </button>
        <button type="button" onMouseDown={keep} onClick={() => setKind('p')}>
          <span aria-hidden="true">¶</span>본문
        </button>
      </div>
      <div
        ref={root}
        className="rb-doc mag-body"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="본문"
        spellCheck={false}
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onClick={onClick}
        onBlur={emit}
      />
    </div>
  )
})

export default RichBody
