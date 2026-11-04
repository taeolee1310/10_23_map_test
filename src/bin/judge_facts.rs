//! 수집한 근거 문장(naver_home_facts.csv)으로 세신·수건·드라이기 등을 판정하고, 제외할 곳을 고른다.
//!
//! 원칙: 근거가 부족하거나 후기끼리 엇갈리면 '불명'으로 두고 추측하지 않는다. 오래된 근거만 있으면 신뢰도를 낮추고, 낮은 근거는 2건 이상 일치할 때만 쓴다.
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
const CANDIDATES: &str = "data/collected/excluded_candidates.csv"; // 이름으로 거른 피트니스 후보(확실/애매)
const EXCLUDED: &str = "data/curated/excluded.csv";
const FOUND: &str = "data/collected/naver_id_found.csv"; // find_naver_ids가 이름 검색으로 찾은 ID
const OUT_FACTS: &str = "data/collected/place_facts_auto.json";
const OUT_JUDGED: &str = "data/collected/facts_judged.csv";
const OUT_PRICES: &str = "data/collected/price_auto.csv";
const EX_COLS: [&str; 6] = ["카카오ID", "이름", "주소", "사유", "근거", "확인일"];
const REVIEWS: &str = "data/collected/naver_reviews.jsonl"; // scripts/collect_reviews.mjs가 후기 탭에서 모은 키워드 문장(방문일 포함)
const HOURS: &str = "data/collected/naver_hours.jsonl"; // scripts/collect_hours.mjs가 '펼쳐보기'로 모은 요일별 영업시간
const DAYS: [&str; 7] = ["월", "화", "수", "목", "금", "토", "일"];
const REVIEW_COLS: [(&str, &[&str]); 3] =
    [("수건근거", &["수건", "타월", "타올"]), ("드라이기근거", &["드라이"]), ("샴푸근거", &["샴푸", "바디워시", "어메니티"])];
const PRICE_COLS_OUT: [&str; 10] = ["카카오ID", "성인_평일", "성인_주말", "수건", "주차", "어린이", "추가요금_없음확인", "메모", "출처", "확인일"];

