//! 네이버 플레이스 페이지 글자에서 근거 문장을 뽑는다(parse).
//! 페이지는 러스트가 열지 않는다. ego 브라우저가 열어 scripts/naver_page_text.js로 뽑은 글자를
//! data/collected/naver_pages/에 저장하면, 여기서 읽는다. (헤드리스 브라우저 수집은 쓰지 않는다)

use std::collections::BTreeSet;

use crate::csvio::Row;
use crate::util::{self, char_len, is_py_space, take_chars};

pub const OUT: &str = "data/collected/naver_home_facts.csv";
pub const KEYS: &[(&str, &[&str])] = &[
    ("수건", &["수건", "타월", "타올"]),
    ("세신", &["세신", "때밀이", "때 밀"]),
    ("드라이기", &["드라이", "헤어드라이", "바디드라이"]),
    ("샴푸", &["샴푸", "바디워시", "어메니티"]),
    ("탕", &["냉탕", "온탕", "열탕", "바데풀", "이벤트탕", "건식", "습식", "불한증막", "찜질"]),
    ("주차", &["주차"]),
    ("혼잡", &["붐비", "한적", "사람이 없", "혼잡", "대기"]),
    ("청결", &["깨끗", "깔끔", "청결", "위생", "지저분", "더러"]),
];
pub const CLOSED: &[&str] = &["폐업", "휴업", "영업 종료", "영업종료", "문 닫", "문닫", "이전했", "이전 했"];
pub const BLOCK: &[&str] = &["보안 확인", "자동입력 방지", "captcha", "비정상적인 접근", "접근이 제한"];
pub const COLS: &[&str] = &[
    "카카오ID", "네이버ID", "이름", "수집일", "상태", "네이버분류", "영업표시", "휴무", "가격표", "편의",
    "수건근거", "세신근거", "드라이기근거", "샴푸근거", "탕근거", "주차근거", "혼잡근거", "청결근거",
    "폐업언급", "사진URL", "블로그날짜",
];

crate::re!(DATE, r"20\d\d년 \d{1,2}월 \d{1,2}일");
crate::re!(POST_SPLIT, r"(20\d\d년 \d{1,2}월 \d{1,2}일 [월화수목금토일]요일)");
crate::re!(CATEGORY, r"마이플레이스\n.+?\n(.+?)\n");
crate::re!(HOURS, r"(?s)영업시간\n(.+?)\n(?:펼쳐보기|전화번호)");
crate::re!(CLOSED_DAY, r"(매[^\n]*휴무|연중무휴|[월화수목금토일]요일 휴무|정기 ?휴무[^\n]*)");
crate::re!(PRICE, r"(?s)가격표\n(.+?)\n(?:가격표 이미지로 보기|블로그|인스타그램|편의)");
crate::re!(CONV, r"편의\n(.+?)\n");
crate::re!(END_TIME, r"\d{1,2}(?::\d{2}|시 ?\d{0,2}분?)에 영업 종료");

/// 파이썬 re.split(r"(?<=[.!?。])\s+|\n+", text) 후 strip·빈 줄 제거.
pub fn sentences(text: &str) -> Vec<String> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut pieces: Vec<&str> = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    while i < chars.len() {
        let (pos, c) = chars[i];
        let prev_ok = i > 0 && matches!(chars[i - 1].1, '.' | '!' | '?' | '。');
        let mut j = i;
        if prev_ok && is_py_space(c) {
            while j < chars.len() && is_py_space(chars[j].1) {
                j += 1;
            }
        } else if c == '\n' {
            while j < chars.len() && chars[j].1 == '\n' {
                j += 1;
            }
        }
        if j > i {
            pieces.push(&text[start..pos]);
            start = if j < chars.len() { chars[j].0 } else { text.len() };
            i = j;
        } else {
            i += 1;
        }
    }
    pieces.push(&text[start..]);
    pieces
        .into_iter()
        .map(|s| util::py_strip(s).to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn evidence(chunk: &str, source: &str, words: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    for s in sentences(chunk) {
        if words.iter().any(|w| s.contains(w)) && char_len(&s) < 260 {
            out.push(format!("[{source}] {s}"));
        }
    }
    out.truncate(4);
    out
}

/// 파이썬 str.partition: (앞, 구분자 뒤). 구분자가 없으면 (전체, "").
fn partition<'a>(s: &'a str, sep: &str) -> (&'a str, &'a str) {
    match s.find(sep) {
        Some(i) => (&s[..i], &s[i + sep.len()..]),
        None => (s, ""),
    }
}

