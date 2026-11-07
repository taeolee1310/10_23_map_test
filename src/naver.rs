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
    (
        "탕",
        &[
            "냉탕",
            "온탕",
            "열탕",
            "바데풀",
            "이벤트탕",
            "건식",
            "습식",
            "불한증막",
            "찜질",
        ],
    ),
    ("주차", &["주차"]),
    ("혼잡", &["붐비", "한적", "사람이 없", "혼잡", "대기"]),
    ("청결", &["깨끗", "깔끔", "청결", "위생", "지저분", "더러"]),
];
pub const CLOSED: &[&str] = &[
    "폐업",
    "휴업",
    "영업 종료",
    "영업종료",
    "문 닫",
    "문닫",
    "이전했",
    "이전 했",
];
pub const BLOCK: &[&str] = &[
    "보안 확인",
    "자동입력 방지",
    "captcha",
    "비정상적인 접근",
    "접근이 제한",
];
pub const COLS: &[&str] = &[
    "카카오ID",
    "네이버ID",
    "이름",
    "수집일",
    "상태",
    "네이버분류",
    "영업표시",
    "휴무",
    "가격표",
    "편의",
    "수건근거",
    "세신근거",
    "드라이기근거",
    "샴푸근거",
    "탕근거",
    "주차근거",
    "혼잡근거",
    "청결근거",
    "폐업언급",
    "사진URL",
    "블로그날짜",
];

crate::re!(DATE, r"20\d\d년 \d{1,2}월 \d{1,2}일");
crate::re!(
    POST_SPLIT,
    r"(20\d\d년 \d{1,2}월 \d{1,2}일 [월화수목금토일]요일)"
);
crate::re!(CATEGORY, r"마이플레이스\n.+?\n(.+?)\n");
crate::re!(HOURS, r"(?s)영업시간\n(.+?)\n(?:펼쳐보기|전화번호)");
crate::re!(
    CLOSED_DAY,
    r"(매[^\n]*휴무|연중무휴|[월화수목금토일]요일 휴무|정기 ?휴무[^\n]*)"
);
crate::re!(
    PRICE,
    r"(?s)가격표\n(.+?)\n(?:가격표 이미지로 보기|블로그|인스타그램|편의)"
);
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
            start = if j < chars.len() {
                chars[j].0
            } else {
                text.len()
            };
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
    re.captures(s)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_default()
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
    row.insert(
        "영업표시".into(),
        cap1(&HOURS, head)
            .split('\n')
            .collect::<Vec<_>>()
            .join(" / "),
    );
    row.insert("휴무".into(), cap1(&CLOSED_DAY, head));
    row.insert(
        "가격표".into(),
        cap1(&PRICE, head)
            .split('\n')
            .collect::<Vec<_>>()
            .join(" | "),
    );
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
        let d = DATE
            .find(posts[i + 1])
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();
        dated.push((d, posts[i]));
        i += 2;
    }
    let dates: BTreeSet<&str> = dated
        .iter()
        .map(|(d, _)| d.as_str())
        .filter(|d| !d.is_empty())
        .collect();
    row.insert(
        "블로그날짜".into(),
        dates
            .iter()
            .rev()
            .take(5)
            .copied()
            .collect::<Vec<_>>()
            .join(","),
    );
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
        let v = format!(
            "[업체 헤더] {} ‖ {}",
            take_chars(head, 80).replace('\n', " "),
            row["폐업언급"]
        );
        row.insert(
            "폐업언급".into(),
            v.trim_matches(|c| c == ' ' || c == '‖').to_string(),
        );
    }
    row
}

pub fn blocked(text: &str) -> bool {
    BLOCK.iter().any(|b| text.contains(b))
}

crate::re!(HTML_CODE, r"(?is)<script\b.*?</script>|<style\b.*?</style>|<[^>]+>");

/// 저장한 검색 결과 HTML의 캡차 판단: 스크립트·태그를 빼고 화면 글자만 본다
/// (네이버 검색 HTML 스크립트에는 'captcha' 단어가 늘 들어 있어 그대로 보면 정상 페이지도 캡차로 읽힘, 2026-11-04)
pub fn blocked_html(html: &str) -> bool {
    blocked(&HTML_CODE.replace_all(html, " ").to_lowercase())
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
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim_start_matches('\u{feff}').replace("\r\n", "\n"))
}

