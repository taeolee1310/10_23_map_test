// ego 브라우저에서 네이버 플레이스 페이지를 연 뒤 이 식을 실행해 나온 글자를 그대로 저장한다.
// (요소마다 첫 글자 조각만 줄바꿈으로 잇는다. script·style과 공백뿐인 조각은 뺀다.
//  예전 Scrapling get_all_text(separator="\n")와 같은 모양이라 src/naver.rs의 parse가 그대로 읽는다)
// 저장: 홈 → data/collected/naver_pages/home/<네이버ID>.txt
//       검색 → data/collected/naver_pages/search/<카카오ID>.html (검색 결과는 이 식 대신 document.documentElement.outerHTML)
(() => {
  const out = [];
  const skip = new Set(['script', 'style']);
  const walk = (el) => {
    if (skip.has(el.localName)) return;
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 1) break;
      if (n.nodeType === 3) t += n.data;
    }
    if (t.trim()) out.push(t);
    for (const c of el.children) walk(c);
  };
  walk(document.documentElement);
  return out.join('\n');
})()