re!(FIT_STRONG, r"휘트니스|피트니스|스포츠클럽|스포츠센터|짐$|짐 |GYM|gym|요가|필라테스|크로스핏|체육관");
re!(FIT_PRICE, r"트레이너|레슨|\bPT\b"); // '회원권'·'헬스'는 동네 목욕탕 가격표에도 흔해서 쓰지 않는다
re!(MASSAGE, r"마사지|테라피|아로마|스웨디시|왁싱|경락");
re!(BATH_ITEM, r"대인|성인|입욕|목욕|일반|주간|야간|사우나|찜질|한증");
re!(SESHIN, r"세신|때밀이|때\s*밀");
re!(SESHIN_SKIP, r"코스|\d+분|오일|마사지|테라피|임산부|소인|어린이|초등|아이");
re!(SES_EXTRA, r"때\(|미니때|VIP\s*때|기본때|^등$|^머리$");
re!(WOMEN, r"여탕|여자|여성|여\)|\(여|여사우나");
re!(MEN, r"남탕|남자|남성|남\)|\(남");
re!(NUM_TOK, r"^[\d,]+$");
re!(LABEL, r"^\[(.+?)\] (.*)");
re!(YM, r"(20\d\d)년 (\d{1,2})월");
re!(DRY_NONE, r"드라이\S*\s?(는|도)?\s?없");
re!(NO_CHARGE, r"(동전|돈|요금|비용).{0,5}(없이|안\s?(받|내|들|넣)|필요\s?없)|그냥\s?(사용|쓸)");
re!(FREE, r"드라이\S*.{0,12}(무료|공짜)|(무료|공짜).{0,12}드라이");
re!(PAID, r"드라이\S*.{0,12}(유료|\d+원|동전|코인|돈\s?받)|(유료|\d+원|동전|코인).{0,12}드라이");
re!(TOWEL_SKIP, r"충분|필요|여쭤|몇 ?장|원하|추가|더 ");
re!(TOWEL_CNT, r"수건\D{0,8}?(\d+|한|두|세|네)\s?(장|개)|(\d+|한|두|세|네)\s?(장|개)\D{0,4}수건");
re!(TOWEL_UNL, r"수건.{0,10}(무제한|마음껏|자유롭게|셀프)");
re!(CLOTHES, r"찜질복|가운|까운|수면복|찜질옷");
re!(CLOTHES_SKIP, r"보증|세탁|분실|반납");
re!(NIGHT, r"야간|심야");
re!(DAY, r"주간");
re!(ADULT, r"대인|성인|일반|입욕|입장|사우나|목욕");
// 나이 범위가 든 항목은 성인 요금으로 보지 않는다
re!(NOT_ADULT, r"소인|어린이|유아|초등|학생|경로|청소년|미취학|찜질복|가운|까운|세신|회원|\d+매|\d+장|수면|룸|\d+세|개월|미만|이하|~|아동|소아|취학");
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
fn sentences_of(cell: &str) -> Vec<(&'static str, String, String)> {
    let mut out = Vec::new();
    for part in cell.split(" ‖ ").filter(|p| !p.is_empty()) {
        let Some(c) = LABEL.captures(part) else { continue };
        let (label, s) = (c[1].to_string(), c[2].to_string());
        let rel = if label.starts_with("업체등록") {
            "high"
        } else {
            match YM.captures(&label) {
                Some(d) if (d[1].parse::<i32>().unwrap(), d[2].parse::<i32>().unwrap()) >= (2025, 11) => "mid",
                _ => "low",
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
    let mut out = HashMap::new();
    for r in jsonl(REVIEWS)? {
        let revs = r["reviews"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|rv| Review {
                date: pyjson::py_str(&rv["date"]),
                lines: rv["lines"].as_array().cloned().unwrap_or_default().iter().map(pyjson::py_str).collect(),
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
        let mut parts: Vec<String> =
            g(&row, col).split(" ‖ ").filter(|p| !p.is_empty() && !p.starts_with("[방문자리뷰(날짜없음)]")).map(String::from).collect();
        for rv in &sorted {
            let d: Vec<&str> = rv.date.split('-').collect();
            let num = |s: &str| s.parse::<i64>().map(|n| n.to_string()).unwrap_or_else(|_| s.to_string());
            let label = format!("방문자리뷰 {}년 {}월 {}일", d[0], num(d[1]), num(d[2]));
            parts.extend(rv.lines.iter().filter(|ln| words.iter().any(|w| ln.contains(w))).map(|ln| format!("[{label}] {ln}")));
        }
        row.insert(col.into(), parts.join(" ‖ "));
    }
    row
}

/// {카카오ID: {'월': '06:00 - 23:00', ...}}. 요일 표가 없는 곳(24시간 영업 등)은 넣지 않는다.
fn load_hours() -> Result<HashMap<String, Value>> {
    let mut out = HashMap::new();
    for r in jsonl(HOURS)? {
        let week = r.get("hours").and_then(|h| h.get("week")).cloned().unwrap_or(Value::Null);
        let mut m = Map::new();
        for d in DAYS {
            if pyjson::truthy(week.get(d)) {
                let parts: Vec<String> = week[d].as_array().cloned().unwrap_or_default().iter().map(pyjson::py_str).collect();
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
fn closed_hints(reviews: &[Review]) -> String {
    let dates: BTreeSet<&str> = reviews
        .iter()
        .filter(|rv| rv.date.as_str() >= "2026-01-01" && rv.lines.iter().any(|ln| CLOSE_WORD.is_match(ln)))
        .map(|rv| rv.date.as_str())
        .collect();
    if dates.is_empty() {
        String::new()
    } else {
        format!("폐업·휴업 언급 후기 {}", dates.iter().rev().copied().collect::<Vec<_>>().join(", "))
    }
}

type Vote = (Value, &'static str, String);

/// 높음·중간 근거가 있으면 그것만, 없으면 낮은 근거가 2건 이상 일치할 때만(allow_single이면 1건도 '낮음'으로 씀). 서로 다르면 모순.
fn decide(votes: &[Vote], allow_single: bool) -> (Option<Value>, String) {
    let good: Vec<&Vote> = votes.iter().filter(|v| v.1 == "high" || v.1 == "mid").collect();
    let use_: Vec<&Vote> = if good.is_empty() { votes.iter().collect() } else { good.clone() };
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
    let best = if use_.iter().any(|v| v.1 == "high") { "높음" } else if !good.is_empty() { "중간" } else { "낮음" };
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
            let v = if m == w { obj(vec![("price_full", i(m))]) } else { obj(vec![("price_men", i(m)), ("price_women", i(w))]) };
            return (Some(v), "높음·가격표".into());
        }
        return (None, "남녀 세신 항목이 여럿".into());
    }
    if !men.is_empty() || !women.is_empty() {
        let (key, set) = if !men.is_empty() { ("price_men", &men) } else { ("price_women", &women) };
        return if set.len() == 1 {
            (Some(obj(vec![(key, i(one(set)))])), "높음·가격표(한쪽 성별)".into())
        } else {
            (None, "세신 항목이 여럿".into())
        };
    }
    if neutral.len() == 1 {
        return (Some(obj(vec![("price_full", i(one(&neutral)))])), "높음·가격표".into());
    }
    (None, if neutral.is_empty() { "가격표에 세신 없음" } else { "세신 항목이 여럿" }.into())
}

fn judge_hairdryer(row: &Row) -> (Option<Value>, String) {
    let mut votes = Vec::new();
    for (rel, label, s) in sentences_of(g(row, "드라이기근거")) {
        if !s.contains("드라이") || DRY_NONE.is_match(&s) {
            continue;
        }
        // '동전 없이 사용'·'돈 안 받아요'는 무료다. 문장에 '동전'이 있다는 이유로 유료로 읽지 않는다.
        let no_charge = NO_CHARGE.is_match(&s);
        let free = FREE.is_match(&s) || no_charge;
        let paid = !no_charge && PAID.is_match(&s);
        if free != paid {
            votes.push((obj(vec![("paid", Value::from(paid))]), rel, label));
        }
    }
    let (val, why) = decide(&votes, true);
    match val {
        Some(mut v) if why.starts_with("낮음") => {
            v.as_object_mut().unwrap().insert("low".into(), Value::from(true)); // 화면에 '후기 1건 기준'이라고 밝힌다
            (Some(v), why)
        }
        other => (other, why),
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
            obj(vec![("mode", Value::from("limited")), ("count", Value::from(word_num(n)))])
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
    let note = if note.is_empty() { "근거 없음".to_string() } else { note.join(" / ") };
    (out, note)
}

/// 가격표의 찜질복·야간 입장·시간 초과. 값이 하나로 정해지지 않으면 넣지 않는다. 야간 추가금은 (야간 − 주간)을 코드로 계산한다.
fn judge_fees(row: &Row) -> Map<String, Value> {
    let items = price_items(g(row, "가격표"));
    let mut fees = Map::new();
    let clothes: BTreeSet<i64> = items.iter().filter(|(n, _)| CLOTHES.is_match(n) && !CLOTHES_SKIP.is_match(n)).map(|x| x.1).collect();
    if clothes.len() == 1 {
        fees.insert("clothes".into(), Value::from(one(&clothes)));
    }
    let adult: Vec<&(String, i64)> = items.iter().filter(|(n, _)| ADULT.is_match(n) && !NOT_ADULT.is_match(n)).collect();
    let day: BTreeSet<i64> = adult.iter().filter(|(n, _)| DAY.is_match(n)).map(|x| x.1).collect();
    let night: BTreeSet<i64> = adult.iter().filter(|(n, _)| NIGHT.is_match(n)).map(|x| x.1).collect();
    if night.len() == 1 {
        let n = one(&night);
        if day.len() == 1 && n > one(&day) {
            fees.insert("night".into(), obj(vec![("price", Value::from(n)), ("extra", Value::from(n - one(&day)))]));
        } else if day.is_empty() && n >= 5000 {
            // 주간 요금이 없고 5천 원 미만이면 추가금인지 총액인지 알 수 없어 뺀다
            fees.insert("night".into(), obj(vec![("price", Value::from(n))]));
        }
    }
    let over: BTreeSet<(String, i64)> = items.iter().filter(|(n, _)| OVERTIME.is_match(n)).cloned().collect();
    if over.len() == 1 {
        let (n, p) = over.into_iter().next().unwrap();
        fees.insert("overtime".into(), obj(vec![("price", Value::from(p)), ("label", Value::from(n))]));
    }
    fees
}

/// 네이버 가격표의 입장료: 성인 평일(주간)·주말·어린이. 항목마다 값이 하나로 정해질 때만 쓴다. 성인 평일이 없으면 줄을 만들지 않는다.
fn judge_prices(row: &Row) -> Option<(i64, Option<i64>, Option<i64>)> {
    let items = price_items(g(row, "가격표"));
    let uniq = |m: &dyn Fn(&str) -> bool| {
        let s: BTreeSet<i64> = items.iter().filter(|(n, _)| m(n)).map(|x| x.1).collect();
        if s.len() == 1 { Some(one(&s)) } else { None }
    };
    let adult_like = |n: &str| ADULT.is_match(n) && !NOT_ADULT.is_match(n) && !NIGHT.is_match(n);
    let adult = uniq(&|n| adult_like(n) && !WEEKEND.is_match(n))?;
    let mut weekend = uniq(&|n| adult_like(n) && WEEKEND.is_match(n));
    let mut child = uniq(&|n| CHILD.is_match(n) && !NIGHT.is_match(n) && !WEEKEND.is_match(n) && !CHILD_SKIP.is_match(n));
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
    s.match_indices("영업 종료").any(|(i, m)| !s[i + m.len()..].split('\n').next().unwrap_or("").contains('에'))
}

/// 제외할 곳: (카카오ID → (사유, 근거)). 폐업은 업체 영업 표시에 폐업·휴업이 직접 적힌 곳만 잡는다.
fn exclusion_reasons(rows: &[Row], merged: &[Row]) -> Result<HashMap<String, (String, String)>> {
    let mut ex: HashMap<String, (String, String)> = HashMap::new();
    let cand = if util::exists(CANDIDATES) { read(CANDIDATES)? } else { vec![] };
    for r in &cand {
        if g(r, "확신") == "확실" || FIT_STRONG.is_match(g(r, "이름")) {
            ex.insert(g(r, "카카오ID").into(), ("피트니스·스포츠 시설".into(), format!("이름 기준({})", g(r, "이름"))));
        }
    }
    let brands: Vec<String> = merged.iter().map(|r| BRAND.replace_all(g(r, "이름"), "").into_owned()).collect();
    let mut bc: HashMap<&str, usize> = HashMap::new();
    for b in &brands {
        *bc.entry(b.as_str()).or_default() += 1;
    }
    for (r, b) in merged.iter().zip(&brands) {
        if bc[b.as_str()] > 1 && FIT_STRONG.is_match(g(r, "이름")) {
            ex.entry(g(r, "카카오ID").into())
                .or_insert(("피트니스 체인".into(), format!("같은 이름 {}곳({})", bc[b.as_str()], g(r, "이름"))));
        }
    }
    if util::exists(FOUND) {
        // 이름 검색으로 이은 곳은 네이버에 올라 있는 이름도 본다
        for r in read(FOUND)? {
            if g(&r, "결과") == "일치" && FIT_STRONG.is_match(g(&r, "네이버이름")) {
                ex.entry(g(&r, "카카오ID").into())
                    .or_insert(("피트니스·스포츠 시설".into(), format!("네이버 이름 기준({})", g(&r, "네이버이름"))));
            }
        }
    }
    for r in rows {
        let items = price_items(g(r, "가격표"));
        let mas = items.iter().filter(|(n, _)| MASSAGE.is_match(n)).count();
        let bath = items.iter().filter(|(n, _)| BATH_ITEM.is_match(n)).count();
        let ses = items.iter().filter(|(n, _)| SESHIN.is_match(n) || SES_EXTRA.is_match(n)).count();
        let kid = g(r, "카카오ID").to_string();
        // 세신은 마사지가 아니다: 세신 항목이 있으면 마사지가 여러 개여도 세신 중심으로 보고 남긴다
        if (mas >= 3 && ses == 0) || (mas > 0 && bath == 0 && items.len() <= 2) {
            ex.entry(kid.clone())
                .or_insert(("마사지 중심".into(), format!("가격표 {}개 중 마사지·테라피 {mas}종, 세신 {ses}종", items.len())));
        }
        if FIT_PRICE.is_match(g(r, "가격표")) {
            ex.entry(kid.clone()).or_insert(("피트니스 시설".into(), "가격표에 트레이너·레슨".into()));
        }
        let hours = g(r, "영업표시");
        if closed_mark(hours) && !hours.contains("에 영업 종료") {
            ex.entry(kid).or_insert(("폐업·휴업".into(), format!("영업 표시: {hours}")));
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
    let rows: Vec<Row> = read(FACTS_CSV)?.into_iter().filter(|r| g(r, "상태") == "ok").collect();
    let rows = pysort::keep_first(rows, |r| g(r, "카카오ID").to_string());
    let merged = read(MERGED)?;
    println!("판정 대상(상태 ok): {}곳 / 합친 목록 {}곳", rows.len(), merged.len());

    let ex = exclusion_reasons(&rows, &merged)?;
    let old = if util::exists(EXCLUDED) { csvio::read_csv(EXCLUDED, true, Dtype::AllStr)? } else { Table::empty(&EX_COLS) };
    let old_rows = old.records();
    let old_ids: HashSet<String> = old_rows.iter().map(|r| csvio::get(r, "카카오ID").to_string()).collect();
    let today = util::today_kst();
    let mut add: Vec<Row> = Vec::new();
    for m in &merged {
        let k = g(m, "카카오ID");
        if let Some((why, basis)) = ex.get(k) {
            if !old_ids.contains(k) {
                let vals = [k, g(m, "이름"), g(m, "주소"), why, basis, &today];
                add.push(EX_COLS.iter().zip(vals).map(|(c, v)| (c.to_string(), v.to_string())).collect());
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
        util::dict_repr(&util::value_counts(allx.iter().map(|r| csvio::get(r, "사유"))))
    );

    let gone: HashSet<&str> = allx.iter().map(|r| csvio::get(r, "카카오ID")).collect();
    let hours = load_hours()?;
    println!("요일별 영업시간이 있는 곳 {}곳", hours.len());
    let reviews = load_reviews()?;
    println!("후기 탭 수집이 있는 곳 {}곳(후기 문장 {}건)", reviews.len(), reviews.values().map(|v| v.len()).sum::<usize>());

    let mut facts = Map::new();
    let mut judged: Vec<Vec<String>> = Vec::new();
    let mut price_rows: Vec<(String, i64, Option<i64>, Option<i64>, String)> = Vec::new();
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
            Some(v) => {
                let s = format!("{} ({why})", if v["paid"] == Value::Bool(true) { "유료" } else { "무료" });
                if v.get("low").is_some() { format!("[낮음] {s}") } else { s }
            }
            None => format!("불명({why})"),
        };
        if let Some(v) = v {
            f.insert("hairdryer".into(), v);
        }
        let (v, why) = judge_towel(&r);
        let n_towel = if v.is_empty() { format!("불명({why})") } else { format!("{} ({why})", dump(&Value::Object(v.clone()))) };
        if !v.is_empty() {
            f.insert("towel".into(), Value::Object(v));
        }
        let sup = judge_supplies(&r);
        let has_shampoo = sup.contains_key("shampoo");
        if !sup.is_empty() {
            f.insert("supplies".into(), Value::Object(sup));
        }
        let fees = judge_fees(&r);
        let n_fees = if fees.is_empty() { String::new() } else { dump(&Value::Object(fees.clone())) };
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
        if let Some((a, w, c)) = judge_prices(&r) {
            price_rows.push((kid.clone(), a, w, c, g(&r, "수집일").to_string()));
        }
        if !f.is_empty() {
            f.insert("checked".into(), Value::from(g(&r, "수집일")));
            f.insert("source".into(), Value::from("네이버 플레이스 수집 자동 판정(근거 신뢰도는 facts_judged.csv)"));
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
    let jcols = ["카카오ID", "이름", "폐업후기", "세신", "드라이기", "수건", "요금세부", "샴푸", "24시간"];
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
                "네이버 플레이스 가격표에 가게가 올린 입장료(자동 판정)".into(),
                "네이버 플레이스 가격표(자동 판정)".into(),
                p.4.clone(),
            ]
        })
        .collect();
    csvio::write_csv(OUT_PRICES, &PRICE_COLS_OUT, &body)?;
    println!("가격표에서 입장료를 뽑은 곳 {}곳 → {OUT_PRICES} (사람이 확인한 onsen_prices.csv에 없는 곳만 서비스에 쓴다)", price_rows.len());
    println!("판정한 곳 {}곳 → 값이 하나라도 나온 곳 {}곳", judged.len(), facts.len());
    for (k, ci) in [("세신", 3), ("드라이기", 4), ("수건", 5)] {
        let unk = judged.iter().filter(|j| j[ci].starts_with("불명")).count();
        println!("  {k}: 값 있음 {}곳 / 불명 {unk}곳", judged.len() - unk);
    }
    Ok(())
}