/// 홈 페이지로 읽을 수 있는지 (파이썬 때와 같은 조건)
pub fn valid_home(text: &str) -> bool {
    text.contains("마이플레이스") && text.contains("주소")
}

// ───────── 수집 대상(홈·후기 공통) ─────────

fn read_rows(path: &str) -> anyhow::Result<Vec<Row>> {
    Ok(crate::csvio::read_csv(path, true, crate::csvio::Dtype::AllStr)?.records())
}

/// 판정 결과로 본 곳마다의 '부족한 항목 수'(0~4). 쪽수가 많이 드는 블로그 단계에서 먼저 받을 곳을 고르는 데 쓴다.
/// 부족한 항목 = 입장료를 정하지 못함(사람이 확인한 onsen_prices.csv와 자동 price_auto.csv 모두에 없음) + 세신·드라이기·수건 중 '불명'인 것.
/// (2026-11-06 판정 376곳 가운데 세신 불명 364곳·수건 불명 358곳이라 '부족한 곳만' 고르면 거의 줄지 않는다. 네 항목을 다 아는 곳만 빼고, 나머지는 부족한 항목이 많은 곳부터 줄 세운다)
pub struct Lacking {
    priced: std::collections::HashSet<String>,
    unknown: std::collections::HashMap<String, usize>,
}

/// 판정 결과(facts_judged.csv)가 아직 없으면 None: 판정 전이라 순서를 바꿀 근거가 없다.
pub fn lacking() -> Option<Lacking> {
    use crate::csvio::g;
    if !util::exists("data/collected/facts_judged.csv") {
        return None;
    }
    let unknown = read_rows("data/collected/facts_judged.csv")
        .ok()?
        .iter()
        .map(|r| {
            (
                g(r, "카카오ID").to_string(),
                ["세신", "드라이기", "수건"]
                    .iter()
                    .filter(|c| g(r, c).starts_with("불명"))
                    .count(),
            )
        })
        .collect();
    let mut priced = std::collections::HashSet::new();
    for p in [
        "data/curated/onsen_prices.csv",
        "data/collected/price_auto.csv",
    ] {
        if util::exists(p) {
            for r in read_rows(p).ok()? {
                if !g(&r, "성인_평일").is_empty() {
                    priced.insert(g(&r, "카카오ID").to_string());
                }
            }
        }
    }
    Some(Lacking { priced, unknown })
}

impl Lacking {
    /// 부족한 항목 수. 판정 결과에 없는 곳(홈 페이지 정보가 없는 곳)은 세 항목 모두 모르는 것으로 센다.
    pub fn score(&self, kakao_id: &str) -> usize {
        usize::from(!self.priced.contains(kakao_id))
            + self.unknown.get(kakao_id).copied().unwrap_or(3)
    }

    /// 받을 목록(첫 칸이 카카오ID)을 부족한 항목이 많은 곳부터 줄 세운다. 같은 점수끼리는 원래 순서 그대로(안정 정렬).
    pub fn most_lacking_first(&self, todo: &mut Vec<Vec<String>>) {
        todo.sort_by_key(|l| std::cmp::Reverse(self.score(l.first().map_or("", String::as_str))));
    }

    /// 입장료·세신·드라이기·수건을 모두 아는 곳(부족한 항목 0)은 블로그를 더 받을 까닭이 없어 받을 목록에서 뺀다. 뺀 줄 수를 돌려준다.
    pub fn drop_complete(&self, todo: &mut Vec<Vec<String>>) -> usize {
        let before = todo.len();
        todo.retain(|l| self.score(l.first().map_or("", String::as_str)) > 0);
        before - todo.len()
    }
}

