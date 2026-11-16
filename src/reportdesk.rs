//! 탕방 제보함(report_desk)의 판단·반영 규칙. 화면 서버는 src/bin/report_desk.rs, 요구사항은 docs/prd-report-triage.md.
//! - 제보를 업체별로 묶고 칩(새 정보·인상 가능성·확인값과 다름·충돌·이미 반영됨·반려 추천·시험)을 붙인다. 칩은 추천일 뿐 상태를 바꾸지 않는다.
//! - 사람이 근거를 확인한 칸만 data/curated/에 적는다. 다른 줄·다른 업체는 글자 하나도 바꾸지 않는다.
//! - 허위·의심 기준 숫자는 data/report_rules.json 한 곳에 있다(입장료 3천 원 미만·4만 원 이상은 허위, 3만 원 이상·확인값의 절반/두 배는 의심).
//!   Worker(postReport)가 받을 때 붙이는 표시(flags)는 화면에 보여 주기만 하고 판단에는 쓰지 않는다.

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

use crate::pyjson;

pub const PRICE_FILE: &str = "data/curated/onsen_prices.csv";
pub const FACTS_FILE: &str = "data/curated/place_facts.json";
pub const ONSEN_FILE: &str = "web/public/data/onsen.json";

/// (제보 칸, 화면 이름, 입력 종류, Worker 이상값 표시)
pub const FIELDS: [(&str, &str, &str, &str); 9] = [
    ("adult", "입장료", "price", "입장료 이상값"),
    ("child", "소인 요금", "price", "소인 이상값"),
    ("towel", "수건 요금", "price", "수건 이상값"),
    ("scrub", "세신 요금", "price", "세신 이상값"),
    ("towel_info", "수건 안내", "towel", ""),
    ("hairdryer", "드라이기", "dryer", ""),
    ("seshin_pay", "세신 결제", "pay", ""),
    ("parking", "주차", "parking", ""),
    ("tips", "알아둘 것", "tips", ""),
];
/// "카운터" = 카운터에서 받는데 장 수는 모름(탕을 고른 제보에서만 온다)
pub const TOWEL_OPTIONS: [&str; 5] = ["무제한", "1장", "2장", "3장 이상", "카운터"];
pub const DRYER_OPTIONS: [&str; 3] = ["무료", "유료", "없음"];
pub const PAY_OPTIONS: [&str; 2] = ["현금만", "카드 가능"];
pub const PARKING_OPTIONS: [&str; 2] = ["가능", "불가"];
/// 가기 전 알아둘 것의 종류(제보 창·Worker와 같은 낱말)
pub const TIP_KINDS: [&str; 5] = ["입구·신발", "층·동선", "붐비는 때", "휴업·재오픈", "기타"];
pub const PARKING_NOTE_MAX: usize = 40;
pub const TIP_MAX: usize = 60;
const TIPS_PER_REPORT: usize = 3;
const MAX_WON: i64 = 200_000;
const NOTE_MAX: usize = 200; // Worker가 검토 메모를 200자까지 받는다

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}
fn num(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    v.as_i64().or_else(|| v.as_f64().map(|f| f.round() as i64))
}
fn at<'a>(v: Option<&'a Value>, path: &[&str]) -> Option<&'a Value> {
    let mut cur = v?;
    for k in path {
        cur = cur.get(k)?;
    }
    if cur.is_null() {
        None
    } else {
        Some(cur)
    }
}

pub fn won(n: i64) -> String {
    let d = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in d.chars().enumerate() {
        if i > 0 && (d.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    format!("{}{out}원", if n < 0 { "-" } else { "" })
}

fn label_of(key: &str) -> &'static str {
    FIELDS.iter().find(|f| f.0 == key).map(|f| f.1).unwrap_or("")
}
fn kind_of(key: &str) -> &'static str {
    FIELDS.iter().find(|f| f.0 == key).map(|f| f.2).unwrap_or("")
}

fn cut(t: &str, max: usize) -> String {
    t.trim().chars().take(max).collect()
}

/// 제보의 '가기 전 알아둘 것'. D1에는 JSON 배열이 글자로 들어 있다. 깨졌거나 없으면(예전 제보) 빈 목록.
/// 종류가 정해진 낱말이 아니면 '기타'로 보고, 글이 빈 것은 버린다. 제보 하나에 3개까지.
pub fn report_tips(r: &Value) -> Vec<Value> {
    let parsed: Option<Value> = match r.get("tips") {
        Some(Value::String(t)) => serde_json::from_str(t).ok(),
        Some(v @ Value::Array(_)) => Some(v.clone()),
        _ => None,
    };
    let mut out: Vec<Value> = Vec::new();
    for item in parsed.as_ref().and_then(|v| v.as_array()).into_iter().flatten() {
        let text = cut(s(item, "text"), TIP_MAX);
        if text.is_empty() || out.iter().any(|o| s(o, "text") == text) {
            continue;
        }
        let kind = TIP_KINDS.iter().find(|k| **k == s(item, "kind")).copied().unwrap_or("기타");
        out.push(json!({ "kind": kind, "text": text }));
        if out.len() == TIPS_PER_REPORT {
            break;
        }
    }
    out
}

/// 제보에 적힌 값. 요금은 숫자, 주차는 { available, note }, 알아둘 것은 [{ kind, text }], 나머지는 글자.
/// 비어 있으면(예전 제보처럼 칸이 아예 없어도) None.
pub fn report_value(r: &Value, key: &str) -> Option<Value> {
    match kind_of(key) {
        "price" => num(r.get(key)).map(Value::from),
        "parking" => {
            let a = PARKING_OPTIONS.iter().find(|o| **o == s(r, "parking")).copied().unwrap_or("");
            let note = cut(s(r, "parking_note"), PARKING_NOTE_MAX);
            (!a.is_empty() || !note.is_empty()).then(|| json!({ "available": a, "note": note }))
        }
        "tips" => {
            let tips = report_tips(r);
            (!tips.is_empty()).then(|| Value::Array(tips))
        }
        _ => {
            let t = s(r, key);
            (!t.is_empty()).then(|| Value::from(t))
        }
    }
}
fn join_dot(parts: &[&str]) -> String {
    parts.iter().filter(|p| !p.is_empty()).copied().collect::<Vec<_>>().join(" · ")
}
fn show(v: &Value) -> String {
    match v {
        Value::Array(a) => a.iter().map(show).collect::<Vec<_>>().join(" / "),
        Value::Object(o) if o.contains_key("text") => format!("[{}] {}", s(v, "kind"), s(v, "text")),
        Value::Object(_) => join_dot(&[s(v, "available"), s(v, "note")]),
        _ => match num(Some(v)) {
            Some(n) if v.is_number() => won(n),
            _ => v.as_str().unwrap_or("").to_string(),
        },
    }
}

/// 지금 화면의 주차 값(facts.convenience.parking) → (가능·불가, 안내 글)
fn parking_now(facts: Option<&Value>) -> (&'static str, String) {
    let p = at(facts, &["convenience", "parking"]);
    let a = match at(p, &["available"]).and_then(|x| x.as_bool()) {
        Some(true) => "가능",
        Some(false) => "불가",
        None => "",
    };
    (a, p.map(|p| s(p, "note").to_string()).unwrap_or_default())
}
/// 지금 화면의 알아둘 것(facts.tips)
fn tips_now(facts: Option<&Value>) -> Vec<Value> {
    at(facts, &["tips"]).and_then(|t| t.as_array()).cloned().unwrap_or_default()
}
fn tip_known(now: &[Value], text: &str) -> bool {
    now.iter().any(|t| s(t, "text").trim() == text.trim())
}

fn towel_one(t: &Value) -> String {
    match (s(t, "mode"), num(t.get("count"))) {
        ("unlimited", _) => "무제한".into(),
        ("limited", Some(n)) if n >= 3 => "3장 이상".into(),
        ("limited", Some(n)) => format!("{n}장"),
        ("limited", None) => "카운터".into(), // 카운터에서 받는데 장 수는 모름(제보 값과 같은 말로)
        _ => String::new(),
    }
}
fn dryer_one(d: &Value) -> String {
    if d.get("none").and_then(|x| x.as_bool()) == Some(true) {
        "없음".into()
    } else {
        match d.get("paid").and_then(|x| x.as_bool()) {
            Some(true) => "유료".into(),
            Some(false) => "무료".into(),
            None if d.get("has").and_then(|x| x.as_bool()) == Some(true) => "있음".into(),
            None => String::new(),
        }
    }
}
fn pay_one(p: &str) -> &'static str {
    match p {
        "cash_only" => "현금만",
        "card_ok" => "카드 가능",
        _ => "",
    }
}
fn sides(women: String, men: String) -> String {
    if !women.is_empty() && women == men {
        return women;
    }
    [("여탕", women), ("남탕", men)]
        .into_iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k} {v}"))
        .collect::<Vec<_>>()
        .join(" · ")
}

pub struct Current {
    pub text: String, // 비어 있으면 지금 값 없음
    pub checked: String,
    pub source: String,
}

/// 지금 화면 값(onsen.json의 price·facts). 문구는 화면과 같은 낱말을 쓴다.
pub fn current(place: Option<&Value>, key: &str) -> Current {
    let price = at(place, &["price"]);
    let facts = at(place, &["facts"]);
    let (text, from) = match key {
        "adult" | "towel" | "child" => (num(at(price, &[key])).map(won).unwrap_or_default(), price),
        "parking" => {
            let (a, note) = parking_now(facts);
            (join_dot(&[a, &note]), facts)
        }
        "tips" => (show(&Value::Array(tips_now(facts))), facts),
        "scrub" => {
            let se = at(facts, &["seshin"]);
            let t = match num(at(se, &["price_full"])) {
                Some(n) => won(n),
                None => sides(
                    num(at(se, &["price_women"])).map(won).unwrap_or_default(),
                    num(at(se, &["price_men"])).map(won).unwrap_or_default(),
                ),
            };
            (t, facts)
        }
        "towel_info" => {
            let t = at(facts, &["towel"]);
            let one = |k: &str| at(t, &[k]).map(towel_one).unwrap_or_default();
            (sides(one("women"), one("men")), facts)
        }
        "hairdryer" => {
            let h = at(facts, &["hairdryer"]);
            let one = |k: &str| at(h, &[k]).map(dryer_one).unwrap_or_default();
            let (w, m) = (one("women"), one("men"));
            let t = if w.is_empty() && m.is_empty() {
                h.map(dryer_one).unwrap_or_default()
            } else {
                sides(w, m)
            };
            (t, facts)
        }
        "seshin_pay" => (
            pay_one(at(facts, &["seshin", "payment"]).and_then(|x| x.as_str()).unwrap_or("")).to_string(),
            facts,
        ),
        _ => (String::new(), None),
    };
    let meta = |k: &str| from.map(|f| s(f, k).to_string()).unwrap_or_default();
    let has = !text.is_empty();
    Current {
        text,
        checked: if has { meta("checked") } else { String::new() },
        source: if has { meta("source") } else { String::new() },
    }
}

#[derive(PartialEq, Clone, Copy, Debug)]
pub enum State {
    New,
    Same,
    Differ,
}

/// 드라이기 제보("여탕 유료 · 남탕 무료" 또는 "유료")를 (탕, 값)으로 나눈다. 탕이 없으면 "".
fn dryer_parts(text: &str) -> Vec<(&'static str, String)> {
    text.split(" · ")
        .filter(|p| !p.is_empty())
        .map(|p| {
            if let Some(v) = p.strip_prefix("여탕 ") {
                ("women", v.to_string())
            } else if let Some(v) = p.strip_prefix("남탕 ") {
                ("men", v.to_string())
            } else {
                ("", p.to_string())
            }
        })
        .collect()
}

