//! 수집한 근거 문장(naver_home_facts.csv)으로 세신·수건·드라이기 등을 판정하고, 제외할 곳을 고른다.
//!
//! 원칙: 근거가 부족하거나 후기끼리 엇갈리면 '불명'으로 두고 추측하지 않는다. 날짜가 1년 넘게 지난 후기·블로그는 근거로 쓰지 않고(양질의 정보 지침 2026-11-04),
//! 날짜 없는 후기는 낮은 근거로 2건 이상 일치할 때만 쓴다. 요금은 가격표·후기·블로그 가운데 가장 최근 것을 기준으로 한다(price_decide).
//! 출력(모두 다시 만들 수 있는 파일):
//!   data/collected/place_facts_auto.json   서비스용 자동 판정 (사람이 확인한 data/curated/place_facts.json이 항목별로 우선)
//!   data/collected/facts_judged.csv        곳마다 판정 결과·신뢰도 (불명 포함, 눈으로 검산용)
//!   data/collected/price_auto.csv          가격표에서 뽑은 입장료
//! 추가만 하는 파일 (기존 줄은 고치지 않는다):
//!   data/curated/excluded.csv              서비스에서 뺄 곳 (이름·주소·사유·근거)
//! 실행: cargo run --release --bin judge_facts

use anyhow::Result;
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use tangbang_data::csvio::{self, g, Dtype, Row, Table};
use tangbang_data::pyjson::{self, obj};
use tangbang_data::{pysort, re, util};

const FACTS_CSV: &str = "data/collected/naver_home_facts.csv";
const MERGED: &str = "data/merged/onsen_merged.csv";
/// 이 금액 이상 입장료는 동네 목욕탕 범위 밖(호텔·리조트급)으로 본다
const HIGH_PRICE: i64 = 40_000;
re!(BATH_NAME, r"사우나|목욕|탕|찜질|불가마|한증");
const CANDIDATES: &str = "data/collected/excluded_candidates.csv"; // 이름으로 거른 피트니스 후보(확실/애매)
const EXCLUDED: &str = "data/curated/excluded.csv";
const FOUND: &str = "data/collected/naver_id_found.csv"; // find_naver_ids가 이름 검색으로 찾은 ID
const OUT_FACTS: &str = "data/collected/place_facts_auto.json";
const OUT_JUDGED: &str = "data/collected/facts_judged.csv";
const OUT_PRICES: &str = "data/collected/price_auto.csv";
const EX_COLS: [&str; 6] = ["카카오ID", "이름", "주소", "사유", "근거", "확인일"];
const REVIEWS: &str = "data/collected/naver_reviews.jsonl"; // collect_reviews가 후기 탭에서 모은 키워드 문장(방문일 포함)
const BLOGS: &str = "data/collected/naver_blogs.jsonl"; // collect_reviews --kind blog가 블로그 탭에서 모은 키워드 문장(작성일 포함)
const HOURS: &str = "data/collected/naver_hours.jsonl"; // scripts/collect_hours.mjs가 '펼쳐보기'로 모은 요일별 영업시간
const DAYS: [&str; 7] = ["월", "화", "수", "목", "금", "토", "일"];
const REVIEW_COLS: [(&str, &[&str]); 3] = [
    ("수건근거", &["수건", "타월", "타올"]),
    ("드라이기근거", &["드라이"]),
    ("샴푸근거", &["샴푸", "바디워시", "어메니티"]),
];
const PRICE_COLS_OUT: [&str; 10] = [
    "카카오ID",
    "성인_평일",
    "성인_주말",
    "수건",
    "주차",
    "어린이",
    "추가요금_없음확인",
    "메모",
    "출처",
    "확인일",
];

re!(
    FIT_STRONG,
    r"휘트니스|피트니스|스포츠클럽|스포츠센터|짐$|짐 |GYM|gym|요가|필라테스|크로스핏|체육관"
);
re!(FIT_PRICE, r"트레이너|레슨|\bPT\b"); // '회원권'·'헬스'는 동네 목욕탕 가격표에도 흔해서 쓰지 않는다
re!(MASSAGE, r"마사지|테라피|아로마|스웨디시|왁싱|경락");
re!(
    BATH_ITEM,
    r"대인|성인|입욕|목욕|일반|주간|야간|사우나|찜질|한증"
);
re!(SESHIN, r"세신|때밀이|때\s*밀");
re!(
    SESHIN_SKIP,
    r"코스|\d+분|오일|마사지|테라피|임산부|소인|어린이|초등|아이"
);
re!(SES_EXTRA, r"때\(|미니때|VIP\s*때|기본때|^등$|^머리$");
re!(WOMEN, r"여탕|여자|여성|여\)|\(여|여사우나");
re!(MEN, r"남탕|남자|남성|남\)|\(남");
re!(NUM_TOK, r"^[\d,]+$");
re!(LABEL, r"^\[(.+?)\] (.*)");
re!(YM, r"(20\d\d)년 (\d{1,2})월");
re!(DRY_NONE, r"드라이\S*\s?(는|도|가|이)?\s?(없(어|음|네|다|습|더|었|는)|안\s?보)");
re!(DRY_HAS, r"드라이\S*.{0,10}(있|비치|구비)");
re!(CLAUSE, r"[,.!?~·]|\s(?:인데|지만|반면)\s?");
re!(
    DRY_PRICE,
    r"드라이\S*.{0,12}?(\d[\d,]*)\s?원|(\d[\d,]*)\s?원.{0,12}드라이"
);
re!(
    NO_CHARGE,
    r"(동전|돈|요금|비용).{0,5}(없이|안\s?(받|내|들|넣)|필요\s?없)|그냥\s?(사용|쓸)"
);
re!(
    FREE,
    r"드라이\S*.{0,12}(무료|공짜)|(무료|공짜).{0,12}드라이"
);
re!(
    PAID,
    r"드라이\S*.{0,12}(유료|\d+원|동전|코인|돈\s?받)|(유료|\d+원|동전|코인).{0,12}드라이"
);
re!(TOWEL_SKIP, r"충분|필요|여쭤|몇 ?장|원하|추가|더 ");
re!(
    TOWEL_CNT,
    r"수건\D{0,8}?(\d+|한|두|세|네)\s?(장|개)|(\d+|한|두|세|네)\s?(장|개)\D{0,4}수건"
);
re!(TOWEL_UNL, r"수건.{0,10}(무제한|마음껏|자유롭게|셀프)");
re!(CLOTHES, r"찜질복|가운|까운|수면복|찜질옷");
re!(CLOTHES_SKIP, r"보증|세탁|분실|반납");
re!(NIGHT, r"야간|심야");
re!(DAY, r"주간");
re!(ADULT, r"대인|성인|일반|입욕|입장|사우나|목욕");
// 나이 범위가 든 항목은 성인 요금으로 보지 않는다
re!(
    NOT_ADULT,
    r"소인|어린이|유아|초등|학생|경로|청소년|미취학|찜질복|가운|까운|세신|회원|\d+매|\d+장|수면|룸|\d+세|개월|미만|이하|~|아동|소아|취학"
);
re!(OVERTIME, r"초과|연장");
re!(WEEKEND, r"주말|공휴일");
re!(CHILD, r"소인|어린이|초등|유아|미취학|아동|소아|취학");
re!(CHILD_SKIP, r"세신|회원|찜질복|가운|까운|성인|대인");
re!(SUP_SKIP, r"없|지참|챙겨|개인|유료|별도");
re!(SUP_OK, r"제공|구비|비치|준비|무료");
re!(BRAND, r"\s*\S*점$");
re!(CLOSE_WORD, r"폐업|휴업");