/// 합친 목록 중 네이버ID가 있는 곳(naver_places.csv + curated/naver_match_manual.csv), '확실' 제외 후보는 뺀다.
/// gu: 주소 조건(정규식), limit: 앞에서부터 몇 곳만
pub fn targets(gu: Option<&str>, limit: Option<usize>) -> anyhow::Result<Vec<Row>> {
    use crate::csvio::g;
    use std::collections::{HashMap, HashSet};
    let m = read_rows("data/merged/onsen_merged.csv")?;
    let n = read_rows("data/collected/naver_places.csv")?;
    let mm = read_rows("data/curated/naver_match_manual.csv")?;
    // find_naver_ids가 이름 검색으로 맞춘 곳('일치')도 수집 대상이다(예전에는 빠져 후기·사진을 못 받았다)
    let found: Vec<Row> = if crate::util::exists("data/collected/naver_id_found.csv") {
        read_rows("data/collected/naver_id_found.csv")?.into_iter().filter(|r| g(r, "결과") == "일치").collect()
    } else {
        vec![]
    };
    let pairs: Vec<(String, String)> = n
        .iter()
        .chain(mm.iter())
        .chain(found.iter())
        .map(|r| (g(r, "카카오ID").to_string(), g(r, "네이버ID").to_string()))
        .filter(|(k, v)| !k.is_empty() && !v.is_empty())
        .collect();
    let map: HashMap<String, String> = crate::pysort::keep_first(pairs, |p| p.0.clone())
        .into_iter()
        .collect();
    let mut t: Vec<Row> = m
        .iter()
        .filter_map(|r| {
            map.get(g(r, "카카오ID")).map(|nid| {
                let mut r = r.clone();
                r.insert("네이버ID".into(), nid.clone());
                r
            })
        })
        .collect();
    let ex_path = "data/collected/excluded_candidates.csv";
    if crate::util::exists(ex_path) {
        let sure: HashSet<String> = read_rows(ex_path)?
            .iter()
            .filter(|r| g(r, "확신") == "확실")
            .map(|r| g(r, "카카오ID").to_string())
            .collect();
        println!("제외 후보(확실) {}곳은 수집에서 뺌", sure.len());
        t.retain(|r| !sure.contains(g(r, "카카오ID")));
    }
    // 수집 범위는 서울만(사용자 지침). 합친 목록이 서울만이어도 한 번 더 막는다
    let before = t.len();
    t.retain(|r| g(r, "주소").starts_with("서울특별시") || g(r, "주소").starts_with("서울 "));
    if before > t.len() {
        println!("서울 밖 주소 {}곳은 수집에서 뺌", before - t.len());
    }
    // 동네 목욕탕 범위 밖(워터파크·호텔·리조트)은 페이지를 받지도 않는다
    let before = t.len();
    t.retain(|r| out_of_scope(g(r, "이름"), "", "").is_none());
    if before > t.len() {
        println!("동네 목욕탕 범위 밖(워터파크·호텔·리조트) {}곳은 수집에서 뺌", before - t.len());
    }
    println!(
        "목록 {}곳 중 네이버ID 있음 {}곳 (없는 {}곳은 건너뜀)",
        m.len(),
        t.len(),
        m.len() as i64 - t.len() as i64
    );
    if let Some(gu) = gu {
        let re = regex::Regex::new(gu)?;
        t.retain(|r| re.is_match(g(r, "주소")));
        println!("조건: 주소에 '{gu}' 포함 → {}곳", t.len());
    }
    if let Some(l) = limit.filter(|l| *l > 0) {
        t.truncate(l);
    }
    Ok(t)
}


// ───────── 서비스 범위: 동네 목욕탕 (사용자 결정 2026-11-04) ─────────
// 탕방은 동네 목욕탕·찜질방 지도다. 거대 기업이 운영하는 느낌의 곳(워터파크 겸용, 호텔·리조트 부대 사우나)은 수집·판정에서 뺀다.
// '랜드·월드·그랜드·스파랜드'는 동네 건강랜드·찜질방 이름에 흔해서 넣지 않는다(넣으면 신원건강랜드·그랜드대중목욕탕까지 빠진다).
crate::re!(WATERPARK, r"워터파크|테마파크");
crate::re!(HOTEL_NAME, r"(?i)호텔|리조트|hotel|resort|하얏트|힐튼|메리어트|인터컨티넨탈|시그니엘|웨스틴|쉐라톤|노보텔|워커힐|콘래드|포시즌스|페어몬트|반얀트리|이비스");
crate::re!(HOTEL_CAT, r"호텔|리조트");
// 고급 호텔·리조트는 이름만으로 뺀다. 일반 호텔 사우나는 요금을 보고 판단한다(judge_facts: 4만 원 미만이면 남김, 사용자 결정 2026-11-04)
crate::re!(LUXURY, r"(?i)조선팰리스|조선호텔|롯데호텔|시그니엘|하얏트|힐튼|메리어트|인터컨티넨탈|웨스틴|쉐라톤|워커힐|콘래드|포시즌스|페어몬트|반얀트리|파라다이스|신라호텔|리조트|resort");
// 세신만 하는 가게(1인 세신샵·스크럽·머드 등). '세신'만으로는 거르지 않는다(벽계수 스파 세신 같은 대형 찜질방이 있다)
// 성인업소는 무조건 뺀다(사용자 지침 2026-11-04). 이름이나 네이버 업종에 이런 말이 있으면 수집·판정 모두에서 제외
crate::re!(ADULT_NAME, r"(?i)휴게텔|안마|건마|스웨디시|키스방|대딸|유흥|룸살롱|단란|노래빠|성인|립카페");
crate::re!(ADULT_CAT, r"휴게텔|안마|마사지|유흥|단란주점|룸살롱|바\(BAR\)|성인");
crate::re!(SCRUB_NAME, r"세신샵|1인\s*세신|스크럽|머드");