fn fold(pairs: Vec<(String, String)>) -> State {
    // (지금 값, 제보 값) 쌍들. 지금 값이 하나도 없으면 새 정보, 하나라도 다르면 다름.
    let known: Vec<&(String, String)> = pairs.iter().filter(|(c, _)| !c.is_empty()).collect();
    if known.is_empty() {
        State::New
    } else if known.iter().any(|(c, r)| c != r) {
        State::Differ
    } else if known.len() == pairs.len() {
        State::Same
    } else {
        State::New
    }
}

/// 제보 값 하나를 지금 화면 값과 비교한다.
pub fn compare(place: Option<&Value>, key: &str, rv: &Value) -> State {
    let facts = at(place, &["facts"]);
    let rs = rv.as_str().unwrap_or("").to_string();
    match key {
        "adult" | "towel" | "child" => match num(at(place, &["price", key])) {
            None => State::New,
            Some(c) if Some(c) == num(Some(rv)) => State::Same,
            Some(_) => State::Differ,
        },
        "parking" => {
            // 제보가 말한 부분(가능 여부·안내 글)만 지금 값과 견준다
            let (a, note) = parking_now(facts);
            let mut pairs = Vec::new();
            if !s(rv, "available").is_empty() {
                pairs.push((a.to_string(), s(rv, "available").to_string()));
            }
            if !s(rv, "note").is_empty() {
                pairs.push((note, s(rv, "note").to_string()));
            }
            fold(pairs)
        }
        "tips" => {
            // 알아둘 것은 쌓이는 정보라 '다름'이 없다. 이미 같은 글이 있으면 같음, 아니면 새 정보
            let now = tips_now(facts);
            let one = [rv.clone()];
            let list = rv.as_array().map(|a| a.as_slice()).unwrap_or(&one);
            if list.iter().all(|t| tip_known(&now, s(t, "text"))) {
                State::Same
            } else {
                State::New
            }
        }
        "scrub" => {
            let se = at(facts, &["seshin"]);
            let vals: Vec<i64> = ["price_full", "price_women", "price_men"]
                .iter()
                .filter_map(|k| num(at(se, &[k])))
                .collect();
            if vals.is_empty() {
                State::New
            } else if vals.iter().all(|v| Some(*v) == num(Some(rv))) {
                State::Same
            } else {
                State::Differ
            }
        }
        "towel_info" => {
            // 제보가 '남탕 2장'처럼 탕을 말하면 그 탕하고만, 탕이 없으면(예전 제보) 값이 있는 두 탕 모두와 견준다
            let t = at(facts, &["towel"]);
            let mut pairs = Vec::new();
            for (k, v) in dryer_parts(&rs) {
                let ks: &[&str] = if k.is_empty() { &["women", "men"] } else if k == "women" { &["women"] } else { &["men"] };
                for side in ks {
                    let c = at(t, &[side]).map(towel_one).unwrap_or_default();
                    if !c.is_empty() || !k.is_empty() {
                        pairs.push((c, v.clone()));
                    }
                }
            }
            fold(pairs)
        }
        "hairdryer" => {
            let h = at(facts, &["hairdryer"]);
            let top = h.map(dryer_one).unwrap_or_default();
            let side = |k: &str| {
                let v = at(h, &[k]).map(dryer_one).unwrap_or_default();
                if v.is_empty() {
                    top.clone()
                } else {
                    v
                }
            };
            let mut pairs = Vec::new();
            for (k, v) in dryer_parts(&rs) {
                if k.is_empty() {
                    let (w, m) = (side("women"), side("men"));
                    if w == m {
                        pairs.push((w, v));
                    } else {
                        pairs.push((w, v.clone()));
                        pairs.push((m, v));
                    }
                } else {
                    pairs.push((side(k), v));
                }
            }
            fold(pairs)
        }
        "seshin_pay" => {
            let c = pay_one(at(facts, &["seshin", "payment"]).and_then(|x| x.as_str()).unwrap_or(""));
            fold(vec![(c.to_string(), rs)])
        }
        _ => State::New,
    }
}

/// 운영자 시험 제보인지.
pub fn is_test(r: &Value) -> bool {
    s(r, "place_id") == "TEST" || s(r, "place_name").contains("시험") || s(r, "memo").contains("시험")
}

/// 허위·의심 기준(data/report_rules.json). 숫자는 그 파일 한 곳에서만 바꾼다.
static RULES: std::sync::LazyLock<Value> =
    std::sync::LazyLock::new(|| serde_json::from_str(include_str!("../data/report_rules.json")).expect("data/report_rules.json"));
fn rule(path: &[&str]) -> i64 {
    num(at(Some(&RULES), path)).unwrap_or(0)
}

#[derive(PartialEq, Debug)]
pub enum Judged {
    Ok,
    Fake(String),    // 허위: 반려 추천
    Suspect(String), // 의심: 사람이 더 조심해서 본다
}

/// 요금 제보 하나를 기준에 댄다. now_adult는 지금 확인된 대인 요금(있을 때만 절반·두 배를 본다).
/// 소인 요금은 범위 밖이면 이상값(허위 기준), 범위 안이어도 대인 요금보다 비싸면 의심.
pub fn judge(key: &str, v: i64, now_adult: Option<i64>) -> Judged {
    match key {
        "adult" => {
            let (min, sus, max) = (rule(&["adult", "min"]), rule(&["adult", "suspect_from"]), rule(&["adult", "max_exclusive"]));
            if v < min {
                return Judged::Fake(format!("입장료 {} 미만", won(min)));
            }
            if v >= max {
                return Judged::Fake(format!("입장료 {} 이상(동네 목욕탕 범위 밖)", won(max)));
            }
            if v >= sus {
                return Judged::Suspect(format!("입장료 {} 이상(호텔 사우나인지 확인)", won(sus)));
            }
            if let Some(c) = now_adult.filter(|c| *c > 0) {
                let (lo, hi) = (RULES["ratio"]["low"].as_f64().unwrap_or(0.5), RULES["ratio"]["high"].as_f64().unwrap_or(2.0));
                if (v as f64) <= c as f64 * lo {
                    return Judged::Suspect("지금 확인값의 절반 이하".into());
                }
                if (v as f64) >= c as f64 * hi {
                    return Judged::Suspect("지금 확인값의 두 배 이상".into());
                }
            }
            Judged::Ok
        }
        "towel" | "scrub" => {
            let (min, max) = (rule(&[key, "min"]), rule(&[key, "max"]));
            if v < min {
                Judged::Fake(format!("{} {} 미만", label_of(key), won(min)))
            } else if v > max {
                Judged::Fake(format!("{} {} 초과", label_of(key), won(max)))
            } else {
                Judged::Ok
            }
        }
        "child" => {
            let (min, max) = (rule(&["child", "min"]), rule(&["child", "max"]));
            if v < min {
                Judged::Fake(format!("소인 요금 {} 미만", won(min)))
            } else if v > max {
                Judged::Fake(format!("소인 요금 {} 초과", won(max)))
            } else if now_adult.is_some_and(|a| a > 0 && v > a) {
                Judged::Suspect("소인 요금이 대인 요금보다 비쌈".into())
            } else {
                Judged::Ok
            }
        }
        _ => Judged::Ok,
    }
}
fn fake_reason(r: &Value, key: &str) -> Option<String> {
    match judge(key, num(r.get(key))?, None) {
        Judged::Fake(why) => Some(why),
        _ => None,
    }
}
fn is_outlier(r: &Value, key: &str) -> bool {
    kind_of(key) == "price" && fake_reason(r, key).is_some()
}
/// 값이 전부 이상값뿐인 제보(범위 안 요금도, 가기 전 정보도 없음).
fn outlier_only(r: &Value) -> bool {
    let present: Vec<&str> = FIELDS.iter().map(|f| f.0).filter(|k| report_value(r, k).is_some()).collect();
    !present.is_empty() && present.iter().all(|k| is_outlier(r, k))
}

/// 제보 시각(UTC) → 한국 시각 "YYYY-MM-DD HH:MM". 읽지 못하면 앞 16글자.
pub fn kst(created_at: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(created_at) {
        Ok(t) => t
            .with_timezone(&chrono::FixedOffset::east_opt(9 * 3600).unwrap())
            .format("%Y-%m-%d %H:%M")
            .to_string(),
        Err(_) => created_at.chars().take(16).collect(),
    }
}

/// 업체ID가 줄 번호(m123)면 curated의 열쇠로 쓸 수 없다.
pub fn can_key(place_id: &str) -> bool {
    !(place_id.starts_with('m') && place_id.len() > 1 && place_id[1..].chars().all(|c| c.is_ascii_digit()))
}

pub const CHIPS: [&str; 7] = ["새 정보", "인상 가능성", "확인값과 다름", "충돌", "이미 반영됨", "반려 추천", "시험"];

/// 새 제보를 업체별로 묶고 칩·볼 순서를 붙인다. places는 onsen.json의 업체(id → 업체).
pub fn triage(reports: &[Value], places: &HashMap<String, Value>) -> Vec<Value> {
    let mut order: Vec<(bool, String)> = Vec::new();
    let mut by: HashMap<(bool, String), Vec<&Value>> = HashMap::new();
    for r in reports {
        let k = (is_test(r), s(r, "place_id").to_string());
        if !by.contains_key(&k) {
            order.push(k.clone());
        }
        by.entry(k).or_default().push(r);
    }
    let mut groups: Vec<Value> = order
        .into_iter()
        .map(|k| {
            let rs = &by[&k];
            group(k.0, &k.1, rs, places.get(&k.1))
        })
        .collect();
    groups.sort_by_key(|g| {
        (
            g["rank"].as_i64().unwrap_or(9),
            -g["report_ids"].as_array().and_then(|a| a.iter().filter_map(|x| x.as_i64()).max()).unwrap_or(0),
        )
    });
    groups
}