fn cap1(re: &regex::Regex, s: &str) -> String {
    re.captures(s).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default()
}

/// 홈 페이지 글자에서 칸별 근거를 뽑는다.
pub fn parse(text: &str) -> Row {
    let tail = text.split("로딩중").next().unwrap_or("");
    let (head, review, blog);
    let (h, rest) = partition(tail, "방문자 리뷰");
    if !rest.is_empty() {
        head = h;
        let (rv, b) = partition(rest, "블로그 리뷰");
        review = rv;
        blog = b;
    } else {
        let (h2, b) = partition(tail, "블로그 리뷰");
        head = h2;
        blog = b;
        review = "";
    }
    let mut row = Row::new();
    row.insert("네이버분류".into(), cap1(&CATEGORY, head));
    row.insert("영업표시".into(), cap1(&HOURS, head).split('\n').collect::<Vec<_>>().join(" / "));
    row.insert("휴무".into(), cap1(&CLOSED_DAY, head));
    row.insert("가격표".into(), cap1(&PRICE, head).split('\n').collect::<Vec<_>>().join(" | "));
    row.insert("편의".into(), cap1(&CONV, head));

    // 블로그 글은 날짜가 보이는 항목만 날짜와 함께 근거로 쓴다
    let mut posts: Vec<&str> = Vec::new();
    let mut last = 0;
    for m in POST_SPLIT.find_iter(blog) {
        posts.push(&blog[last..m.start()]);
        posts.push(m.as_str());
        last = m.end();
    }
    posts.push(&blog[last..]);
    let mut dated: Vec<(String, &str)> = Vec::new();
    let mut i = 0;
    while i + 1 < posts.len() {
        let d = DATE.find(posts[i + 1]).map(|m| m.as_str().to_string()).unwrap_or_default();
        dated.push((d, posts[i]));
        i += 2;
    }
    let dates: BTreeSet<&str> = dated.iter().map(|(d, _)| d.as_str()).filter(|d| !d.is_empty()).collect();
    row.insert("블로그날짜".into(), dates.iter().rev().take(5).copied().collect::<Vec<_>>().join(","));
    let mut by_date = dated.clone();
    by_date.sort_by(|a, b| b.0.cmp(&a.0)); // 안정 정렬, 최신 먼저
    for (k, words) in KEYS {
        let mut ev = Vec::new();
        for (d, body) in &by_date {
            ev.extend(evidence(body, &format!("블로그 {d}"), words));
        }
        ev.extend(evidence(review, "방문자리뷰(날짜없음)", words));
        ev.extend(evidence(head, "업체등록", words));
        ev.truncate(6);
        row.insert(format!("{k}근거"), ev.join(" ‖ "));
    }
    let mut closed = evidence(&format!("{review}\n{blog}"), "리뷰·블로그", CLOSED);
    closed.truncate(3);
    row.insert("폐업언급".into(), closed.join(" ‖ "));
    let top = END_TIME.replace_all(take_chars(head, 200), "").into_owned();
    if top.contains("영업 종료") || top.contains("폐업") || top.contains("휴업") {
        let v = format!("[업체 헤더] {} ‖ {}", take_chars(head, 80).replace('\n', " "), row["폐업언급"]);
        row.insert("폐업언급".into(), v.trim_matches(|c| c == ' ' || c == '‖').to_string());
    }
    row
}

pub fn blocked(text: &str) -> bool {
    BLOCK.iter().any(|b| text.contains(b))
}


/// ego 브라우저가 저장한 페이지 글자 폴더 (후기 문장이 들어 있어 깃에 올리지 않는다)
pub const PAGES: &str = "data/collected/naver_pages";

/// 홈 페이지 주소와 저장 파일 (네이버ID 하나당 하나)
pub fn home_url(naver_id: &str) -> String {
    format!("https://m.place.naver.com/place/{naver_id}/home")
}
pub fn home_file(naver_id: &str) -> String {
    format!("{PAGES}/home/{naver_id}.txt")
}

/// 저장된 페이지 글자. 없으면 None (아직 ego로 안 연 곳).
pub fn read_page(path: &str) -> Option<String> {
    std::fs::read_to_string(path).ok().map(|s| s.trim_start_matches('\u{feff}').replace("\r\n", "\n"))
}

/// 홈 페이지로 읽을 수 있는지 (파이썬 때와 같은 조건)
pub fn valid_home(text: &str) -> bool {
    text.contains("마이플레이스") && text.contains("주소")
}