fn read(path: &str) -> Result<Vec<Row>> {
    Ok(csvio::read_csv(path, true, Dtype::AllStr)?.records())
}

/// '세신(남) | 20,000 | 원 | ...' 한 줄을 (이름, 금액) 목록으로 푼다. '변동' 같은 글자 값은 버린다.
fn price_items(text: &str) -> Vec<(String, i64)> {
    let tok: Vec<&str> = text.split('|').map(util::py_strip).collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 2 < tok.len() {
        if tok[i + 2] == "원" && NUM_TOK.is_match(tok[i + 1]) {
            if let Ok(n) = tok[i + 1].replace(',', "").parse::<i64>() {
                out.push((tok[i].to_string(), n));
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    out
}

/// '[출처] 문장 ‖ [출처] 문장' → (신뢰도, 출처, 문장). 신뢰도: high=업체등록, mid=최근 1년 블로그, low=오래된 블로그·방문자 후기(날짜 없음).
/// '최근 1년'은 실행한 날(KST) 기준으로 센다: 오늘이 2026-11-04면 2025년 11월 이후. (예전에는 2025년 11월로 고정돼 있었다)
/// 블로그 근거를 '중간' 신뢰도로 볼 시작 달: 오늘(KST)에서 1년 전 같은 달
static RECENT_FROM: std::sync::LazyLock<(i32, i32)> = std::sync::LazyLock::new(|| {
    let today = util::today_kst();
    let y: i32 = today[0..4].parse().unwrap();
    let m: i32 = today[5..7].parse().unwrap();
    (y - 1, m)
});

fn sentences_of(cell: &str) -> Vec<(&'static str, String, String)> {
    let mut out = Vec::new();
    for part in cell.split(" ‖ ").filter(|p| !p.is_empty()) {
        let Some(c) = LABEL.captures(part) else {
            continue;
        };
        let (label, s) = (c[1].to_string(), c[2].to_string());
        let rel = if label.starts_with("업체등록") {
            "high"
        } else {
            match YM.captures(&label) {
                Some(d)
                    if (d[1].parse::<i32>().unwrap(), d[2].parse::<i32>().unwrap())
                        >= *RECENT_FROM =>
                {
                    "mid"
                }
                // 날짜가 있는데 1년 넘게 지난 근거는 버린다(양질의 정보 지침)
                Some(_) => continue,
                None => "low",
            }
        };
        out.push((rel, label, s));
    }
    out
}

#[derive(Clone)]
struct Review {
    date: String,
    lines: Vec<String>,
}

fn jsonl(path: &str) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    if util::exists(path) {
        for line in std::fs::read_to_string(path)?.lines() {
            if line.trim().is_empty() {
                continue;
            }
            out.push(pyjson::loads(line)?);
        }
    }
    Ok(out)
}

fn load_reviews() -> Result<HashMap<String, Vec<Review>>> {
    if !util::exists(REVIEWS) {
        // 후기 근거가 없으면 TOP 3 판정이 크게 줄어든다(2026-11-04 실제로 114곳 → 99곳). 조용히 넘어가지 않고 알린다
        println!("⚠ 후기 근거 파일({REVIEWS})이 없어요. 후기 없이 판정하면 TOP 3 정보가 줄어요. collect_reviews로 후기를 먼저 받으세요.");
    }
    let mut out = HashMap::new();
    for r in jsonl(REVIEWS)? {
        let revs = r["reviews"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|rv| Review {
                date: pyjson::py_str(&rv["date"]),
                lines: rv["lines"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(pyjson::py_str)
                    .collect(),
            })
            .collect();
        out.insert(pyjson::py_str(&r["kakaoId"]), revs);
    }
    Ok(out)
}

/// 후기 탭 근거를 방문일과 함께 근거 칸에 합친다. 홈 페이지의 날짜 없는 후기 문장은 같은 후기일 수 있어 중복으로 세지 않게 뺀다.
fn add_review_evidence(row: &Row, reviews: &[Review]) -> Row {
    let mut row = row.clone();
    let mut sorted = reviews.to_vec();
    sorted.sort_by(|a, b| b.date.cmp(&a.date));
    for (col, words) in REVIEW_COLS {
        let mut parts: Vec<String> = g(&row, col)
            .split(" ‖ ")
            .filter(|p| !p.is_empty() && !p.starts_with("[방문자리뷰(날짜없음)]"))
            .map(String::from)
            .collect();
        for rv in &sorted {
            let d: Vec<&str> = rv.date.split('-').collect();
            let num = |s: &str| {
                s.parse::<i64>()
                    .map(|n| n.to_string())
                    .unwrap_or_else(|_| s.to_string())
            };
            let label = format!("방문자리뷰 {}년 {}월 {}일", d[0], num(d[1]), num(d[2]));
            parts.extend(
                rv.lines
                    .iter()
                    .filter(|ln| words.iter().any(|w| ln.contains(w)))
                    .map(|ln| format!("[{label}] {ln}")),
            );
        }
        row.insert(col.into(), parts.join(" ‖ "));
    }
    row
}

/// 블로그 리뷰 탭(collect_reviews --kind blog)의 키워드 문장. 파일이 없으면 빈 목록(홈 페이지의 블로그 근거만 쓴다)
fn load_blogs() -> Result<HashMap<String, Vec<Review>>> {
    let mut out = HashMap::new();
    if !util::exists(BLOGS) {
        return Ok(out);
    }
    for r in jsonl(BLOGS)? {
        let posts = r["reviews"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|rv| Review {
                date: pyjson::py_str(&rv["date"]),
                lines: rv["lines"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(pyjson::py_str)
                    .collect(),
            })
            .collect();
        out.insert(pyjson::py_str(&r["kakaoId"]), posts);
    }
    Ok(out)
}

/// 블로그 탭 근거를 작성일과 함께 근거 칸에 더한다. 홈 페이지에 이미 같은 문장이 있으면(같은 글) 다시 넣지 않는다.
/// 이름표는 홈과 같은 '[블로그 YYYY년 M월 D일]'이라 신뢰도(최근 1년 = 중간)도 같은 규칙을 탄다
fn add_blog_evidence(row: &Row, posts: &[Review]) -> Row {
    let mut row = row.clone();
    let mut sorted = posts.to_vec();
    sorted.sort_by(|a, b| b.date.cmp(&a.date));
    for (col, words) in REVIEW_COLS {
        let mut parts: Vec<String> = g(&row, col)
            .split(" ‖ ")
            .filter(|p| !p.is_empty())
            .map(String::from)
            .collect();
        let mut seen: HashSet<String> = parts
            .iter()
            .map(|p| p.split_once("] ").map(|x| x.1).unwrap_or(p).to_string())
            .collect();
        for rv in &sorted {
            let d: Vec<&str> = rv.date.split('-').collect();
            let num = |s: &str| {
                s.parse::<i64>()
                    .map(|n| n.to_string())
                    .unwrap_or_else(|_| s.to_string())
            };
            let label = format!("블로그 {}년 {}월 {}일", d[0], num(d[1]), num(d[2]));
            for ln in rv
                .lines
                .iter()
                .filter(|ln| words.iter().any(|w| ln.contains(w)))
            {
                if seen.insert(ln.clone()) {
                    parts.push(format!("[{label}] {ln}"));
                }
            }
        }
        row.insert(col.into(), parts.join(" ‖ "));
    }
    row
}

/// {카카오ID: {'월': '06:00 - 23:00', ...}}. 요일 표가 없는 곳(24시간 영업 등)은 넣지 않는다.
fn load_hours() -> Result<HashMap<String, Value>> {
    let mut out = HashMap::new();
    for r in jsonl(HOURS)? {
        let week = r
            .get("hours")
            .and_then(|h| h.get("week"))
            .cloned()
            .unwrap_or(Value::Null);
        let mut m = Map::new();
        for d in DAYS {
            if pyjson::truthy(week.get(d)) {
                let parts: Vec<String> = week[d]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(pyjson::py_str)
                    .collect();
                m.insert(d.into(), Value::from(parts.join(" · ")));
            }
        }
        if !m.is_empty() {
            out.insert(pyjson::py_str(&r["kakaoId"]), Value::Object(m));
        }
    }
    Ok(out)
}

/// 올해 후기에 폐업·휴업이 언급된 날짜(검토용. 자동으로 제외하지 않는다).
/// 깃에 올라가는 파일이라 후기 문장은 적지 않고 날짜만 남긴다.
/// '올해' 시작일: 실행한 날(KST)의 1월 1일 (예전에는 2026-01-01로 고정)
static YEAR_START: std::sync::LazyLock<String> =
    std::sync::LazyLock::new(|| format!("{}-01-01", &util::today_kst()[0..4]));

fn closed_hints(reviews: &[Review]) -> String {
    let dates: BTreeSet<&str> = reviews
        .iter()
        .filter(|rv| {
            rv.date.as_str() >= YEAR_START.as_str()
                && rv.lines.iter().any(|ln| CLOSE_WORD.is_match(ln))
        })
        .map(|rv| rv.date.as_str())
        .collect();
    if dates.is_empty() {
        String::new()
    } else {
        format!(
            "폐업·휴업 언급 후기 {}",
            dates.iter().rev().copied().collect::<Vec<_>>().join(", ")
        )
    }
}

type Vote = (Value, &'static str, String);

/// 높음·중간 근거가 있으면 그것만, 없으면 낮은 근거가 2건 이상 일치할 때만(allow_single이면 1건도 '낮음'으로 씀). 서로 다르면 모순.
fn decide(votes: &[Vote], allow_single: bool) -> (Option<Value>, String) {
    let good: Vec<&Vote> = votes
        .iter()
        .filter(|v| v.1 == "high" || v.1 == "mid")
        .collect();
    let use_: Vec<&Vote> = if good.is_empty() {
        votes.iter().collect()
    } else {
        good.clone()
    };
    if use_.is_empty() {
        return (None, String::new());
    }
    let vals: HashSet<String> = use_.iter().map(|v| pyjson::canon(&v.0)).collect();
    if vals.len() > 1 {
        return (None, "모순".into());
    }
    let label = util::take_chars(&use_[0].2, 18);
    if good.is_empty() && use_.len() < 2 {
        return if allow_single {
            (Some(use_[0].0.clone()), format!("낮음·근거 1건·{label}"))
        } else {
            (None, "근거 1건(낮음)".into())
        };
    }
    let best = if use_.iter().any(|v| v.1 == "high") {
        "높음"
    } else if !good.is_empty() {
        "중간"
    } else {
        "낮음"
    };
    (Some(use_[0].0.clone()), format!("{best}·{label}"))
}

fn one(s: &BTreeSet<i64>) -> i64 {
    *s.iter().next().unwrap()
}

fn judge_seshin(row: &Row) -> (Option<Value>, String) {
    let (mut men, mut women, mut neutral) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    for (name, price) in price_items(g(row, "가격표")) {
        if !SESHIN.is_match(&name) || SESHIN_SKIP.is_match(&name) {
            continue;
        }
        if name.contains('남') {
            men.insert(price);
        } else if name.contains('여') {
            women.insert(price);
        } else {
            neutral.insert(price);
        }
    }
    let i = |n: i64| Value::from(n);
    if !men.is_empty() && !women.is_empty() {
        if men.len() == 1 && women.len() == 1 {
            let (m, w) = (one(&men), one(&women));
            let v = if m == w {
                obj(vec![("price_full", i(m))])
            } else {
                obj(vec![("price_men", i(m)), ("price_women", i(w))])
            };
            return (Some(v), "높음·가격표".into());
        }
        return (None, "남녀 세신 항목이 여럿".into());
    }
    if !men.is_empty() || !women.is_empty() {
        let (key, set) = if !men.is_empty() {
            ("price_men", &men)
        } else {
            ("price_women", &women)
        };
        return if set.len() == 1 {
            (
                Some(obj(vec![(key, i(one(set)))])),
                "높음·가격표(한쪽 성별)".into(),
            )
        } else {
            (None, "세신 항목이 여럿".into())
        };
    }
    if neutral.len() == 1 {
        return (
            Some(obj(vec![("price_full", i(one(&neutral)))])),
            "높음·가격표".into(),
        );
    }
    (
        None,
        if neutral.is_empty() {
            "가격표에 세신 없음"
        } else {
            "세신 항목이 여럿"
        }
        .into(),
    )
}

/// 드라이기: 있는지(없음), 무료·유료(금액이 나오면 금액)를 여탕·남탕으로 나눠 판정한다.
/// 성별이 안 나온 문장은 공통 값(맨 위 paid·none)으로 둔다. 여탕은 유료인 곳이 많아 따로 본다(사용자 결정 2026-11-04).
/// 결과: {paid?|none?|has?, price?, low?, women?: {paid?|none?|has?, price?, low?}, men?: {…}}  (has: 있다고만 하고 무료·유료는 모름)
fn judge_hairdryer(row: &Row) -> (Option<Value>, String) {
    // 0 공통 · 1 여탕 · 2 남탕
    let mut votes: [Vec<Vote>; 3] = [vec![], vec![], vec![]];
    let mut prices: [BTreeSet<i64>; 3] = [BTreeSet::new(), BTreeSet::new(), BTreeSet::new()];
    let mut has: [Vec<&str>; 3] = [vec![], vec![], vec![]]; // '드라이기 있어요'(무료·유료 말 없이 있다고만 한 문장)의 신뢰도
    for (rel, label, s) in sentences_of(g(row, "드라이기근거")) {
        if !s.contains("드라이") {
            continue;
        }
        // 한 문장에 여탕·남탕이 같이 나오면('여탕은 유료, 남탕은 무료') 쉼표·마침표 단위로 나눠 본다
        let both = WOMEN.is_match(&s) && MEN.is_match(&s);
        let parts: Vec<String> = if both {
            CLAUSE.split(&s).map(|x| x.to_string()).collect()
        } else {
            vec![s.clone()]
        };
        for c in parts.iter().filter(|c| c.contains("드라이")) {
            let side = match (WOMEN.is_match(c), MEN.is_match(c)) {
                (true, false) => 1,
                (false, true) => 2,
                (false, false) if !both => 0,
                _ => continue, // 어느 탕 이야기인지 모르는 조각은 쓰지 않는다
            };
            let val = if DRY_NONE.is_match(c) {
                obj(vec![("none", Value::from(true))])
            } else {
                // '동전 없이 사용'·'돈 안 받아요'는 무료다. 문장에 '동전'이 있다는 이유로 유료로 읽지 않는다.
                let no_charge = NO_CHARGE.is_match(c);
                let free = FREE.is_match(c) || no_charge;
                let paid = !no_charge && PAID.is_match(c);
                if free == paid {
                    if !free && DRY_HAS.is_match(c) {
                        has[side].push(rel);
                    }
                    continue;
                }
                if paid {
                    if let Some(m) = DRY_PRICE.captures(c) {
                        let n = m.get(1).or_else(|| m.get(2)).unwrap().as_str().replace(',', "");
                        if let Ok(n) = n.parse::<i64>() {
                            if (100..=5000).contains(&n) {
                                prices[side].insert(n);
                            }
                        }
                    }
                }
                obj(vec![("paid", Value::from(paid))])
            };
            votes[side].push((val, rel, label.clone()));
        }
    }
    let mut out = Map::new();
    let mut note = Vec::new();
    for (i, name) in [(0, "공통"), (1, "여탕"), (2, "남탕")] {
        let (mut val, mut why) = decide(&votes[i], true);
        if val.is_none() && why.is_empty() && !has[i].is_empty() {
            // 무료·유료는 모르고 있다는 것만 안다
            val = Some(obj(vec![("has", Value::from(true))]));
            why = if has[i].len() < 2 && has[i].iter().all(|r| *r == "low") { "낮음·근거 1건".into() } else { format!("근거 {}건", has[i].len()) };
        }
        let Some(mut v) = val else {
            if !why.is_empty() {
                note.push(format!("{name}:{why}"));
            }
            continue;
        };
        let m = v.as_object_mut().unwrap();
        if m.get("paid") == Some(&Value::Bool(true)) && prices[i].len() == 1 {
            m.insert("price".into(), Value::from(one(&prices[i]))); // 금액이 하나로 모일 때만
        }
        if why.starts_with("낮음") {
            m.insert("low".into(), Value::from(true)); // 화면에 '후기 1건 기준'이라고 밝힌다
        }
        let word = if m.contains_key("has") {
            "있음".to_string()
        } else if m.contains_key("none") {
            "없음".to_string()
        } else if m.get("paid") == Some(&Value::Bool(true)) {
            match m.get("price") {
                Some(p) => format!("유료 {p}원"),
                None => "유료".into(),
            }
        } else {
            "무료".into()
        };
        note.push(format!("{name} {word} ({why})"));
        if i == 0 {
            for (k, x) in std::mem::take(m) {
                out.insert(k, x); // 공통 값은 예전처럼 맨 위에 둔다(사람이 확인한 {paid}와 같은 모양)
            }
        } else {
            out.insert(if i == 1 { "women" } else { "men" }.into(), v);
        }
    }
    let note = if note.is_empty() { "근거 없음".to_string() } else { note.join(" / ") };
    if !out.is_empty() {
        (Some(Value::Object(out)), note)
    } else {
        (None, note)
    }
}

fn word_num(n: &str) -> i64 {
    match n {
        "한" | "하나" => 1,
        "두" => 2,
        "세" => 3,
        "네" => 4,
        d => d.parse().unwrap_or(0),
    }
}

fn judge_towel(row: &Row) -> (Map<String, Value>, String) {
    let mut votes: [(&str, Vec<Vote>); 2] = [("women", vec![]), ("men", vec![])];
    for (rel, label, s) in sentences_of(g(row, "수건근거")) {
        if !s.contains("수건") || TOWEL_SKIP.is_match(&s) {
            continue; // 개인 취향·선택·추가 요금 문장은 안내가 아니라서 쓰지 않는다
        }
        let (w, m) = (WOMEN.is_match(&s), MEN.is_match(&s));
        if w == m {
            continue; // 성별을 알 수 없거나 둘 다 말한 문장은 쓰지 않는다
        }
        let val = if let Some(c) = TOWEL_CNT.captures(&s) {
            let n = c.get(1).or_else(|| c.get(3)).unwrap().as_str();
            obj(vec![
                ("mode", Value::from("limited")),
                ("count", Value::from(word_num(n))),
            ])
        } else if TOWEL_UNL.is_match(&s) {
            obj(vec![("mode", Value::from("unlimited"))])
        } else {
            continue;
        };
        votes[if w { 0 } else { 1 }].1.push((val, rel, label));
    }
    let mut out = Map::new();
    let mut note = Vec::new();
    for (gname, v) in &votes {
        let (val, why) = decide(v, false);
        if let Some(val) = val {
            out.insert(gname.to_string(), val);
            note.push(format!("{gname}:{why}"));
        }
    }
    let note = if note.is_empty() {
        "근거 없음".to_string()
    } else {
        note.join(" / ")
    };
    (out, note)
}

/// 가격표의 찜질복·야간 입장·시간 초과. 값이 하나로 정해지지 않으면 넣지 않는다. 야간 추가금은 (야간 − 주간)을 코드로 계산한다.
fn judge_fees(row: &Row) -> Map<String, Value> {
    let items = price_items(g(row, "가격표"));
    let mut fees = Map::new();
    let clothes: BTreeSet<i64> = items
        .iter()
        .filter(|(n, _)| CLOTHES.is_match(n) && !CLOTHES_SKIP.is_match(n))
        .map(|x| x.1)
        .collect();
    if clothes.len() == 1 {
        fees.insert("clothes".into(), Value::from(one(&clothes)));
    }
    let adult: Vec<&(String, i64)> = items
        .iter()
        .filter(|(n, _)| ADULT.is_match(n) && !NOT_ADULT.is_match(n))
        .collect();
    let day: BTreeSet<i64> = adult
        .iter()
        .filter(|(n, _)| DAY.is_match(n))
        .map(|x| x.1)
        .collect();
    let night: BTreeSet<i64> = adult
        .iter()
        .filter(|(n, _)| NIGHT.is_match(n))
        .map(|x| x.1)
        .collect();
    if night.len() == 1 {
        let n = one(&night);
        if day.len() == 1 && n > one(&day) {
            fees.insert(
                "night".into(),
                obj(vec![
                    ("price", Value::from(n)),
                    ("extra", Value::from(n - one(&day))),
                ]),
            );
        } else if day.is_empty() && n >= 5000 {
            // 주간 요금이 없고 5천 원 미만이면 추가금인지 총액인지 알 수 없어 뺀다
            fees.insert("night".into(), obj(vec![("price", Value::from(n))]));
        }
    }
    let over: BTreeSet<(String, i64)> = items
        .iter()
        .filter(|(n, _)| OVERTIME.is_match(n))
        .cloned()
        .collect();
    if over.len() == 1 {
        let (n, p) = over.into_iter().next().unwrap();
        fees.insert(
            "overtime".into(),
            obj(vec![("price", Value::from(p)), ("label", Value::from(n))]),
        );
    }
    fees
}

// 후기·블로그 문장에 적힌 입장료: '입장료 13,000원', '목욕비는 25,000원', '대인 10,000원', '입장료2만원'
re!(
    PRICE_SAY,
    r"(?:입장료|목욕비|목욕료|목욕 요금|이용요금|이용료|대인|성인)\s*(?:\(|은|는|이|가|:|요금|가격|도)?\s*(?:평일\s*|주간\s*)?(\d{1,2},\d{3}|\d{4,5}|\d(?:\.\d)?\s*만)\s*원"
);

fn price_num(s: &str) -> Option<i64> {
    let s = s.replace([',', ' '], "");
    let n = match s.strip_suffix('만') {
        Some(m) => (m.parse::<f64>().ok()? * 10_000.0) as i64,
        None => s.parse().ok()?,
    };
    (5_000..HIGH_PRICE).contains(&n).then_some(n)
}

/// 최근 1년 안 후기·블로그에 적힌 입장료 중 가장 최근 것: (날짜, 금액, 출처). 같은 날 금액이 엇갈리면 쓰지 않는다
fn newest_said_price(reviews: Option<&Vec<Review>>, blogs: Option<&Vec<Review>>) -> Option<(String, i64, &'static str)> {
    let from = util::fresh_from();
    let mut said: Vec<(String, i64, &'static str)> = Vec::new();
    for (src, list) in [("방문자 후기", reviews), ("블로그", blogs)] {
        for rv in list.into_iter().flatten().filter(|rv| rv.date >= from) {
            for ln in &rv.lines {
                for c in PRICE_SAY.captures_iter(ln) {
                    if let Some(n) = price_num(&c[1]) {
                        said.push((rv.date.clone(), n, src));
                    }
                }
            }
        }
    }
    let newest = said.iter().map(|x| x.0.clone()).max()?;
    let same: BTreeSet<i64> = said.iter().filter(|x| x.0 == newest).map(|x| x.1).collect();
    if same.len() != 1 {
        return None;
    }
    said.into_iter().find(|x| x.0 == newest)
}

/// 요금 정하기(가장 최근 자료 기준). 가격표는 올린 날을 알 수 없어 '지금 업체가 올린 값'으로 본다.
/// 최근 1년 후기·블로그가 가격표보다 높은 입장료를 말하면 가격표가 안 고쳐진 것으로 보고 그 값을 쓴다(요금은 오르기만 하는 경우가 대부분).
/// 더 낮으면 할인·예전 값일 수 있어 가격표를 그대로 둔다. 가격표가 없으면 최근 후기·블로그 값을 쓴다.
/// → (성인, 주말, 어린이, 확인일, 메모, 출처)
fn price_decide(
    table: Option<(i64, Option<i64>, Option<i64>)>,
    said: Option<(String, i64, &'static str)>,
    collected: &str,
) -> Option<(i64, Option<i64>, Option<i64>, String, String, String)> {
    let tbl = |(a, w, c): (i64, Option<i64>, Option<i64>)| {
        (a, w, c, collected.to_string(), "네이버 플레이스 가격표에 가게가 올린 입장료(자동 판정)".to_string(), "네이버 플레이스 가격표(자동 판정)".to_string())
    };
    match (table, said) {
        (Some((a, w, c)), Some((d, n, src))) if n > a => Some((
            n,
            w.filter(|w| *w >= n),
            c.filter(|c| *c < n),
            d.clone(),
            format!("{src} {d}에 적힌 입장료 {n}원(가격표 {a}원보다 최근 값)"),
            format!("네이버 {src}(자동 판정, 가장 최근 자료)"),
        )),
        (Some(t), _) => Some(tbl(t)),
        (None, Some((d, n, src))) => Some((
            n,
            None,
            None,
            d.clone(),
            format!("{src} {d}에 적힌 입장료"),
            format!("네이버 {src}(자동 판정, 가장 최근 자료)"),
        )),
        (None, None) => None,
    }
}

/// 네이버 가격표의 입장료: 성인 평일(주간)·주말·어린이. 항목마다 값이 하나로 정해질 때만 쓴다. 성인 평일이 없으면 줄을 만들지 않는다.
fn judge_prices(row: &Row) -> Option<(i64, Option<i64>, Option<i64>)> {
    let items = price_items(g(row, "가격표"));
    let uniq = |m: &dyn Fn(&str) -> bool| {
        let s: BTreeSet<i64> = items.iter().filter(|(n, _)| m(n)).map(|x| x.1).collect();
        if s.len() == 1 {
            Some(one(&s))
        } else {
            None
        }
    };
    let adult_like = |n: &str| ADULT.is_match(n) && !NOT_ADULT.is_match(n) && !NIGHT.is_match(n);
    let adult = uniq(&|n| adult_like(n) && !WEEKEND.is_match(n))?;
    let mut weekend = uniq(&|n| adult_like(n) && WEEKEND.is_match(n));
    let mut child = uniq(&|n| {
        CHILD.is_match(n) && !NIGHT.is_match(n) && !WEEKEND.is_match(n) && !CHILD_SKIP.is_match(n)
    });
    if child.is_some_and(|c| c >= adult) {
        child = None; // 소인이 대인 이상이면 항목을 잘못 읽은 것이다
    }
    if weekend.is_some_and(|w| w < adult) {
        weekend = None; // 주말이 평일보다 싸면 잘못 읽었을 가능성이 커서 뺀다
    }
    Some((adult, weekend, child))
}

fn judge_supplies(row: &Row) -> Map<String, Value> {
    let (mut s_ok, mut b_ok) = (false, false);
    for (rel, _, s) in sentences_of(g(row, "샴푸근거")) {
        if rel == "low" || SUP_SKIP.is_match(&s) {
            continue;
        }
        if SUP_OK.is_match(&s) {
            s_ok |= s.contains("샴푸");
            b_ok |= s.contains("바디워시");
        }
    }
    let mut m = Map::new();
    if s_ok {
        m.insert("shampoo".into(), Value::from(true));
    }
    if b_ok {
        m.insert("bodywash".into(), Value::from(true));
    }
    m
}

/// 파이썬 re.search(r"폐업|휴업|영업 종료(?!.*에)", s): 같은 줄 뒤에 '에'가 없는 '영업 종료'
fn closed_mark(s: &str) -> bool {
    if CLOSE_WORD.is_match(s) {
        return true;
    }
    s.match_indices("영업 종료").any(|(i, m)| {
        !s[i + m.len()..]
            .split('\n')
            .next()
            .unwrap_or("")
            .contains('에')
    })
}

/// 제외할 곳: (카카오ID → (사유, 근거)). 폐업은 업체 영업 표시에 폐업·휴업이 직접 적힌 곳만 잡는다.
fn exclusion_reasons(rows: &[Row], merged: &[Row]) -> Result<HashMap<String, (String, String)>> {
    let mut ex: HashMap<String, (String, String)> = HashMap::new();
    let cand = if util::exists(CANDIDATES) {
        read(CANDIDATES)?
    } else {
        vec![]
    };
    for r in &cand {
        if g(r, "확신") == "확실" || FIT_STRONG.is_match(g(r, "이름")) {
            ex.insert(
                g(r, "카카오ID").into(),
                (
                    "피트니스·스포츠 시설".into(),
                    format!("이름 기준({})", g(r, "이름")),
                ),
            );
        }
    }
    let brands: Vec<String> = merged
        .iter()
        .map(|r| BRAND.replace_all(g(r, "이름"), "").into_owned())
        .collect();
    let mut bc: HashMap<&str, usize> = HashMap::new();
    for b in &brands {
        *bc.entry(b.as_str()).or_default() += 1;
    }
    for (r, b) in merged.iter().zip(&brands) {
        if bc[b.as_str()] > 1 && FIT_STRONG.is_match(g(r, "이름")) {
            ex.entry(g(r, "카카오ID").into()).or_insert((
                "피트니스 체인".into(),
                format!("같은 이름 {}곳({})", bc[b.as_str()], g(r, "이름")),
            ));
        }
    }
    // 공공데이터(목욕장업 인허가)에 폐업으로 나온 곳: license_check가 '확실'(관리번호, 또는 주소+이름)으로 맞춘 곳만 뺀다
    let lic = "data/collected/license_match.csv";
    if util::exists(lic) {
        for r in read(lic)? {
            let st = g(&r, "영업상태");
            // 세신·프라이빗 스파: 인허가 업태가 '목욕장업 기타'이고 400㎡ 미만인데 이름에 목욕탕다운 말이 없는 곳(사용자 결정 2026-11-04).
            // 이름에 사우나·목욕·탕이 있으면 작아도 동네 목욕탕이라 남긴다(삼성대중사우나·착한사우나)
            let area: f64 = g(&r, "면적").parse().unwrap_or(0.0);
            if g(&r, "확실") == "확실" && g(&r, "업태") == "목욕장업 기타" && area > 0.0 && area < 400.0 && !BATH_NAME.is_match(g(&r, "이름")) {
                ex.entry(g(&r, "카카오ID").into())
                    .or_insert(("세신·프라이빗 스파(소규모)".into(), format!("목욕장업 인허가 {}: 업태 기타, {area}㎡", g(&r, "관리번호"))));
            }            if g(&r, "확실") == "확실" && !st.is_empty() && !st.starts_with("영업") {
                ex.entry(g(&r, "카카오ID").into()).or_insert((
                    "폐업(공공데이터)".into(),
                    format!("목욕장업 인허가 {}: {} {}", g(&r, "관리번호"), st, g(&r, "폐업일자")).trim().to_string(),
                ));
            }
        }
    }    // 네이버 자료가 없는 곳(인허가 자료만 있는 호텔 사우나 등)도 이름으로 범위 밖을 거른다
    let with_naver: HashSet<&str> = rows.iter().map(|r| g(r, "카카오ID")).collect();
    for r in merged {
        if let Some(why) = tangbang_data::naver::out_of_scope(g(r, "이름"), "", "") {
            ex.entry(g(r, "카카오ID").into()).or_insert(why);
        } else if tangbang_data::naver::is_hotel(g(r, "이름"), "") && !with_naver.contains(g(r, "카카오ID")) {
            // 네이버 자료가 없어 요금을 모르는 호텔 사우나
            ex.entry(g(r, "카카오ID").into()).or_insert(("호텔 사우나(요금 모름)".into(), "네이버 자료 없음. 요금이 확인되면 4만 원 미만일 때 다시 넣는다".into()));
        }
    }
    if util::exists(FOUND) {
        // 이름 검색으로 이은 곳은 네이버에 올라 있는 이름도 본다
        for r in read(FOUND)? {
            if g(&r, "결과") == "일치" && FIT_STRONG.is_match(g(&r, "네이버이름")) {
                ex.entry(g(&r, "카카오ID").into()).or_insert((
                    "피트니스·스포츠 시설".into(),
                    format!("네이버 이름 기준({})", g(&r, "네이버이름")),
                ));
            }
        }
    }
    for r in rows {
        let items = price_items(g(r, "가격표"));
        let mas = items.iter().filter(|(n, _)| MASSAGE.is_match(n)).count();
        let bath = items.iter().filter(|(n, _)| BATH_ITEM.is_match(n)).count();
        let ses = items
            .iter()
            .filter(|(n, _)| SESHIN.is_match(n) || SES_EXTRA.is_match(n))
            .count();
        let kid = g(r, "카카오ID").to_string();
        // 세신은 마사지가 아니다: 세신 항목이 있으면 마사지가 여러 개여도 세신 중심으로 보고 남긴다
        if (mas >= 3 && ses == 0) || (mas > 0 && bath == 0 && items.len() <= 2) {
            ex.entry(kid.clone()).or_insert((
                "마사지 중심".into(),
                format!(
                    "가격표 {}개 중 마사지·테라피 {mas}종, 세신 {ses}종",
                    items.len()
                ),
            ));
        }
        // 동네 목욕탕 범위 밖(워터파크 겸용·호텔·리조트, 사용자 결정 2026-11-04): 기준은 naver::out_of_scope 한 곳
        let cat = g(r, "네이버분류");
        if let Some(why) = tangbang_data::naver::out_of_scope(g(r, "이름"), cat, g(r, "가격표")) {
            ex.entry(kid.clone()).or_insert(why);
        }
        // 일반 호텔 사우나: 가격표 입장료가 있으면 4만 원 미만은 남기고(아래 고가 규칙이 4만 원 이상을 뺀다), 모르면 확인 전까지 뺀다
        if tangbang_data::naver::is_hotel(g(r, "이름"), cat) && judge_prices(r).is_none() {
            ex.entry(kid.clone()).or_insert(("호텔 사우나(요금 모름)".into(), "요금이 확인되면 4만 원 미만일 때 다시 넣는다".into()));
        }
        // 입장료가 4만 원 이상인 곳(호텔·리조트급, 사용자 결정 2026-11-04). 회원권·묶음표는 judge_prices가 이미 뺀 값이다
        if let Some((adult, weekend, _)) = judge_prices(r) {
            let top = weekend.map_or(adult, |w| w.max(adult));
            if top >= HIGH_PRICE {
                ex.entry(kid.clone()).or_insert(("고가(입장료 4만 원 이상)".into(), format!("가격표 성인 {top}원")));
            }
        }
        // 네이버 업종이 헬스장이면 피트니스 시설(이름에 '헬스'가 없어도)
        if cat.split(',').any(|c| c.trim() == "헬스장") {
            ex.entry(kid.clone())
                .or_insert(("피트니스 시설".into(), format!("네이버 분류: {cat}")));
        }
        if FIT_PRICE.is_match(g(r, "가격표")) {
            ex.entry(kid.clone())
                .or_insert(("피트니스 시설".into(), "가격표에 트레이너·레슨".into()));
        }
        let hours = g(r, "영업표시");
        if closed_mark(hours) && !hours.contains("에 영업 종료") {
            ex.entry(kid)
                .or_insert(("폐업·휴업".into(), format!("영업 표시: {hours}")));
        }
    }
    Ok(ex)
}

fn opt_col(vals: &[Option<i64>]) -> Vec<String> {
    // 판다스: None이 섞인 정수 칸은 실수(12000.0), 전부 None이면 빈칸
    let mixed = vals.iter().any(|v| v.is_none());
    vals.iter()
        .map(|v| match v {
            None => String::new(),
            Some(n) if mixed => util::py_float(*n as f64),
            Some(n) => n.to_string(),
        })
        .collect()
}

fn main() -> Result<()> {
    let rows: Vec<Row> = read(FACTS_CSV)?
        .into_iter()
        .filter(|r| g(r, "상태") == "ok")
        .collect();
    let rows = pysort::keep_first(rows, |r| g(r, "카카오ID").to_string());
    let merged = read(MERGED)?;
    println!(
        "판정 대상(상태 ok): {}곳 / 합친 목록 {}곳",
        rows.len(),
        merged.len()
    );

    let ex = exclusion_reasons(&rows, &merged)?;
    let old = if util::exists(EXCLUDED) {
        csvio::read_csv(EXCLUDED, true, Dtype::AllStr)?
    } else {
        Table::empty(&EX_COLS)
    };
    let old_rows = old.records();
    let old_ids: HashSet<String> = old_rows
        .iter()
        .map(|r| csvio::get(r, "카카오ID").to_string())
        .collect();
    let today = util::today_kst();
    let mut add: Vec<Row> = Vec::new();
    for m in &merged {
        let k = g(m, "카카오ID");
        if let Some((why, basis)) = ex.get(k) {
            if !old_ids.contains(k) {
                let vals = [k, g(m, "이름"), g(m, "주소"), why, basis, &today];
                add.push(
                    EX_COLS
                        .iter()
                        .zip(vals)
                        .map(|(c, v)| (c.to_string(), v.to_string()))
                        .collect(),
                );
            }
        }
    }
    let ex_cols = csvio::union_cols(&old.cols, &EX_COLS);
    let allx: Vec<Row> = old_rows.iter().chain(add.iter()).cloned().collect();
    csvio::write_rows(EXCLUDED, &ex_cols, &allx)?;
    println!(
        "제외 목록 {}곳(이번에 추가 {}곳). 사유별: {}",
        allx.len(),
        add.len(),
        util::dict_repr(&util::value_counts(
            allx.iter().map(|r| csvio::get(r, "사유"))
        ))
    );

    let gone: HashSet<&str> = allx.iter().map(|r| csvio::get(r, "카카오ID")).collect();
    let hours = load_hours()?;
    println!("요일별 영업시간이 있는 곳 {}곳", hours.len());
    let reviews = load_reviews()?;
    println!(
        "후기 탭 수집이 있는 곳 {}곳(후기 문장 {}건)",
        reviews.len(),
        reviews.values().map(|v| v.len()).sum::<usize>()
    );
    let blogs = load_blogs()?;
    println!(
        "블로그 탭 수집이 있는 곳 {}곳(키워드 글 {}건)",
        blogs.len(),
        blogs.values().map(|v| v.len()).sum::<usize>()
    );

    let mut facts = Map::new();
    let mut judged: Vec<Vec<String>> = Vec::new();
    let mut price_rows: Vec<(String, i64, Option<i64>, Option<i64>, String, String, String)> = Vec::new();
    let dump = |v: &Value| pyjson::dumps(v, &pyjson::DEFAULT);
    for r0 in rows.iter().filter(|r| !gone.contains(g(r, "카카오ID"))) {
        let kid = g(r0, "카카오ID").to_string();
        let mut f = Map::new();
        let mut hint = String::new();
        let r = match reviews.get(&kid) {
            Some(rv) => {
                hint = closed_hints(rv);
                add_review_evidence(r0, rv)
            }
            None => r0.clone(),
        };
        let r = match blogs.get(&kid) {
            Some(b) => add_blog_evidence(&r, b),
            None => r,
        };
        let (v, why) = judge_seshin(&r);
        let n_seshin = match &v {
            Some(v) => format!("{} ({why})", dump(v)),
            None => format!("불명({why})"),
        };
        if let Some(v) = v {
            f.insert("seshin".into(), v);
        }
        let (v, why) = judge_hairdryer(&r);
        let n_dry = match &v {
            Some(_) => why,
            None => format!("불명({why})"),
        };
        if let Some(v) = v {
            f.insert("hairdryer".into(), v);
        }
        let (v, why) = judge_towel(&r);
        let n_towel = if v.is_empty() {
            format!("불명({why})")
        } else {
            format!("{} ({why})", dump(&Value::Object(v.clone())))
        };
        if !v.is_empty() {
            f.insert("towel".into(), Value::Object(v));
        }
        let sup = judge_supplies(&r);
        let has_shampoo = sup.contains_key("shampoo");
        if !sup.is_empty() {
            f.insert("supplies".into(), Value::Object(sup));
        }
        let fees = judge_fees(&r);
        let n_fees = if fees.is_empty() {
            String::new()
        } else {
            dump(&Value::Object(fees.clone()))
        };
        if !fees.is_empty() {
            f.insert("fees".into(), Value::Object(fees));
        }
        let mut conv = Map::new();
        let open24 = g(&r, "영업표시").starts_with("24시간");
        if open24 {
            conv.insert("open_24h".into(), Value::from(true));
        }
        if !g(&r, "휴무").is_empty() {
            // '연중무휴'·'매달 2, 4번째 화요일 정기 휴무' 같은 업체 등록 문구 그대로
            conv.insert("closed_days".into(), Value::from(g(&r, "휴무")));
        }
        if let Some(h) = hours.get(&kid) {
            conv.insert("hours".into(), h.clone());
        }
        if !conv.is_empty() {
            f.insert("convenience".into(), Value::Object(conv));
        }
        let said = newest_said_price(reviews.get(&kid), blogs.get(&kid));
        if let Some((a, w, c, d, memo, src)) = price_decide(judge_prices(&r), said, g(&r, "수집일")) {
            price_rows.push((kid.clone(), a, w, c, d, memo, src));
        }
        if !f.is_empty() {
            f.insert("checked".into(), Value::from(g(&r, "수집일")));
            f.insert(
                "source".into(),
                Value::from("네이버 플레이스 수집 자동 판정(근거 신뢰도는 facts_judged.csv)"),
            );
            facts.insert(kid.clone(), Value::Object(f));
        }
        judged.push(vec![
            kid,
            g(&r, "이름").to_string(),
            hint,
            n_seshin,
            n_dry,
            n_towel,
            n_fees,
            if has_shampoo { "있음" } else { "불명" }.into(),
            if open24 { "예" } else { "" }.into(),
        ]);
    }
    let out = obj(vec![
        ("_설명", Value::from("judge_facts(cargo run --release --bin judge_facts)가 만든다. 사람이 확인한 data/curated/place_facts.json이 항목별로 우선한다.")),
        ("places", Value::Object(facts.clone())),
    ]);
    util::write_text(OUT_FACTS, &pyjson::dumps(&out, &pyjson::INDENT1))?;
    let jcols = [
        "카카오ID",
        "이름",
        "폐업후기",
        "세신",
        "드라이기",
        "수건",
        "요금세부",
        "샴푸",
        "24시간",
    ];
    csvio::write_csv(OUT_JUDGED, &jcols, &judged)?;

    let weekend = opt_col(&price_rows.iter().map(|p| p.2).collect::<Vec<_>>());
    let child = opt_col(&price_rows.iter().map(|p| p.3).collect::<Vec<_>>());
    let body: Vec<Vec<String>> = price_rows
        .iter()
        .enumerate()
        .map(|(i, p)| {
            vec![
                p.0.clone(),
                p.1.to_string(),
                weekend[i].clone(),
                String::new(),
                String::new(),
                child[i].clone(),
                String::new(),
                p.5.clone(),
                p.6.clone(),
                p.4.clone(),
            ]
        })
        .collect();
    csvio::write_csv(OUT_PRICES, &PRICE_COLS_OUT, &body)?;
    let by_said = price_rows.iter().filter(|p| !p.6.starts_with("네이버 플레이스 가격표")).count();
    println!("요금 출처(조건: 가장 최근 자료) 가격표 {}곳 / 최근 1년 후기·블로그 {by_said}곳", price_rows.len() - by_said);
    println!("입장료를 정한 곳 {}곳 → {OUT_PRICES} (사람이 확인한 onsen_prices.csv에 없는 곳만 서비스에 쓴다)", price_rows.len());
    println!(
        "판정한 곳 {}곳 → 값이 하나라도 나온 곳 {}곳",
        judged.len(),
        facts.len()
    );
    for (k, ci) in [("세신", 3), ("드라이기", 4), ("수건", 5)] {
        let unk = judged.iter().filter(|j| j[ci].starts_with("불명")).count();
        println!("  {k}: 값 있음 {}곳 / 불명 {unk}곳", judged.len() - unk);
    }
    Ok(())
}