fn group(test: bool, place_id: &str, rs: &[&Value], place: Option<&Value>) -> Value {
    let live: Vec<&Value> = rs.iter().copied().filter(|r| !outlier_only(r)).collect();
    let mut fields = Vec::new();
    let (mut any_new, mut any_differ, mut conflict, mut raise) = (false, false, false, false);
    let (mut fake_why, mut warn) = (String::new(), String::new());
    let now_tips = tips_now(at(place, &["facts"]));
    // 소인 요금과 견줄 대인 요금: 지금 확인값이 먼저, 없으면 같은 묶음 제보의 (허위가 아닌) 입장료
    let rep_adult = rs.iter().filter(|r| !is_outlier(r, "adult")).filter_map(|r| num(r.get("adult"))).max();
    for (key, label, kind, _) in FIELDS {
        // 같은 값끼리 묶는다(값 → 제보 번호들). 알아둘 것은 한 제보에 여러 개라 하나씩 따로 묶는다
        let mut vals: Vec<(Value, Vec<i64>, bool, String)> = Vec::new();
        for r in rs {
            let Some(v) = report_value(r, key) else { continue };
            let out = is_outlier(r, key);
            let id = num(r.get("id")).unwrap_or(0);
            let each = match v {
                Value::Array(a) if kind == "tips" => a,
                v => vec![v],
            };
            for v in each {
                match vals.iter_mut().find(|x| x.0 == v) {
                    Some(x) => {
                        x.1.push(id);
                        x.3 = x.3.clone().max(kst(s(r, "created_at")));
                    }
                    None => vals.push((v, vec![id], out, kst(s(r, "created_at")))),
                }
            }
        }
        if vals.is_empty() {
            continue;
        }
        let cur = current(place, key);
        let now_adult = num(at(place, &["price", "adult"]));
        let ref_adult = if key == "child" { now_adult.or(rep_adult) } else { now_adult };
        let mark = |v: &Value| match (kind == "price").then(|| judge(key, num(Some(v)).unwrap_or(0), ref_adult)) {
            Some(Judged::Fake(w)) => ("fake", w),
            Some(Judged::Suspect(w)) => ("suspect", w),
            _ => ("", String::new()),
        };
        for v in &vals {
            match mark(&v.0) {
                ("fake", w) if fake_why.is_empty() => fake_why = w,
                ("suspect", w) if warn.is_empty() => warn = w,
                _ => {}
            }
        }
        let good: Vec<&(Value, Vec<i64>, bool, String)> = vals.iter().filter(|v| !v.2).collect();
        let state = if good.is_empty() {
            "outlier"
        } else if kind == "tips" {
            // 서로 다른 알아둘 것은 충돌이 아니다. 아직 화면에 없는 글이 하나라도 있으면 새 정보
            if good.iter().all(|v| tip_known(&now_tips, s(&v.0, "text"))) {
                "same"
            } else {
                any_new = true;
                "new"
            }
        } else if good.len() > 1 {
            conflict = true;
            "conflict"
        } else {
            match compare(place, key, &good[0].0) {
                State::New => {
                    any_new = true;
                    "new"
                }
                State::Same => "same",
                State::Differ => {
                    any_differ = true;
                    if key == "adult" {
                        let now = num(at(place, &["price", "adult"])).unwrap_or(0);
                        let day: String = good[0].3.chars().take(10).collect();
                        if num(Some(&good[0].0)).unwrap_or(0) > now && !cur.checked.is_empty() && day > cur.checked {
                            raise = true;
                        }
                    }
                    "differ"
                }
            }
        };
        fields.push(json!({
            "key": key, "label": label, "kind": kind, "state": state,
            "current": { "text": cur.text, "checked": cur.checked, "source": cur.source, "tips": if kind == "tips" { json!(now_tips) } else { Value::Null } },
            "reported": vals.iter().map(|v| { let m = mark(&v.0); json!({ "value": v.0, "text": show(&v.0), "ids": v.1, "outlier": v.2, "mark": m.0, "why": m.1,
                "known": kind == "tips" && tip_known(&now_tips, s(&v.0, "text")) }) }).collect::<Vec<_>>(),
        }));
    }
    let fake_text = format!("허위 기준: {fake_why}");
    let (chip, reason) = if test {
        ("시험", "운영자 시험 제보")
    } else if place.is_none() {
        ("반려 추천", "지금 서비스 목록에 없는 업체")
    } else if live.is_empty() {
        ("반려 추천", fake_text.as_str())
    } else if conflict {
        ("충돌", "같은 칸에 서로 다른 값")
    } else if raise {
        ("인상 가능성", "확인일 뒤에 들어온 더 높은 입장료")
    } else if any_differ {
        ("확인값과 다름", "지금 값과 다른 제보")
    } else if any_new {
        ("새 정보", "지금 값이 없는 칸")
    } else {
        ("이미 반영됨", "제보 값이 지금 값과 같음")
    };
    let first = rs[0];
    json!({
        "key": format!("{}{}", if test { "test:" } else { "" }, place_id),
        "place_id": place_id,
        "place_name": place.map(|p| s(p, "name")).filter(|n| !n.is_empty()).unwrap_or(s(first, "place_name")),
        "addr": place.map(|p| s(p, "addr")).unwrap_or(""),
        "kakao_url": place.map(|p| s(p, "url")).unwrap_or(""),
        "in_service": place.is_some(),
        "can_apply": place.is_some() && !test && can_key(place_id),
        "chip": chip, "reason": reason, "warn": warn,
        "rank": CHIPS.iter().position(|c| *c == chip).unwrap_or(9) + 1,
        "report_ids": rs.iter().map(|r| num(r.get("id")).unwrap_or(0)).collect::<Vec<_>>(),
        "fields": fields,
        "reports": rs.iter().map(|r| json!({
            "id": num(r.get("id")).unwrap_or(0),
            "at": kst(s(r, "created_at")),
            "source": s(r, "source"), "memo": s(r, "memo"), "flags": s(r, "flags"),
            "values": FIELDS.iter().filter_map(|f| report_value(r, f.0).map(|v| format!("{} {}", f.1, show(&v)))).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    })
}

// ───────── 근거(사람이 확인한 값) ─────────

/// 화면에서 온 근거 값을 검사한다. 요금은 0~20만 원 정수, 고르는 칸은 정해진 낱말만.
pub fn check_evidence(ev: &Map<String, Value>) -> Result<()> {
    if ev.is_empty() {
        bail!("근거를 확인한 칸이 없어요. 확인한 칸에 '확인함'을 켜 주세요");
    }
    for (k, v) in ev {
        let label = label_of(k);
        let pick = |list: &[&str], x: &str| x.is_empty() || list.contains(&x);
        match kind_of(k) {
            "price" => match v.as_i64() {
                Some(n) if (0..=MAX_WON).contains(&n) => {}
                _ => bail!("{label}: 0~200,000 사이 숫자로 적어 주세요"),
            },
            "pay" => {
                if !PAY_OPTIONS.contains(&v.as_str().unwrap_or("")) {
                    bail!("{label}: 현금만·카드 가능 중에서 골라 주세요")
                }
            }
            "parking" => {
                let (a, note) = (s(v, "available"), s(v, "note").trim());
                if !v.is_object() || !pick(&PARKING_OPTIONS, a) || (a.is_empty() && note.is_empty()) {
                    bail!("{label}: 가능·불가를 고르거나 안내 글을 적어 주세요")
                }
                if note.chars().count() > PARKING_NOTE_MAX {
                    bail!("{label}: 안내 글은 {PARKING_NOTE_MAX}자까지 적을 수 있어요")
                }
            }
            "tips" => {
                let list = v.as_array().filter(|a| !a.is_empty()).ok_or_else(|| anyhow!("{label}: 넣을 글 또는 버릴 글을 골라 주세요"))?;
                for t in list {
                    let Some(ok) = t.get("ok").and_then(|x| x.as_bool()) else { bail!("{label}: 글마다 맞음·버림을 골라 주세요") };
                    if s(t, "of").is_empty() {
                        bail!("{label}: 어느 제보 글인지 알 수 없어요. 새로고침한 뒤 다시 해 주세요")
                    }
                    if !ok {
                        continue;
                    }
                    let n = s(t, "text").trim().chars().count();
                    if n == 0 || n > TIP_MAX {
                        bail!("{label}: 글은 1~{TIP_MAX}자로 적어 주세요")
                    }
                    if !TIP_KINDS.contains(&s(t, "kind")) {
                        bail!("{label}: 종류를 골라 주세요")
                    }
                }
            }
            kind @ ("towel" | "dryer") => {
                let (w, m) = (s(v, "women"), s(v, "men"));
                let list: &[&str] = if kind == "towel" { &TOWEL_OPTIONS } else { &DRYER_OPTIONS };
                if (w.is_empty() && m.is_empty()) || !pick(list, w) || !pick(list, m) {
                    bail!("{label}: 여탕·남탕 중 확인한 쪽을 골라 주세요")
                }
            }
            _ => bail!("모르는 칸이에요: {k}"),
        }
    }
    Ok(())
}

fn ev_text(key: &str, v: &Value) -> String {
    match kind_of(key) {
        "price" => won(v.as_i64().unwrap_or(0)),
        "pay" => v.as_str().unwrap_or("").to_string(),
        "parking" => join_dot(&[s(v, "available"), s(v, "note").trim()]),
        "tips" => format!("{}개", v.as_array().map(|a| a.iter().filter(|t| t["ok"].as_bool() == Some(true)).count()).unwrap_or(0)),
        _ => sides(s(v, "women").to_string(), s(v, "men").to_string()),
    }
}

/// 제보 값이 근거와 같은지. 근거가 그 제보를 판단해 주지 못하면 None.
fn matches(key: &str, rv: &Value, ev: &Value) -> Option<bool> {
    match kind_of(key) {
        "price" => Some(num(Some(rv)) == ev.as_i64()),
        "pay" => Some(rv.as_str() == ev.as_str()),
        "parking" => {
            // 가능 여부는 둘 다 적혔을 때만 견준다. 안내 글은 운영자가 다듬어 적을 수 있어 글자까지 같지 않아도 된다
            let mut seen = Vec::new();
            let (ra, ea) = (s(rv, "available"), s(ev, "available"));
            if !ra.is_empty() && !ea.is_empty() {
                seen.push(ra == ea);
            }
            if !s(rv, "note").is_empty() && !s(ev, "note").trim().is_empty() {
                seen.push(true);
            }
            if seen.is_empty() {
                None
            } else {
                Some(seen.iter().all(|x| *x))
            }
        }
        "towel" => {
            let mut seen = Vec::new();
            for (k, v) in dryer_parts(rv.as_str().unwrap_or("")) {
                let ks: &[&str] = if k.is_empty() { &["women", "men"] } else if k == "women" { &["women"] } else { &["men"] };
                for side in ks {
                    let e = s(ev, side);
                    if !e.is_empty() {
                        seen.push(e == v);
                    }
                }
            }
            Some(seen.iter().all(|x| *x))
        }
        "dryer" => {
            let mut seen = Vec::new();
            for (k, v) in dryer_parts(rv.as_str().unwrap_or("")) {
                let ks: &[&str] = if k.is_empty() { &["women", "men"] } else if k == "women" { &["women"] } else { &["men"] };
                for side in ks {
                    let e = s(ev, side);
                    if !e.is_empty() {
                        seen.push(e == v);
                    }
                }
            }
            if seen.is_empty() {
                None
            } else {
                Some(seen.iter().all(|x| *x))
            }
        }
        _ => None,
    }
}

/// 제보 하나의 알아둘 것 가운데 운영자가 (넣기로 한 수, 버린 수). 근거의 `of`는 제보에 적힌 원래 글.
fn tip_counts(rv: &Value, ev: Option<&Value>) -> (usize, usize) {
    let (mut ok, mut drop) = (0, 0);
    for t in rv.as_array().into_iter().flatten() {
        let hit = ev.and_then(|e| e.as_array()).and_then(|a| a.iter().find(|e| s(e, "of") == s(t, "text")));
        match hit.and_then(|e| e.get("ok")).and_then(|x| x.as_bool()) {
            Some(true) => ok += 1,
            Some(false) => drop += 1,
            None => {}
        }
    }
    (ok, drop)
}

fn clip(note: String) -> String {
    note.chars().take(NOTE_MAX).collect()
}

/// 제보 하나의 새 상태와 검토 메모.
#[derive(Debug, PartialEq)]
pub struct Action {
    pub id: i64,
    pub status: &'static str,
    pub note: String,
}

/// 반영 판정: 근거와 같은 제보는 applied, 근거와 다른 제보는 rejected, 근거가 판단해 주지 못한 제보는 reviewed.
pub fn plan_apply(reports: &[Value], ev: &Map<String, Value>, source: &str, today: &str) -> Vec<Action> {
    reports
        .iter()
        .map(|r| {
            let (mut ok, mut bad, mut unknown) = (Vec::new(), Vec::new(), Vec::new());
            for f in FIELDS {
                let Some(rv) = report_value(r, f.0) else { continue };
                if f.0 == "tips" {
                    // 알아둘 것은 하나씩 고른다: 하나라도 넣으면 반영, 전부 버렸으면 다름, 안 고른 글뿐이면 못 봄
                    match tip_counts(&rv, ev.get("tips")) {
                        (0, 0) => unknown.push(f.1),
                        (0, _) => bad.push(format!("{} 버림", f.1)),
                        (n, _) => ok.push(format!("{} {n}개", f.1)),
                    }
                    continue;
                }
                match ev.get(f.0).and_then(|e| matches(f.0, &rv, e).map(|m| (m, e))) {
                    Some((true, e)) => ok.push(format!("{} {}", f.1, ev_text(f.0, e))),
                    Some((false, e)) => bad.push(format!("{} 근거 {}", f.1, ev_text(f.0, e))),
                    None => unknown.push(f.1),
                }
            }
            let id = num(r.get("id")).unwrap_or(0);
            let (status, note) = if !bad.is_empty() {
                ("rejected", format!("근거와 다름: {} ({source}, {today})", bad.join(", ")))
            } else if !ok.is_empty() {
                let rest = if unknown.is_empty() { String::new() } else { format!(" · 확인 못 한 칸: {}", unknown.join(", ")) };
                ("applied", format!("반영: {} ({source}, {today}){rest}", ok.join(", ")))
            } else {
                ("reviewed", format!("확인 못 함: 이 제보의 칸은 근거를 찾지 못함 ({today})"))
            };
            Action { id, status, note: clip(note) }
        })
        .collect()
}

pub fn plan_reject(reports: &[Value], reason: &str, today: &str) -> Vec<Action> {
    let note = clip(format!("반려: {reason} ({today})"));
    reports.iter().map(|r| Action { id: num(r.get("id")).unwrap_or(0), status: "rejected", note: note.clone() }).collect()
}

pub fn plan_unknown(reports: &[Value], memo: &str, today: &str) -> Vec<Action> {
    let memo = if memo.trim().is_empty() { "근거를 찾지 못함" } else { memo.trim() };
    let note = clip(format!("확인 못 함: {memo} ({today})"));
    reports.iter().map(|r| Action { id: num(r.get("id")).unwrap_or(0), status: "reviewed", note: note.clone() }).collect()
}

// ───────── curated 반영 ─────────

fn quote(field: &str) -> String {
    if field.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// onsen_prices.csv 글자에서 해당 업체 줄만 바꾸거나 새 줄을 더한다. 다른 줄은 그대로 둔다.
/// 돌려주는 값: (새 파일 글자, 무엇을 했는지 한 줄).
pub fn update_prices_text(
    text: &str,
    key: &str,
    adult: Option<i64>,
    towel: Option<i64>,
    child: Option<i64>,
    source: &str,
    today: &str,
) -> Result<(String, String)> {
    if adult.is_none() && towel.is_none() && child.is_none() {
        bail!("바꿀 요금이 없어요");
    }
    let (bom, body) = match text.strip_prefix('\u{feff}') {
        Some(b) => ("\u{feff}", b),
        None => ("", text),
    };
    let eol = if body.contains("\r\n") { "\r\n" } else { "\n" };
    // 줄을 직접 나눈다(따옴표 안의 줄바꿈은 같은 줄). 각 줄의 시작·끝 위치를 알아야 그 줄만 바꿀 수 있다.
    let mut recs: Vec<(usize, usize, Vec<String>)> = Vec::new(); // (시작, 줄 끝 글자까지 포함한 끝, 칸들)
    let (mut start, mut in_quote) = (0, false);
    let bytes = body.as_bytes();
    for i in 0..=bytes.len() {
        let at_end = i == bytes.len();
        if !at_end && bytes[i] == b'"' {
            in_quote = !in_quote;
        }
        if at_end || (bytes[i] == b'\n' && !in_quote) {
            let end = if at_end { i } else { i + 1 };
            let raw = body[start..end].trim_end_matches(['\r', '\n']);
            if !raw.is_empty() {
                let mut rdr = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_reader(raw.as_bytes());
                let rec = rdr.records().next().transpose().map_err(|e| anyhow!("⛔ {PRICE_FILE}을(를) 읽지 못했어요: {e}"))?;
                if let Some(rec) = rec {
                    recs.push((start, end, rec.iter().map(String::from).collect()));
                }
            }
            start = end;
        }
    }
    let cols = recs.first().map(|r| r.2.clone()).ok_or_else(|| anyhow!("⛔ {PRICE_FILE}이(가) 비어 있어요"))?;
    let ci = |c: &str| cols.iter().position(|x| x == c).ok_or_else(|| anyhow!("⛔ 칸 '{c}'이(가) 없어요 (있는 칸: {})", cols.join(", ")));
    let (c_id, c_adult, c_towel, c_memo, c_src, c_day) =
        (ci("카카오ID")?, ci("성인_평일")?, ci("수건")?, ci("메모")?, ci("출처")?, ci("확인일")?);
    let c_child = if child.is_some() { ci("어린이")? } else { 0 };
    let hit = recs.iter().enumerate().skip(1).find(|(_, r)| r.2.get(c_id).map(|x| x.as_str()) == Some(key)).map(|(i, _)| i);
    let mut row = match hit {
        Some(i) => recs[i].2.clone(),
        None => vec![String::new(); cols.len()],
    };
    row.resize(cols.len(), String::new());
    row[c_id] = key.to_string();
    let mut parts = Vec::new();
    let adult_changed = adult.is_some_and(|a| row[c_adult] != a.to_string());
    if let Some(a) = adult {
        parts.push(if row[c_adult].is_empty() || !adult_changed { format!("대인 {}", won(a)) } else { format!("대인 {}원→{}", row[c_adult], won(a)) });
        row[c_adult] = a.to_string();
    }
    if let Some(c) = child {
        parts.push(if row[c_child].is_empty() || row[c_child] == c.to_string() { format!("소인 {}", won(c)) } else { format!("소인 {}원→{}", row[c_child], won(c)) });
        row[c_child] = c.to_string();
    }
    if let Some(t) = towel {
        parts.push(format!("수건 {}", won(t)));
        row[c_towel] = t.to_string();
    }
    let what = format!("{today} 제보함: {} ({source})", parts.join(", "));
    row[c_memo] = if row[c_memo].is_empty() { what.clone() } else { format!("{} | {what}", row[c_memo]) };
    // 입장료가 바뀌면 그 값의 근거는 새 출처다. 아니면 예전 출처 뒤에 덧붙인다.
    row[c_src] = if row[c_src].is_empty() || adult_changed {
        source.to_string()
    } else if row[c_src].contains(source) {
        row[c_src].clone()
    } else {
        format!("{} / {source}", row[c_src])
    };
    row[c_day] = today.to_string();
    let line = row.iter().map(|f| quote(f)).collect::<Vec<_>>().join(",");
    let out = match hit {
        Some(i) => {
            let (start, end) = (recs[i].0, recs[i].1);
            let seg = &body[start..end];
            let tail = &seg[seg.trim_end_matches(['\r', '\n']).len()..]; // 줄 끝 글자는 그대로
            format!("{}{line}{tail}{}", &body[..start], &body[end..])
        }
        None => {
            let sep = if body.is_empty() || body.ends_with('\n') { "" } else { eol };
            format!("{body}{sep}{line}{eol}")
        }
    };
    Ok((format!("{bom}{out}"), format!("{} {key}: {}", if hit.is_some() { "줄 고침" } else { "새 줄" }, parts.join(", "))))
}

fn obj_mut<'a>(v: &'a mut Value, k: &str) -> Result<&'a mut Map<String, Value>> {
    let m = v.as_object_mut().ok_or_else(|| anyhow!("⛔ {FACTS_FILE} 모양이 예상과 달라요"))?;
    m.entry(k.to_string()).or_insert_with(|| json!({})).as_object_mut().ok_or_else(|| anyhow!("⛔ {FACTS_FILE}의 '{k}' 모양이 예상과 달라요"))
}

/// place_facts.json(읽어 들인 값)에서 해당 업체의 확인 정보만 바꾼다. 바꾼 내용을 돌려준다.
pub fn update_facts(root: &mut Value, key: &str, ev: &Map<String, Value>, source: &str, today: &str) -> Result<Vec<String>> {
    let places = root.get_mut("places").ok_or_else(|| anyhow!("⛔ {FACTS_FILE}에 places가 없어요"))?;
    let mut done = Vec::new();
    let mut entry = match places.get(key) {
        Some(v) if v.is_object() => v.clone(),
        Some(_) => bail!("⛔ {FACTS_FILE}의 '{key}' 모양이 예상과 달라요"),
        None => json!({}),
    };
    for (k, v) in ev {
        match k.as_str() {
            "scrub" => {
                let se = obj_mut(&mut entry, "seshin")?;
                if se.contains_key("price_men") || se.contains_key("price_women") {
                    bail!("세신 요금이 남녀 따로 적힌 곳이에요. {FACTS_FILE}을 직접 고쳐 주세요");
                }
                se.insert("price_full".into(), v.clone());
            }
            "seshin_pay" => {
                let code = if v.as_str() == Some("현금만") { "cash_only" } else { "card_ok" };
                obj_mut(&mut entry, "seshin")?.insert("payment".into(), Value::from(code));
            }
            "towel_info" | "hairdryer" => {
                let name = if k == "towel_info" { "towel" } else { "hairdryer" };
                for side in ["women", "men"] {
                    let val = match (name, s(v, side)) {
                        (_, "") => continue,
                        ("towel", "무제한") => json!({ "mode": "unlimited" }),
                        ("towel", "카운터") => json!({ "mode": "limited" }), // 장 수를 모르면 count를 적지 않는다
                        ("towel", n) => json!({ "mode": "limited", "count": n.chars().next().and_then(|c| c.to_digit(10)).unwrap_or(1) }),
                        (_, "없음") => json!({ "none": true }),
                        (_, p) => json!({ "paid": p == "유료" }),
                    };
                    obj_mut(&mut entry, name)?.insert(side.into(), val);
                }
            }
            "parking" => {
                // convenience의 다른 키(영업시간 등)는 그대로 둔다
                let conv = obj_mut(&mut entry, "convenience")?;
                let (a, note) = (s(v, "available"), s(v, "note").trim());
                let mut p = Map::new();
                if a.is_empty() {
                    // 안내 글만 확인했으면 이미 적힌 가능 여부는 건드리지 않는다
                    if let Some(old) = conv.get("parking").and_then(|x| x.get("available")).filter(|x| x.is_boolean()) {
                        p.insert("available".into(), old.clone());
                    }
                } else {
                    p.insert("available".into(), Value::from(a == "가능"));
                }
                if !note.is_empty() {
                    p.insert("note".into(), Value::from(note));
                }
                conv.insert("parking".into(), Value::Object(p));
            }
            "tips" => {
                // 기존 글은 지우지 않고, 같은 글은 다시 넣지 않는다
                let old: Vec<Value> = match entry.get("tips") {
                    None => Vec::new(),
                    Some(Value::Array(a)) => a.clone(),
                    Some(_) => bail!("⛔ {FACTS_FILE}의 '{key}' tips 모양이 예상과 달라요"),
                };
                let mut list = old.clone();
                for t in v.as_array().into_iter().flatten().filter(|t| t["ok"].as_bool() == Some(true)) {
                    let text = s(t, "text").trim();
                    if !text.is_empty() && !tip_known(&list, text) {
                        list.push(json!({ "kind": s(t, "kind"), "text": text, "date": today }));
                    }
                }
                let added = list.len() - old.len();
                if added > 0 {
                    entry.as_object_mut().unwrap().insert("tips".into(), Value::Array(list));
                    done.push(format!("{} {added}개", label_of(k)));
                }
                continue;
            }
            _ => continue, // 입장료·소인·수건 요금은 onsen_prices.csv
        }
        done.push(format!("{} {}", label_of(k), ev_text(k, v)));
    }
    if done.is_empty() {
        return Ok(done);
    }
    let e = entry.as_object_mut().unwrap();
    let old = e.get("source").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let src = if old.is_empty() || old.contains(source) { if old.is_empty() { source.to_string() } else { old } } else { format!("{old} / {source}") };
    e.insert("checked".into(), Value::from(today));
    e.insert("source".into(), Value::from(src));
    places
        .as_object_mut()
        .ok_or_else(|| anyhow!("⛔ {FACTS_FILE}의 places 모양이 예상과 달라요"))?
        .insert(key.to_string(), entry);
    Ok(done)
}

/// place_facts.json을 읽는다. 다시 썼을 때 글자가 같지 않으면(손으로 고친 모양) 쓰지 않도록 알려 준다.
pub fn load_facts_text(text: &str) -> Result<(Value, bool)> {
    let root = pyjson::loads(text)?;
    let nl = text.ends_with('\n');
    if facts_text(&root, nl) != text {
        bail!("⛔ {FACTS_FILE}의 모양(들여쓰기·줄 끝)이 프로그램이 쓰는 모양과 달라요. 다른 부분이 바뀔 수 있어 자동으로 쓰지 않았어요");
    }
    Ok((root, nl))
}
pub fn facts_text(root: &Value, newline: bool) -> String {
    format!("{}{}", pyjson::dumps(root, &pyjson::INDENT1), if newline { "\n" } else { "" })
}

/// '한 번에 정리': 사람이 볼 필요가 없는 묶음(시험·반려 추천·이미 반영됨)의 제보를 한꺼번에 처리하는 계획.
pub fn plan_sweep(groups: &[Value], today: &str) -> Vec<Action> {
    let mut out = Vec::new();
    for g in groups {
        let (status, note) = match s(g, "chip") {
            "시험" => ("rejected", format!("반려: 시험·장난 제보 ({today})")),
            "반려 추천" => ("rejected", format!("반려: {} ({today})", s(g, "reason"))),
            "이미 반영됨" => ("reviewed", format!("지금 값과 같음: 반영할 것 없음 ({today})")),
            _ => continue,
        };
        for id in g["report_ids"].as_array().into_iter().flatten().filter_map(|x| x.as_i64()) {
            out.push(Action { id, status, note: clip(note.clone()) });
        }
    }
    out
}

pub const HOME_FACTS_FILE: &str = "data/collected/naver_home_facts.csv";

/// 이미 수집해 둔 네이버 근거(naver_home_facts.csv 한 줄)를 제보 칸별로 나눈다. 문장은 ‖로 이어져 있다.
pub fn evidence(row: &HashMap<String, String>) -> Value {
    let cut = |c: &str, n: usize, max: usize| -> Vec<String> {
        row.get(c)
            .map(|t| t.split('‖').map(|x| x.trim()).filter(|x| !x.is_empty()).take(n).map(|x| x.chars().take(max).collect()).collect())
            .unwrap_or_default()
    };
    // 가격표는 자르지 않는다(220자에서 자르면 항목이 많은 곳은 뒤쪽 요금이 안 보인다). 후기 문장만 220자로 줄인다.
    let (price, towel, seshin, dryer) = (cut("가격표", 1, usize::MAX), cut("수건근거", 3, 220), cut("세신근거", 3, 220), cut("드라이기근거", 3, 220));
    json!({
        "naver_id": row.get("네이버ID").cloned().unwrap_or_default(),
        "collected": row.get("수집일").cloned().unwrap_or_default(),
        "by": { "adult": price, "child": price, "towel": towel, "scrub": seshin, "towel_info": towel, "hairdryer": dryer, "seshin_pay": seshin },
    })
}

/// 예시 모드용 가짜 제보. 실제 업체 이름 위에 꾸민 값을 얹어 칩 7종이 모두 보이게 한다.
pub fn demo_reports(places: &[Value], now_utc: &str) -> Vec<Value> {
    let adult = |p: &Value| num(at(Some(p), &["price", "adult"]));
    let bare: Vec<&Value> = places.iter().filter(|p| adult(p).is_none() && at(Some(p), &["facts", "towel"]).is_none()).collect();
    let priced: Vec<&Value> = places.iter().filter(|p| adult(p).is_some_and(|a| (5000..=20000).contains(&a))).collect();
    let mut out = Vec::new();
    let mut add = |p: Option<&Value>, id: &str, name: &str, vals: Value, source: &str, memo: &str, flags: &str| {
        let mut r = json!({
            "id": 900 + out.len(), "created_at": now_utc,
            "place_id": p.map(|p| s(p, "id")).unwrap_or(id), "place_name": p.map(|p| s(p, "name")).unwrap_or(name),
            "adult": null, "towel": null, "scrub": null, "source": source, "memo": memo,
            "towel_info": "", "hairdryer": "", "seshin_pay": "", "flags": flags, "status": "new", "note": null,
            "child": null, "parking": "", "parking_note": "", "tips": "",
        });
        for (k, v) in vals.as_object().unwrap() {
            r[k] = v.clone();
        }
        out.push(r);
    };
    if let Some(p) = bare.first() {
        add(Some(*p), "", "", json!({ "adult": 9000, "towel_info": "2장" }), "현장 가격표", "카운터 가격표 봤어요", "");
    }
    if let Some(p) = bare.get(1) {
        add(Some(*p), "", "", json!({ "hairdryer": "여탕 유료 · 남탕 무료", "seshin_pay": "현금만" }), "직접 냈어요", "", "");
    }
    if let Some(p) = priced.first() {
        let a = adult(p).unwrap_or(0);
        add(Some(*p), "", "", json!({ "adult": a + 1000 }), "현장 가격표", "11월부터 올랐어요", "");
        add(Some(*p), "", "", json!({ "adult": a + 1000 }), "직접 냈어요", "", "");
    }
    if let Some(p) = priced.get(1) {
        add(Some(*p), "", "", json!({ "adult": adult(p).unwrap_or(0) - 1000 }), "기타", "", "");
    }
    if let Some(p) = bare.get(2) {
        add(Some(*p), "", "", json!({ "adult": 8000 }), "직접 냈어요", "", "");
        add(Some(*p), "", "", json!({ "adult": 9000 }), "현장 가격표", "", "");
    }
    if let Some(p) = priced.get(2) {
        add(Some(*p), "", "", json!({ "adult": adult(p).unwrap_or(0) }), "공식 홈페이지·네이버", "", "");
    }
    if let Some(p) = bare.get(3) {
        add(Some(*p), "", "", json!({ "adult": 150000 }), "기타", "", "입장료 이상값");
    }
    // 새 칸(소인 요금·주차·가기 전 알아둘 것). 예전 제보처럼 이 칸이 없는 제보도 위에 섞여 있다
    if let Some(p) = bare.get(4) {
        let tips = json!([{ "kind": "입구·신발", "text": "1층에서부터 신발을 벗어요" }, { "kind": "붐비는 때", "text": "주말 오후에 붐벼요" }]).to_string();
        add(Some(*p), "", "", json!({ "adult": 9000, "child": 6000, "parking": "가능", "parking_note": "목욕 3시간, 찜질 6시간 무료", "tips": tips }), "직접 냈어요", "주차권은 카운터에서 받아요", "");
        let tips = json!([{ "kind": "층·동선", "text": "여탕은 2층, 남탕은 3층이에요" }]).to_string();
        add(Some(*p), "", "", json!({ "tips": tips }), "기타", "", "");
    }
    if let Some(p) = priced.get(3) {
        let tips = json!([{ "kind": "휴업·재오픈", "text": "매달 둘째 주 화요일에 쉬어요" }]).to_string();
        add(Some(*p), "", "", json!({ "child": adult(p).unwrap_or(0) + 2000, "parking_note": "건물 뒤 공영주차장 이용", "tips": tips }), "현장 가격표", "", "");
    }
    add(None, "999999999", "예시 폐업탕", json!({ "adult": 8000 }), "직접 냈어요", "", "");
    add(None, "TEST", "[시험] 운영자 점검", json!({ "adult": 1000 }), "기타", "시험", "입장료 이상값");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn places() -> HashMap<String, Value> {
        let list = vec![
            json!({ "id": "1", "name": "가탕", "addr": "서울 가구", "url": "", "price": null }),
            json!({ "id": "2", "name": "나탕", "addr": "서울 나구", "url": "",
                "price": { "adult": 10000, "towel": null, "checked": "2026-10-27", "source": "네이버 플레이스 가격표" },
                "facts": { "seshin": { "payment": "card_ok" }, "towel": { "women": { "mode": "limited", "count": 2 } },
                    "hairdryer": { "women": { "paid": true }, "men": { "paid": false } }, "checked": "2026-11-02", "source": "후기" } }),
        ];
        list.into_iter().map(|p| (s(&p, "id").to_string(), p)).collect()
    }
    fn rep(id: i64, place: &str, vals: Value) -> Value {
        let mut r = json!({ "id": id, "created_at": "2026-11-10T03:00:00.000Z", "place_id": place, "place_name": "이름",
            "adult": null, "towel": null, "scrub": null, "source": "현장 가격표", "memo": "", "towel_info": "", "hairdryer": "", "seshin_pay": "", "flags": "" });
        for (k, v) in vals.as_object().unwrap() {
            r[k] = v.clone();
        }
        r
    }
    fn chip_of(rs: Vec<Value>) -> String {
        let g = triage(&rs, &places());
        assert_eq!(g.len(), 1);
        g[0]["chip"].as_str().unwrap().to_string()
    }

    #[test]
    fn chips() {
        assert_eq!(chip_of(vec![rep(1, "1", json!({ "adult": 9000 }))]), "새 정보");
        assert_eq!(chip_of(vec![rep(1, "2", json!({ "adult": 11000 }))]), "인상 가능성");
        assert_eq!(chip_of(vec![rep(1, "2", json!({ "adult": 9000 }))]), "확인값과 다름");
        assert_eq!(chip_of(vec![rep(1, "2", json!({ "seshin_pay": "현금만" }))]), "확인값과 다름");
        assert_eq!(chip_of(vec![rep(1, "1", json!({ "adult": 8000 })), rep(2, "1", json!({ "adult": 9000 }))]), "충돌");
        assert_eq!(chip_of(vec![rep(1, "2", json!({ "adult": 10000, "towel_info": "2장", "hairdryer": "여탕 유료 · 남탕 무료" }))]), "이미 반영됨");
        assert_eq!(chip_of(vec![rep(1, "1", json!({ "adult": 150000, "flags": "입장료 이상값" }))]), "반려 추천");
        assert_eq!(chip_of(vec![rep(1, "404", json!({ "adult": 9000 }))]), "반려 추천");
        assert_eq!(chip_of(vec![rep(1, "TEST", json!({ "adult": 9000 }))]), "시험");
        // 이상값과 멀쩡한 값이 섞이면 멀쩡한 값으로 판단한다
        assert_eq!(chip_of(vec![rep(1, "1", json!({ "adult": 150000, "towel_info": "2장", "flags": "입장료 이상값" }))]), "새 정보");
        // 같은 값 두 건은 충돌이 아니다
        assert_eq!(chip_of(vec![rep(1, "2", json!({ "adult": 11000 })), rep(2, "2", json!({ "adult": 11000 }))]), "인상 가능성");
    }

    #[test]
    fn fake_and_suspect_rules() {
        let fake = |k, v| matches!(judge(k, v, None), Judged::Fake(_));
        let sus = |v, now| matches!(judge("adult", v, now), Judged::Suspect(_));
        assert!(fake("adult", 2999) && !fake("adult", 3000) && !fake("adult", 39999) && fake("adult", 40000));
        assert!(!sus(29999, None) && sus(30000, None) && sus(39999, None));
        assert!(sus(5000, Some(10000)) && sus(20000, Some(10000)) && !sus(5100, Some(10000)) && !sus(19900, Some(10000)));
        assert!(fake("towel", 5001) && !fake("towel", 0) && fake("scrub", 4999) && fake("scrub", 60001) && !fake("scrub", 25000));
        // 허위 값뿐이면 반려 추천, 의심 값은 칩은 그대로 두고 주의만 붙인다
        let g = triage(&[rep(1, "1", json!({ "adult": 2000 }))], &places());
        assert_eq!((g[0]["chip"].as_str(), g[0]["reason"].as_str()), (Some("반려 추천"), Some("허위 기준: 입장료 3,000원 미만")));
        let g = triage(&[rep(1, "1", json!({ "adult": 35000 }))], &places());
        assert_eq!(g[0]["chip"].as_str(), Some("새 정보"));
        assert!(g[0]["warn"].as_str().unwrap().contains("30,000원 이상"));
        let g = triage(&[rep(1, "2", json!({ "adult": 4000 }))], &places());
        assert_eq!((g[0]["chip"].as_str(), g[0]["warn"].as_str()), (Some("확인값과 다름"), Some("지금 확인값의 절반 이하")));
    }

    #[test]
    fn sweep_plan() {
        let rs = vec![
            rep(1, "TEST", json!({ "adult": 9000 })),
            rep(2, "1", json!({ "adult": 100 })),
            rep(3, "2", json!({ "adult": 10000 })),
            rep(4, "1", json!({ "towel_info": "2장" })),
            rep(5, "404", json!({ "adult": 9000 })),
        ];
        let plan = plan_sweep(&triage(&rs, &places()), "2026-11-10");
        let mut got: Vec<(i64, &str)> = plan.iter().map(|a| (a.id, a.status)).collect();
        got.sort();
        // 업체 1은 허위 값(#2)과 멀쩡한 정보(#4)가 섞여 있어 사람이 본다 → 정리 대상이 아니다
        assert_eq!(got, [(1, "rejected"), (3, "reviewed"), (5, "rejected")]);
    }

    #[test]
    fn towel_with_side() {
        let p = json!({ "facts": { "towel": { "women": { "mode": "limited", "count": 2 }, "men": { "mode": "limited" } } } });
        // 탕을 말한 제보는 그 탕하고만 견준다
        assert_eq!(compare(Some(&p), "towel_info", &json!("여탕 2장")), State::Same);
        assert_eq!(compare(Some(&p), "towel_info", &json!("남탕 카운터")), State::Same);
        assert_eq!(compare(Some(&p), "towel_info", &json!("남탕 무제한")), State::Differ);
        // 그 탕 값이 아직 없으면 다른 탕 값이 있어도 새 정보
        let only_w = json!({ "facts": { "towel": { "women": { "mode": "unlimited" } } } });
        assert_eq!(compare(Some(&only_w), "towel_info", &json!("남탕 2장")), State::New);
        // 근거와 견주기: 말한 탕만 본다
        assert_eq!(matches("towel_info", &json!("남탕 2장"), &json!({ "women": "", "men": "2장" })), Some(true));
        assert_eq!(matches("towel_info", &json!("남탕 2장"), &json!({ "women": "", "men": "무제한" })), Some(false));
        // 장 수를 모르는 '카운터'는 count 없이 적힌다
        let mut root = json!({ "places": {} });
        update_facts(&mut root, "9", json!({ "towel_info": { "women": "", "men": "카운터" } }).as_object().unwrap(), "직접 방문 확인", "2026-11-11").unwrap();
        assert_eq!(root["places"]["9"]["towel"], json!({ "men": { "mode": "limited" } }));
    }

    #[test]
    fn evidence_keeps_whole_price_table() {
        let table = "대인 | 9,000 | 원 / ".repeat(40) + "세신 | 25,000 | 원";
        let long = "수건 ".repeat(100);
        let row: HashMap<String, String> = [("가격표", table.as_str()), ("수건근거", long.as_str())].into_iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let ev = evidence(&row);
        assert_eq!(ev["by"]["adult"][0].as_str().unwrap(), table); // 끝의 세신 요금까지 그대로
        assert_eq!(ev["by"]["towel"][0].as_str().unwrap().chars().count(), 220); // 후기 문장은 줄인다
    }

    #[test]
    fn evidence_split() {
        let row: HashMap<String, String> = [("네이버ID", "77"), ("수집일", "2026-10-30"), ("가격표", "대인 | 9,000 | 원"), ("수건근거", "[후기] 수건 2장 ‖ [블로그] 수건 무제한 ‖  "), ("세신근거", "")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let e = evidence(&row);
        assert_eq!(e["naver_id"], "77");
        assert_eq!(e["by"]["towel_info"], json!(["[후기] 수건 2장", "[블로그] 수건 무제한"]));
        assert_eq!(e["by"]["adult"], json!(["대인 | 9,000 | 원"]));
        assert_eq!(e["by"]["scrub"], json!([]));
    }

    #[test]
    fn groups_sum_and_order() {
        let rs = vec![
            rep(1, "TEST", json!({ "adult": 1 })),
            rep(2, "2", json!({ "adult": 10000 })),
            rep(3, "1", json!({ "adult": 9000 })),
            rep(4, "1", json!({ "adult": 9000 })),
        ];
        let g = triage(&rs, &places());
        let total: usize = g.iter().map(|x| x["report_ids"].as_array().unwrap().len()).sum();
        assert_eq!(total, rs.len());
        let chips: Vec<&str> = g.iter().map(|x| x["chip"].as_str().unwrap()).collect();
        assert_eq!(chips, ["새 정보", "이미 반영됨", "시험"]);
        assert_eq!(g[0]["fields"][0]["reported"][0]["ids"], json!([3, 4]));
    }

    #[test]
    fn dryer_compare() {
        let p = places();
        let p2 = p.get("2");
        assert_eq!(compare(p2, "hairdryer", &json!("여탕 유료")), State::Same);
        assert_eq!(compare(p2, "hairdryer", &json!("여탕 무료")), State::Differ);
        assert_eq!(compare(p2, "hairdryer", &json!("유료")), State::Differ); // 남탕은 무료
        assert_eq!(compare(p.get("1"), "hairdryer", &json!("유료")), State::New);
        assert_eq!(compare(p2, "towel_info", &json!("2장")), State::Same);
        assert_eq!(compare(p2, "towel_info", &json!("무제한")), State::Differ);
    }

    #[test]
    fn apply_plan() {
        let rs = vec![
            rep(1, "1", json!({ "adult": 9000 })),
            rep(2, "1", json!({ "adult": 8000 })),
            rep(3, "1", json!({ "towel_info": "2장" })),
            rep(4, "1", json!({ "adult": 9000, "seshin_pay": "현금만" })),
        ];
        let ev = json!({ "adult": 9000 });
        let plan = plan_apply(&rs, ev.as_object().unwrap(), "네이버 플레이스 가격표", "2026-11-10");
        let st: Vec<&str> = plan.iter().map(|a| a.status).collect();
        assert_eq!(st, ["applied", "rejected", "reviewed", "applied"]);
        assert!(plan[0].note.contains("입장료 9,000원") && plan[0].note.contains("네이버 플레이스 가격표"));
        assert!(plan[1].note.starts_with("근거와 다름"));
        assert!(plan[3].note.contains("확인 못 한 칸: 세신 결제"));
        assert!(plan.iter().all(|a| a.note.chars().count() <= 200));
        // 드라이기: 근거가 여탕만 있으면 남탕만 말한 제보는 판단하지 못한다
        let ev = json!({ "hairdryer": { "women": "유료", "men": "" } });
        let rs = vec![rep(5, "1", json!({ "hairdryer": "여탕 유료 · 남탕 무료" })), rep(6, "1", json!({ "hairdryer": "남탕 무료" })), rep(7, "1", json!({ "hairdryer": "여탕 무료" }))];
        let st: Vec<&str> = plan_apply(&rs, ev.as_object().unwrap(), "후기", "2026-11-10").iter().map(|a| a.status).collect();
        assert_eq!(st, ["applied", "reviewed", "rejected"]);
    }

    #[test]
    fn evidence_check() {
        assert!(check_evidence(json!({}).as_object().unwrap()).is_err());
        assert!(check_evidence(json!({ "adult": 9000 }).as_object().unwrap()).is_ok());
        assert!(check_evidence(json!({ "adult": 999999 }).as_object().unwrap()).is_err());
        assert!(check_evidence(json!({ "adult": "9000" }).as_object().unwrap()).is_err());
        assert!(check_evidence(json!({ "towel_info": { "women": "", "men": "" } }).as_object().unwrap()).is_err());
        assert!(check_evidence(json!({ "towel_info": { "women": "2장", "men": "" } }).as_object().unwrap()).is_ok());
        assert!(check_evidence(json!({ "hairdryer": { "women": "공짜" } }).as_object().unwrap()).is_err());
        assert!(check_evidence(json!({ "seshin_pay": "외상" }).as_object().unwrap()).is_err());
    }

    const CSV: &str = "\u{feff}카카오ID,성인_평일,성인_주말,수건,주차,어린이,추가요금_없음확인,메모,출처,확인일\r\n111,9000,,,,6000,,\"가격표 대인 9,000원\",네이버 플레이스 가격표,2026-10-27\r\n222,8000,,,,,,메모,공식 홈페이지,2026-10-28\r\n";

    #[test]
    fn prices_edit_one_row() {
        let (out, what) = update_prices_text(CSV, "111", Some(10000), None, None, "현장 확인", "2026-11-10").unwrap();
        assert!(what.starts_with("줄 고침"));
        let old: Vec<&str> = CSV.split("\r\n").collect();
        let new: Vec<&str> = out.split("\r\n").collect();
        assert_eq!(old.len(), new.len());
        assert_eq!((old[0], old[2], old[3]), (new[0], new[2], new[3])); // 머리말·다른 줄·끝은 그대로
        assert_eq!(new[1], "111,10000,,,,6000,,\"가격표 대인 9,000원 | 2026-11-10 제보함: 대인 9000원→10,000원 (현장 확인)\",현장 확인,2026-11-10");
        // 같은 값을 다시 눌러도 요금은 같다
        let (again, _) = update_prices_text(&out, "111", Some(10000), None, None, "현장 확인", "2026-11-10").unwrap();
        assert!(again.contains("111,10000,,,,6000,"));
    }

    #[test]
    fn prices_new_row_and_towel() {
        let (out, what) = update_prices_text(CSV, "lic77", Some(9000), Some(1000), None, "네이버 플레이스 가격표", "2026-11-10").unwrap();
        assert!(what.starts_with("새 줄"));
        assert!(out.starts_with(CSV));
        assert_eq!(&out[CSV.len()..], "lic77,9000,,1000,,,,\"2026-11-10 제보함: 대인 9,000원, 수건 1,000원 (네이버 플레이스 가격표)\",네이버 플레이스 가격표,2026-11-10\r\n");
        // 수건 요금만 더하면 예전 출처 뒤에 덧붙는다
        let (out, _) = update_prices_text(CSV, "222", None, Some(500), None, "현장 확인", "2026-11-10").unwrap();
        assert!(out.contains("222,8000,,500,,,,메모 | 2026-11-10 제보함: 수건 500원 (현장 확인),공식 홈페이지 / 현장 확인,2026-11-10\r\n"));
        assert!(update_prices_text(CSV, "222", None, None, None, "x", "2026-11-10").is_err());
    }

    const FACTS: &str = "{\n \"_설명\": \"글\",\n \"places\": {\n  \"1\": {\n   \"seshin\": {\n    \"price_full\": 12000\n   },\n   \"checked\": \"2026-10-28\",\n   \"source\": \"가격표\"\n  },\n  \"2\": {\n   \"towel\": {\n    \"women\": {\n     \"mode\": \"limited\",\n     \"count\": 2\n    }\n   },\n   \"checked\": \"2026-10-28\",\n   \"source\": \"후기\"\n  }\n }\n}";

    #[test]
    fn facts_edit_one_place() {
        let (mut root, nl) = load_facts_text(FACTS).unwrap();
        assert!(!nl);
        let before_other = root["places"]["2"].clone();
        let ev = json!({ "adult": 9000, "seshin_pay": "현금만", "towel_info": { "women": "3장 이상", "men": "무제한" }, "hairdryer": { "women": "유료", "men": "없음" } });
        let done = update_facts(&mut root, "1", ev.as_object().unwrap(), "현장 확인", "2026-11-10").unwrap();
        assert_eq!(done.len(), 3); // 입장료는 여기서 다루지 않는다
        assert_eq!(root["places"]["2"], before_other);
        let p = &root["places"]["1"];
        assert_eq!(p["seshin"], json!({ "price_full": 12000, "payment": "cash_only" }));
        assert_eq!(p["towel"], json!({ "women": { "mode": "limited", "count": 3 }, "men": { "mode": "unlimited" } }));
        assert_eq!(p["hairdryer"], json!({ "women": { "paid": true }, "men": { "none": true } }));
        assert_eq!((p["checked"].as_str(), p["source"].as_str()), (Some("2026-11-10"), Some("가격표 / 현장 확인")));
        // 다시 쓴 글자에서 다른 업체 부분은 그대로다
        let out = facts_text(&root, nl);
        let tail = &FACTS[FACTS.find("  \"2\": {").unwrap()..];
        assert!(out.ends_with(tail));
        // 새 업체
        let done = update_facts(&mut root, "9", json!({ "scrub": 25000 }).as_object().unwrap(), "가격표", "2026-11-10").unwrap();
        assert_eq!(done, ["세신 요금 25,000원"]);
        assert_eq!(root["places"]["9"], json!({ "seshin": { "price_full": 25000 }, "checked": "2026-11-10", "source": "가격표" }));
        // 모양이 다른 파일은 쓰지 않는다
        assert!(load_facts_text("{\"places\": {}}").is_err());
    }

    /// 실제 확인 파일을 읽기만 한다(쓰지 않음). 프로그램이 다른 줄·다른 업체를 건드리지 않고 쓸 수 있는 모양인지 본다.
    #[test]
    fn real_files_keep_shape() {
        if let Ok(text) = std::fs::read_to_string(FACTS_FILE) {
            let (root, nl) = load_facts_text(&text).expect("place_facts.json을 같은 모양으로 다시 쓸 수 있어야 한다");
            assert_eq!(facts_text(&root, nl), text);
        }
        if let Ok(text) = std::fs::read_to_string(PRICE_FILE) {
            let (out, _) = update_prices_text(&text, "__없는업체__", Some(9000), None, None, "시험", "2026-11-10").unwrap();
            assert!(out.starts_with(&text), "새 줄은 맨 뒤에만 붙어야 한다");
            // 있는 줄을 고치면 그 줄만 달라진다
            let key = text.lines().nth(1).and_then(|l| l.split(',').next()).unwrap_or("").to_string();
            let (out, what) = update_prices_text(&text, &key, None, Some(0), None, "시험", "2026-11-10").unwrap();
            assert!(what.starts_with("줄 고침"));
            let differ = text.split('\n').zip(out.split('\n')).filter(|(a, b)| a != b).count();
            assert_eq!((differ, text.split('\n').count()), (1, out.split('\n').count()));
        }
    }

    // ───────── 새 칸: 소인 요금·주차·가기 전 알아둘 것 ─────────

    const TIPS2: &str = r#"[{"kind":"입구·신발","text":"1층에서부터 신발을 벗어요"},{"kind":"붐비는 때","text":"주말에 붐벼요"}]"#;

    #[test]
    fn new_fields_read_from_report() {
        // 새 칸이 아예 없는 예전 제보(키 없음·null)는 지금처럼 동작한다
        let old = json!({ "id": 1, "created_at": "2026-11-10T03:00:00.000Z", "place_id": "1", "place_name": "가탕", "adult": 9000, "towel": null, "scrub": null,
            "source": "현장 가격표", "memo": "", "towel_info": "", "hairdryer": "", "seshin_pay": "", "flags": "" });
        for k in ["child", "parking", "tips"] {
            assert_eq!(report_value(&old, k), None);
        }
        let mut nulls = old.clone();
        for k in ["child", "parking", "parking_note", "tips"] {
            nulls[k] = Value::Null;
        }
        let (a, b) = (triage(&[old.clone()], &places()), triage(&[nulls], &places()));
        assert_eq!(a, b);
        assert_eq!(a[0]["chip"], "새 정보");
        assert_eq!(a[0]["fields"].as_array().unwrap().len(), 1);
        assert_eq!(a[0]["reports"][0]["values"], json!(["입장료 9,000원"]));
        let plan = plan_apply(&[old], json!({ "adult": 9000 }).as_object().unwrap(), "가격표", "2026-11-16");
        assert_eq!((plan[0].status, plan[0].note.as_str()), ("applied", "반영: 입장료 9,000원 (가격표, 2026-11-16)"));

        // 새 칸 읽기
        let r = rep(2, "1", json!({ "child": 6000, "parking": "가능", "parking_note": "목욕 3시간, 찜질 6시간 무료", "tips": TIPS2 }));
        assert_eq!(report_value(&r, "child"), Some(json!(6000)));
        assert_eq!(report_value(&r, "parking"), Some(json!({ "available": "가능", "note": "목욕 3시간, 찜질 6시간 무료" })));
        assert_eq!(report_value(&r, "tips").unwrap().as_array().unwrap().len(), 2);
        // 가능 여부 없이 안내 글만 와도 값이다
        assert_eq!(report_value(&rep(3, "1", json!({ "parking_note": "공영주차장" })), "parking"), Some(json!({ "available": "", "note": "공영주차장" })));
        // 깨진 JSON·빈 글은 없는 것으로, 모르는 종류는 기타로, 3개까지만
        assert_eq!(report_value(&rep(4, "1", json!({ "tips": r#"[{"kind":"# })), "tips"), None);
        assert_eq!(report_value(&rep(4, "1", json!({ "tips": r#"[{"kind":"기타","text":"  "}]"# })), "tips"), None);
        let many = json!([{ "kind": "?", "text": "가" }, { "kind": "기타", "text": "나" }, { "kind": "기타", "text": "다" }, { "kind": "기타", "text": "라" }]).to_string();
        let got = report_tips(&rep(5, "1", json!({ "tips": many })));
        assert_eq!((got.len(), got[0]["kind"].as_str()), (3, Some("기타")));
        // 목록 한 줄 요약에도 나온다
        let g = triage(&[r], &places());
        assert_eq!(g[0]["reports"][0]["values"], json!(["소인 요금 6,000원", "주차 가능 · 목욕 3시간, 찜질 6시간 무료", "알아둘 것 [입구·신발] 1층에서부터 신발을 벗어요 / [붐비는 때] 주말에 붐벼요"]));
    }

    #[test]
    fn child_rules() {
        let fake = |v| matches!(judge("child", v, None), Judged::Fake(_));
        assert!(!fake(0) && !fake(20000) && fake(20001) && fake(-1));
        assert!(matches!(judge("child", 11000, Some(10000)), Judged::Suspect(_)));
        assert_eq!(judge("child", 10000, Some(10000)), Judged::Ok);
        assert_eq!(judge("child", 11000, None), Judged::Ok);
        // 범위 밖뿐이면 반려 추천, 대인 확인값보다 비싸면 칩은 그대로 두고 의심만
        let g = triage(&[rep(1, "1", json!({ "child": 30000, "flags": "소인 이상값" }))], &places());
        assert_eq!((g[0]["chip"].as_str(), g[0]["reason"].as_str()), (Some("반려 추천"), Some("허위 기준: 소인 요금 20,000원 초과")));
        let g = triage(&[rep(1, "2", json!({ "child": 12000 }))], &places());
        assert_eq!((g[0]["chip"].as_str(), g[0]["warn"].as_str()), (Some("새 정보"), Some("소인 요금이 대인 요금보다 비쌈")));
        assert_eq!(g[0]["fields"][0]["reported"][0]["mark"], "suspect");
        // 대인 확인값이 없으면 같은 묶음 제보의 입장료와 견준다
        let g = triage(&[rep(1, "1", json!({ "adult": 8000, "child": 9000 }))], &places());
        assert_eq!(g[0]["warn"].as_str(), Some("소인 요금이 대인 요금보다 비쌈"));
        // 지금 값과 견주기
        let p = json!({ "price": { "adult": 10000, "child": 6000 } });
        assert_eq!(compare(Some(&p), "child", &json!(6000)), State::Same);
        assert_eq!(compare(Some(&p), "child", &json!(7000)), State::Differ);
        assert_eq!(current(Some(&p), "child").text, "6,000원");
    }

    #[test]
    fn prices_child_column() {
        // 소인 요금은 '어린이' 칸에 들어가고, 그 줄의 다른 칸·다른 줄은 그대로다
        let (out, what) = update_prices_text(CSV, "222", None, None, Some(5000), "현장 확인", "2026-11-16").unwrap();
        assert_eq!(what, "줄 고침 222: 소인 5,000원");
        let (old, new): (Vec<&str>, Vec<&str>) = (CSV.split("\r\n").collect(), out.split("\r\n").collect());
        assert_eq!((old[0], old[1], old[3]), (new[0], new[1], new[3]));
        assert_eq!(new[2], "222,8000,,,,5000,,\"메모 | 2026-11-16 제보함: 소인 5,000원 (현장 확인)\",공식 홈페이지 / 현장 확인,2026-11-16");
        // 이미 있던 소인 요금을 바꾸면 메모에 전후가 남는다. 입장료가 같이 바뀌지 않으면 출처는 덧붙는다
        let (out, _) = update_prices_text(CSV, "111", None, None, Some(7000), "현장 확인", "2026-11-16").unwrap();
        assert!(out.contains("111,9000,,,,7000,,\"가격표 대인 9,000원 | 2026-11-16 제보함: 소인 6000원→7,000원 (현장 확인)\",네이버 플레이스 가격표 / 현장 확인,2026-11-16\r\n"));
        // 새 업체: 대인·소인을 함께
        let (out, _) = update_prices_text(CSV, "333", Some(9000), None, Some(6000), "가격표", "2026-11-16").unwrap();
        assert_eq!(&out[CSV.len()..], "333,9000,,,,6000,,\"2026-11-16 제보함: 대인 9,000원, 소인 6,000원 (가격표)\",가격표,2026-11-16\r\n");
        // 근거 검사·반영 계획
        assert!(check_evidence(json!({ "child": 6000 }).as_object().unwrap()).is_ok());
        let rs = vec![rep(1, "1", json!({ "child": 6000 })), rep(2, "1", json!({ "child": 5000 }))];
        let st: Vec<&str> = plan_apply(&rs, json!({ "child": 6000 }).as_object().unwrap(), "가격표", "2026-11-16").iter().map(|a| a.status).collect();
        assert_eq!(st, ["applied", "rejected"]);
    }

    #[test]
    fn parking_to_facts() {
        let (mut root, nl) = load_facts_text(FACTS).unwrap();
        let before_other = root["places"]["2"].clone();
        let ev = json!({ "parking": { "available": "가능", "note": "목욕 3시간, 찜질 6시간 무료" } });
        assert!(check_evidence(ev.as_object().unwrap()).is_ok());
        let done = update_facts(&mut root, "1", ev.as_object().unwrap(), "현장 확인", "2026-11-16").unwrap();
        assert_eq!(done, ["주차 가능 · 목욕 3시간, 찜질 6시간 무료"]);
        let p = &root["places"]["1"];
        assert_eq!(p["convenience"], json!({ "parking": { "available": true, "note": "목욕 3시간, 찜질 6시간 무료" } }));
        assert_eq!(p["seshin"], json!({ "price_full": 12000 })); // 그 업체의 다른 정보도 그대로
        assert_eq!((p["checked"].as_str(), p["source"].as_str()), (Some("2026-11-16"), Some("가격표 / 현장 확인")));
        assert_eq!(root["places"]["2"], before_other);
        assert!(facts_text(&root, nl).ends_with(&FACTS[FACTS.find("  \"2\": {").unwrap()..]));
        // 불가는 false, note는 있을 때만
        update_facts(&mut root, "1", json!({ "parking": { "available": "불가", "note": "" } }).as_object().unwrap(), "현장 확인", "2026-11-16").unwrap();
        assert_eq!(root["places"]["1"]["convenience"]["parking"], json!({ "available": false }));
        // 가능 여부 없이 안내 글만: 새 업체는 note만, convenience의 다른 키는 그대로
        let mut root = json!({ "places": { "7": { "convenience": { "open_24h": true, "parking": { "available": true } } } } });
        update_facts(&mut root, "8", json!({ "parking": { "available": "", "note": "공영주차장 이용" } }).as_object().unwrap(), "후기", "2026-11-16").unwrap();
        assert_eq!(root["places"]["8"]["convenience"], json!({ "parking": { "note": "공영주차장 이용" } }));
        update_facts(&mut root, "7", json!({ "parking": { "available": "", "note": "2시간 무료" } }).as_object().unwrap(), "후기", "2026-11-16").unwrap();
        assert_eq!(root["places"]["7"]["convenience"], json!({ "open_24h": true, "parking": { "available": true, "note": "2시간 무료" } }));
        // 근거 검사
        let bad = |v: Value| check_evidence(json!({ "parking": v }).as_object().unwrap()).is_err();
        assert!(bad(json!({ "available": "", "note": " " })) && bad(json!({ "available": "있음", "note": "" })) && bad(json!("가능")));
        assert!(bad(json!({ "available": "가능", "note": "가".repeat(41) })) && !bad(json!({ "available": "가능", "note": "가".repeat(40) })));
        // 지금 값과 견주기·반영 계획
        let place = json!({ "facts": { "convenience": { "parking": { "available": true, "note": "2시간 무료" } }, "checked": "2026-11-01", "source": "후기" } });
        assert_eq!(current(Some(&place), "parking").text, "가능 · 2시간 무료");
        assert_eq!(compare(Some(&place), "parking", &json!({ "available": "가능", "note": "" })), State::Same);
        assert_eq!(compare(Some(&place), "parking", &json!({ "available": "불가", "note": "" })), State::Differ);
        assert_eq!(compare(None, "parking", &json!({ "available": "가능", "note": "" })), State::New);
        let rs = vec![
            rep(1, "1", json!({ "parking": "가능", "parking_note": "3시간 무료" })),
            rep(2, "1", json!({ "parking": "불가" })),
            rep(3, "1", json!({ "parking_note": "공영주차장" })),
        ];
        let ev = json!({ "parking": { "available": "가능", "note": "" } });
        let st: Vec<&str> = plan_apply(&rs, ev.as_object().unwrap(), "후기", "2026-11-16").iter().map(|a| a.status).collect();
        assert_eq!(st, ["applied", "rejected", "reviewed"]);
    }

    #[test]
    fn tips_to_facts() {
        let (mut root, nl) = load_facts_text(FACTS).unwrap();
        let before_other = root["places"]["2"].clone();
        // 하나는 다듬어서 넣고, 하나는 버린다
        let ev = json!({ "tips": [
            { "of": "1층에서부터 신발을 벗어요", "ok": true, "kind": "입구·신발", "text": " 1층 입구에서 신발을 벗어요 " },
            { "of": "주말에 붐벼요", "ok": false },
        ] });
        assert!(check_evidence(ev.as_object().unwrap()).is_ok());
        let done = update_facts(&mut root, "1", ev.as_object().unwrap(), "직접 방문 확인", "2026-11-16").unwrap();
        assert_eq!(done, ["알아둘 것 1개"]);
        assert_eq!(root["places"]["1"]["tips"], json!([{ "kind": "입구·신발", "text": "1층 입구에서 신발을 벗어요", "date": "2026-11-16" }]));
        assert_eq!(root["places"]["2"], before_other);
        assert!(facts_text(&root, nl).ends_with(&FACTS[FACTS.find("  \"2\": {").unwrap()..]));
        // 같은 글은 두 번 들어가지 않고, 기존 글은 지워지지 않는다
        let again = json!({ "tips": [
            { "of": "x", "ok": true, "kind": "입구·신발", "text": "1층 입구에서 신발을 벗어요" },
            { "of": "y", "ok": true, "kind": "붐비는 때", "text": "주말 오후에 붐벼요" },
            { "of": "z", "ok": true, "kind": "붐비는 때", "text": "주말 오후에 붐벼요" },
        ] });
        let done = update_facts(&mut root, "1", again.as_object().unwrap(), "직접 방문 확인", "2026-11-17").unwrap();
        assert_eq!(done, ["알아둘 것 1개"]);
        assert_eq!(root["places"]["1"]["tips"], json!([
            { "kind": "입구·신발", "text": "1층 입구에서 신발을 벗어요", "date": "2026-11-16" },
            { "kind": "붐비는 때", "text": "주말 오후에 붐벼요", "date": "2026-11-17" },
        ]));
        // 전부 이미 있는 글이면 아무것도 바꾸지 않는다(확인일도 그대로)
        let snap = root.clone();
        let done = update_facts(&mut root, "1", again.as_object().unwrap(), "다른 출처", "2026-11-18").unwrap();
        assert!(done.is_empty());
        assert_eq!(root, snap);
        // 전부 버리면 업체를 새로 만들지도 않는다
        let done = update_facts(&mut root, "9", json!({ "tips": [{ "of": "a", "ok": false }] }).as_object().unwrap(), "x", "2026-11-18").unwrap();
        assert!(done.is_empty() && root["places"].get("9").is_none());
        // 근거 검사
        let bad = |v: Value| check_evidence(json!({ "tips": v }).as_object().unwrap()).is_err();
        assert!(bad(json!([])) && bad(json!([{ "of": "a", "ok": true, "kind": "기타", "text": "" }])) && bad(json!([{ "of": "a", "ok": true, "kind": "아무거나", "text": "글" }])));
        assert!(bad(json!([{ "of": "a", "ok": true, "kind": "기타", "text": "가".repeat(61) }])) && !bad(json!([{ "of": "a", "ok": true, "kind": "기타", "text": "가".repeat(60) }])));
        assert!(bad(json!([{ "of": "a" }])) && !bad(json!([{ "of": "a", "ok": false }])));
    }

    #[test]
    fn tips_triage_and_plan() {
        let rs = vec![
            rep(1, "1", json!({ "tips": TIPS2 })),
            rep(2, "1", json!({ "tips": r#"[{"kind":"붐비는 때","text":"주말에 붐벼요"}]"# })),
            rep(3, "1", json!({ "tips": r#"[{"kind":"기타","text":"수건은 카운터에서"}]"# })),
        ];
        let g = triage(&rs, &places());
        // 서로 다른 알아둘 것은 충돌이 아니고, 글 하나씩 따로 고를 수 있게 나뉜다
        assert_eq!(g[0]["chip"], "새 정보");
        let f = &g[0]["fields"][0];
        assert_eq!((f["key"].as_str(), f["state"].as_str(), f["reported"].as_array().unwrap().len()), (Some("tips"), Some("new"), 3));
        assert_eq!(f["reported"][1]["value"], json!({ "kind": "붐비는 때", "text": "주말에 붐벼요" }));
        assert_eq!(f["reported"][1]["ids"], json!([1, 2]));
        // 이미 화면에 있는 글뿐이면 이미 반영됨
        let mut ps = places();
        ps.get_mut("1").unwrap()["facts"] = json!({ "tips": [{ "kind": "붐비는 때", "text": "주말에 붐벼요", "date": "2026-11-12" }] });
        let g = triage(&rs[1..2], &ps);
        assert_eq!((g[0]["chip"].as_str(), g[0]["fields"][0]["reported"][0]["known"].as_bool()), (Some("이미 반영됨"), Some(true)));
        assert_eq!(g[0]["fields"][0]["current"]["tips"][0]["text"], "주말에 붐벼요");
        // 하나라도 넣으면 반영, 전부 버렸으면 다름, 고르지 않은 글뿐이면 확인 못 함
        let ev = json!({ "tips": [{ "of": "1층에서부터 신발을 벗어요", "ok": true, "kind": "입구·신발", "text": "1층에서 신발을 벗어요" }, { "of": "주말에 붐벼요", "ok": false }] });
        let plan = plan_apply(&rs, ev.as_object().unwrap(), "직접 방문 확인", "2026-11-16");
        let st: Vec<&str> = plan.iter().map(|a| a.status).collect();
        assert_eq!(st, ["applied", "rejected", "reviewed"]);
        assert_eq!(plan[0].note, "반영: 알아둘 것 1개 (직접 방문 확인, 2026-11-16)");
        assert_eq!(plan[1].note, "근거와 다름: 알아둘 것 버림 (직접 방문 확인, 2026-11-16)");
    }

    #[test]
    fn demo_has_new_fields() {
        // 실제 화면 데이터로 만든 예시 제보에 새 칸이 들어 있고 칩 7종이 그대로 다 보인다(파일은 읽기만 한다)
        let Ok(text) = std::fs::read_to_string(ONSEN_FILE) else { return };
        let root: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap();
        let ps = root["places"].as_array().cloned().unwrap_or_default();
        let demo = demo_reports(&ps, "2026-11-16T03:00:00.000Z");
        for k in ["child", "parking", "tips"] {
            assert!(demo.iter().any(|r| report_value(r, k).is_some()), "예시 제보에 {k} 칸이 없다");
        }
        let map: HashMap<String, Value> = ps.iter().map(|p| (s(p, "id").to_string(), p.clone())).collect();
        let groups = triage(&demo, &map);
        let chips: std::collections::HashSet<&str> = groups.iter().filter_map(|g| g["chip"].as_str()).collect();
        assert_eq!(chips.len(), CHIPS.len(), "칩 7종이 모두 보여야 한다: {chips:?}");
    }

    #[test]
    fn misc() {
        assert_eq!(won(11000), "11,000원");
        assert_eq!(won(500), "500원");
        assert_eq!(kst("2026-11-10T03:05:00.000Z"), "2026-11-10 12:05");
        assert!(can_key("lic123") && can_key("12345") && !can_key("m12"));
        let ps: Vec<Value> = places().into_values().collect();
        let demo = demo_reports(&ps, "2026-11-10T03:00:00.000Z");
        assert!(demo.len() >= 5);
    }
}