/// 동네 목욕탕 범위 밖이면 (사유, 근거). name: 가게 이름, category: 네이버 분류(모르면 ""), price: 네이버 가격표 글자(모르면 "")
pub fn out_of_scope(name: &str, category: &str, price: &str) -> Option<(String, String)> {
    // 가장 먼저 본다: 성인업소는 다른 어떤 조건보다 우선해 뺀다
    if ADULT_CAT.is_match(category) {
        return Some(("성인업소".into(), format!("네이버 분류: {category}")));
    }
    if ADULT_NAME.is_match(name) {
        return Some(("성인업소".into(), format!("이름: {name}")));
    }
    if WATERPARK.is_match(category) {
        return Some(("워터파크 겸용".into(), format!("네이버 분류: {category}")));
    }
    if WATERPARK.is_match(name) {
        return Some(("워터파크 겸용".into(), format!("이름: {name}")));
    }
    if WATERPARK.is_match(price) {
        return Some(("워터파크 겸용".into(), "가격표에 워터파크 이용권".into()));
    }
    if SCRUB_NAME.is_match(name) {
        return Some(("세신샵".into(), format!("이름: {name}")));
    }
    if LUXURY.is_match(name) {
        return Some(("호텔·리조트(고급)".into(), format!("이름: {name}")));
    }
    None
}

/// 호텔에 붙은 사우나인지(이름이나 네이버 분류). 고급이 아니면 요금으로 판단한다
pub fn is_hotel(name: &str, category: &str) -> bool {
    HOTEL_NAME.is_match(name) || HOTEL_CAT.is_match(category)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 부족한 항목이 많은 곳이 앞에 오고, 점수가 같은 곳끼리는 원래 순서가 그대로다
    #[test]
    fn most_lacking_places_come_first_keeping_order() {
        let set = |ids: &[&str]| {
            ids.iter()
                .map(|s| s.to_string())
                .collect::<std::collections::HashSet<_>>()
        };
        // 1·2·3은 입장료를 정했다(점수 = 불명 개수: 0·1·3). 4·5는 판정 결과에 없어 입장료 미정 1 + 불명 3 = 4
        let unknown = [("1", 0), ("2", 1), ("3", 3)]
            .iter()
            .map(|(k, n)| (k.to_string(), *n))
            .collect();
        let l = Lacking {
            priced: set(&["1", "2", "3"]),
            unknown,
        };
        assert_eq!(
            (l.score("1"), l.score("2"), l.score("3"), l.score("4")),
            (0, 1, 3, 4)
        );
        let mut todo: Vec<Vec<String>> = ["1", "2", "3", "4", "5"]
            .iter()
            .map(|k| vec![k.to_string(), "x".into()])
            .collect();
        l.most_lacking_first(&mut todo);
        let order: Vec<&str> = todo.iter().map(|r| r[0].as_str()).collect();
        assert_eq!(order, ["4", "5", "3", "2", "1"]);
        // 점수 0인 곳(1)만 빠진다
        assert_eq!(l.drop_complete(&mut todo), 1);
        let order: Vec<&str> = todo.iter().map(|r| r[0].as_str()).collect();
        assert_eq!(order, ["4", "5", "3", "2"]);
    }
}
