//! 합친 온천 목록(onsen_merged.csv)에 가격·주차장을 붙여 React 화면용 web/public/data/onsen.json으로 저장한다.
//!
//! 지도·목록 화면은 이 JSON만 읽는다. 키는 들어가지 않는다. (REST 키는 이 파이프라인 어디에도 안 쓴다)
//! 좌표가 없는 곳(행안부에만 있는 곳)은 위도·경도가 null이고, 화면에서 목록에만 나온다.
//! 실행: cargo run --release --bin export_web_data

use anyhow::Result;
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde_json::{Map, Value};
use std::collections::HashMap;
use tangbang_data::csvio::{self, g, get, Dtype};
use tangbang_data::pyjson::{self, f, obj};
use tangbang_data::{keys, re, util};

const MERGED: &str = "data/merged/onsen_merged.csv";
const PARKING_FILE: &str = "data/collected/onsen_parking.csv"; // 주차장 목록 (ego-lite로 수집)
const PRICE_FILE: &str = "data/curated/onsen_prices.csv"; // 확인된 가격만 사람이 적는다
const TANGBANG_PRICES: &str = "data/curated/tangbang_places_price_data.json"; // 요금 조사 자료(실측 확인 + 인근 평균 추정)
                                                                              // 한국소비자원 참가격 '목욕(성인 일반대중탕 1회)' 서울 값. 기준월 미표기·잠정치라 추정으로만 쓴다.
const SEOUL_REGION_ADULT: f64 = 11000.0;
const SEOUL_REGION_BASIS: &str = "서울 일반 대중탕 지역 요금·참가격 잠정";
const SEOUL_REGION_CHECKED: &str = "2026-10-24";
const PRICE_AUTO_FILE: &str = "data/collected/price_auto.csv"; // judge_facts가 네이버 가격표에서 뽑은 입장료(다시 만들 수 있음)
const AUTO_FACTS_FILE: &str = "data/collected/place_facts_auto.json"; // judge_facts가 근거 문장으로 판정한 값(다시 만들 수 있음)
const FACTS_FILE: &str = "data/curated/place_facts.json"; // 사람이 직접 확인한 세부 정보(세신·수건·드라이기 등). 카카오ID가 열쇠
const PHOTO_FILE: &str = "data/curated/place_photos.csv"; // 업체 등록 사진 후보 중 눈으로 보고 고른 대표 사진(탕·외관·내부만)
const OUT: &str = "web/public/data/onsen.json";

const PRICE_COLS: [&str; 5] = ["성인_평일", "성인_주말", "수건", "주차", "어린이"];
// 파이썬 urllib.parse.quote(u, safe="")와 같은 글자만 남긴다
const QUOTE_ALL: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

re!(BASIS, r"\(인근 (.+?) 기준\)");

/// 카카오ID → 목록 썸네일 주소. 네이버 업체 사진(ldb-phinf) 원본을 180px 정사각 썸네일 주소로 바꿔 쓴다.
fn load_photos() -> Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    if !util::exists(PHOTO_FILE) {
        return Ok(out);
    }
    let thumb = "https://search.pstatic.net/common/?autoRotate=true&type=f180_180&src=";
    for r in csvio::read_csv(PHOTO_FILE, false, Dtype::AllStr)?.records() {
        let u = g(&r, "사진URL");
        if u.starts_with("https://ldb-phinf.pstatic.net/") {
            out.insert(
                g(&r, "카카오ID").to_string(),
                format!("{thumb}{}", utf8_percent_encode(u, QUOTE_ALL)),
            );
        }
    }
    Ok(out)
}

fn median(xs: &[f64]) -> Option<f64> {
    let mut xs = xs.to_vec();
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = xs.len();
    if n == 0 {
        None
    } else if n % 2 == 1 {
        Some(xs[n / 2])
    } else {
        Some((xs[n / 2 - 1] + xs[n / 2]) / 2.0)
    }
}

fn adult_of(p: &Value) -> Option<f64> {
    let price = p.get("price")?;
    if !pyjson::truthy(Some(price)) || !pyjson::truthy(price.get("adult")) {
        return None;
    }
    price.get("adult")?.as_f64()
}

/// 요금을 확인하지 못한 곳에 '예시 요금'을 붙인다(가상 값, 화면에서 '예시'로 표시).
/// 값 = 같은 구에서 확인된 성인 요금의 중앙값(500원 단위 반올림). 확인된 곳이 3곳 미만인 구는 서울 전체 중앙값.
fn add_example_prices(places: &mut [Value]) {
    let confirmed: Vec<(String, f64)> = places
        .iter()
        .filter_map(|p| adult_of(p).map(|a| (p["gu"].as_str().unwrap_or("").to_string(), a)))
        .collect();
    let seoul = median(&confirmed.iter().map(|x| x.1).collect::<Vec<_>>());
    let mut by_gu: HashMap<&str, Vec<f64>> = HashMap::new();
    for (gu, a) in &confirmed {
        by_gu.entry(gu.as_str()).or_default().push(*a);
    }
    for p in places.iter_mut() {
        if pyjson::truthy(p.get("price")) {
            continue;
        }
        let gu = p["gu"].as_str().unwrap_or("").to_string();
        let xs = by_gu.get(gu.as_str()).cloned().unwrap_or_default();
        let (base, basis) = if xs.len() >= 3 {
            (median(&xs), format!("{gu} 확인 요금 {}곳 중앙값", xs.len()))
        } else {
            (
                seoul,
                format!("서울 확인 요금 {}곳 중앙값", confirmed.len()),
            )
        };
        let base = base.expect("⛔ 확인된 요금이 한 곳도 없어 예시 요금을 만들 수 없어요");
        let adult = (base / 500.0).round_ties_even() as i64 * 500; // 파이썬 round()처럼 짝수 쪽으로
        p.as_object_mut().unwrap().insert(
            "price_example".into(),
            obj(vec![
                ("adult", Value::from(adult)),
                ("basis", Value::from(basis)),
            ]),
        );
    }
}

/// 사람이 확인한 요금(PRICE_FILE)이 먼저, 그 곳에 없는 곳만 가격표 자동 판정(PRICE_AUTO_FILE)으로 채운다.
fn load_prices() -> Result<HashMap<String, Value>> {
    let mut prices = HashMap::new();
    for path in [PRICE_FILE, PRICE_AUTO_FILE] {
        if !util::exists(path) {
            continue;
        }
        for r in csvio::read_csv(path, true, Dtype::Infer(&["카카오ID"]))?.records() {
            let num = |c: &str| {
                let v = g(&r, c);
                if v == "무료" {
                    Some(0.0)
                } else {
                    util::parse_num(v)
                } // '무료'는 0원
            };
            let vals: Vec<Option<f64>> = PRICE_COLS.iter().map(|c| num(c)).collect();
            if vals.iter().all(|v| v.is_none()) {
                continue; // 가격이 하나도 없는 줄은 '확인됨'으로 치지 않는다
            }
            let kid = g(&r, "카카오ID").to_string();
            if prices.contains_key(&kid) {
                continue; // 이미 사람이 확인한 값이 있는 곳은 자동 값으로 덮지 않는다
            }
            let none = util::py_strip(get(&r, "추가요금_없음확인")).to_uppercase();
            prices.insert(
                kid,
                obj(vec![
                    ("adult", f(vals[0])),
                    ("weekend", f(vals[1])),
                    ("towel", f(vals[2])),
                    ("parking", f(vals[3])),
                    ("child", f(vals[4])),
                    ("jjimjil", Value::Null),
                    (
                        "none",
                        Value::from(["Y", "예", "O"].contains(&none.as_str())),
                    ),
                    ("memo", Value::from(g(&r, "메모"))),
                    ("source", Value::from(g(&r, "출처"))),
                    ("checked", Value::from(g(&r, "확인일"))),
                ]),
            );
        }
    }
    Ok(prices)
}

fn places_of(path: &str) -> Result<Map<String, Value>> {
    if !util::exists(path) {
        return Ok(Map::new());
    }
    Ok(pyjson::load_file(path)?
        .get("places")
        .and_then(|p| p.as_object())
        .cloned()
        .unwrap_or_default())
}

/// 자동 판정 위에 사람이 확인한 값을 항목별로 덮는다(사람 값이 없는 항목은 자동 값이 남는다).
fn overlay(auto: &Map<String, Value>, manual: &Map<String, Value>) -> Map<String, Value> {
    let mut out = auto.clone();
    for (k, v) in manual {
        let nv = match (v.as_object(), out.get(k).and_then(|x| x.as_object())) {
            (Some(mv), Some(av)) => Value::Object(overlay(av, mv)),
            _ => v.clone(),
        };
        out.insert(k.clone(), nv);
    }
    if pyjson::truthy(auto.get("source")) && pyjson::truthy(manual.get("source")) {
        let s = format!(
            "{} / {}",
            pyjson::py_str(&manual["source"]),
            pyjson::py_str(&auto["source"])
        );
        out.insert("source".into(), Value::from(s));
    }
    out
}

/// 세부 정보. 사람이 확인한 값(FACTS_FILE)이 자동 판정(AUTO_FACTS_FILE)보다 우선한다. 파일에 없는 곳은 facts 키를 아예 넣지 않는다.
fn load_facts() -> Result<HashMap<String, Value>> {
    let (auto, manual) = (places_of(AUTO_FACTS_FILE)?, places_of(FACTS_FILE)?);
    let empty = Map::new();
    let mut out = HashMap::new();
    for kid in auto.keys().chain(manual.keys()) {
        let a = auto.get(kid).and_then(|v| v.as_object()).unwrap_or(&empty);
        let m = manual
            .get(kid)
            .and_then(|v| v.as_object())
            .unwrap_or(&empty);
        out.insert(kid.clone(), Value::Object(overlay(a, m)));
    }
    Ok(out)
}

/// 파일에 온천 ID가 있으면 조회한 것. 주차장이름이 빈 줄은 '반경 안에 없음', ID가 아예 없으면 '조회 안 됨'(null).
fn load_parking() -> Result<(HashMap<String, Vec<Value>>, Option<i64>)> {
    let mut parking: HashMap<String, Vec<Value>> = HashMap::new();
    let mut radius = None;
    if !util::exists(PARKING_FILE) {
        return Ok((parking, radius));
    }
    let rows = csvio::read_csv(PARKING_FILE, true, Dtype::Infer(&["카카오ID"]))?.records();
    let int = |s: &str| {
        util::parse_num(s)
            .map(|x| x.trunc() as i64)
            .expect("⛔ 주차장 거리·반경이 숫자가 아니에요")
    };
    if let Some(r) = rows.first() {
        radius = Some(int(g(r, "조회반경(m)")));
    }
    for r in &rows {
        let lst = parking.entry(g(r, "카카오ID").to_string()).or_default();
        if !g(r, "주차장이름").is_empty() {
            lst.push(obj(vec![
                ("name", Value::from(g(r, "주차장이름"))),
                ("dist", Value::from(int(g(r, "거리(m)")))),
                ("addr", Value::from(g(r, "주소"))),
                ("kind", Value::from(g(r, "구분"))),
                ("url", Value::from(g(r, "카카오장소주소"))),
            ]));
        }
    }
    Ok((parking, radius))
}

#[derive(Clone)]
struct Tb {
    confirmed: bool,
    adult: Option<f64>,
    child: Option<f64>,
    jjimjil: Option<f64>,
    basis: String,
    checked: String,
}

/// 판다스 to_numeric(값, errors="coerce")
fn to_num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => util::parse_num(s),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

type TbStore = HashMap<(String, String), Tb>;

/// 요금 조사 자료를 (이름, 주소) 열쇠로 모은다.
/// price_status가 '실측확인완료'·'확인완료'면 확인된 요금, '근처 욕탕 요금 바탕 평균 추정가'면 추정(확인된 요금 아님).
fn load_tangbang_prices() -> Result<(TbStore, TbStore)> {
    let (mut by_addr, mut by_sigungu) = (TbStore::new(), TbStore::new());
    if !util::exists(TANGBANG_PRICES) {
        return Ok((by_addr, by_sigungu));
    }
    let rows = pyjson::load_file(TANGBANG_PRICES)?;
    for r in rows.as_array().cloned().unwrap_or_default() {
        let status = pyjson::py_str(&r["price_status"]);
        let info = Tb {
            confirmed: !status.starts_with("근처"),
            adult: to_num(r.get("adult_price")),
            child: to_num(r.get("child_price")),
            jjimjil: to_num(r.get("jjimjil_extra")),
            basis: BASIS
                .captures(&status)
                .map(|c| c[1].to_string())
                .unwrap_or_default(),
            checked: pyjson::py_str(&r["last_updated"]),
        };
        let nk = keys::name_key(&pyjson::py_str(&r["place_name"]));
        let addr = pyjson::py_str(&r["address"]);
        for (store, key) in [
            (&mut by_addr, (nk.clone(), keys::addr_key(&addr))),
            (&mut by_sigungu, (nk.clone(), keys::sigungu_addr(&addr))),
        ] {
            let replace = match store.get(&key) {
                None => true,
                Some(old) => info.confirmed && !old.confirmed, // 같은 곳이 둘이면 확인된 쪽을 쓴다
            };
            if replace {
                store.insert(key, info.clone());
            }
        }
    }
    Ok((by_addr, by_sigungu))
}

fn build() -> Result<Vec<Value>> {
    let df = csvio::read_csv(MERGED, false, Dtype::AllStr)?.records();
    let prices = load_prices()?;
    let (parking, radius) = load_parking()?;
    let facts = load_facts()?;
    let (tb_addr, tb_sigungu) = load_tangbang_prices()?;
    let photos = load_photos()?;
    let mut sigungu_count: HashMap<(String, String), usize> = HashMap::new();
    for r in &df {
        *sigungu_count
            .entry((keys::name_key(g(r, "이름")), g(r, "시군구").to_string()))
            .or_default() += 1;
    }

    let mut places = Vec::new();
    for (i, r) in df.iter().enumerate() {
        // 목욕탕·사우나가 아닌 곳은 지도에서 뺀다(줄 번호 i는 그대로 두어 다른 곳의 id가 안 바뀐다).
        //   '온천'·'온천 숙박', 그리고 구분이 비어 있는 행안부 자료(시설 미확인)
        let kind = g(r, "구분");
        if kind == "온천" || kind == "온천 숙박" || (kind.is_empty() && g(r, "출처") == "행안부")
        {
            continue;
        }
        let kid = g(r, "카카오ID");
        // 요금: ① 사람이 적은 확인값(onsen_prices.csv) ② 요금 조사 자료의 확인값. 추정값은 확인된 요금과 따로 둔다.
        let mut price = if kid.is_empty() {
            None
        } else {
            prices.get(kid).cloned()
        };
        let mut estimate: Option<Value> = None;
        let nk = keys::name_key(g(r, "이름"));
        let mut hit = tb_addr.get(&(nk.clone(), keys::addr_key(g(r, "주소"))));
        let sk = (nk.clone(), g(r, "시군구").to_string());
        if hit.is_none() && sigungu_count.get(&sk) == Some(&1) {
            hit = tb_sigungu.get(&sk); // 주소가 달라도 같은 시·군·구에 같은 이름이 하나뿐이면 같은 곳
        }
        if let (Some(h), None) = (hit, &price) {
            if h.confirmed {
                price = Some(obj(vec![
                    ("adult", f(h.adult)),
                    ("weekend", Value::Null),
                    ("towel", Value::Null),
                    ("parking", Value::Null),
                    ("child", f(h.child)),
                    ("jjimjil", f(h.jjimjil)),
                    ("none", Value::from(false)),
                    ("memo", Value::from("")),
                    ("source", Value::from("탕방 직접 확인")),
                    ("checked", Value::from(h.checked.clone())),
                ]));
            } else if h.adult.is_some() {
                estimate = Some(obj(vec![
                    ("adult", f(h.adult)),
                    ("child", f(h.child)),
                    ("basis", Value::from(h.basis.clone())),
                    ("checked", Value::from(h.checked.clone())),
                ]));
            }
        }
        let cat = g(r, "분류");
        if price.is_none()
            && estimate.is_none()
            && g(r, "시도") == "서울특별시"
            && kind == "목욕탕·사우나"
            && !["찜질", "한증막"].iter().any(|w| cat.contains(w))
        {
            estimate = Some(obj(vec![
                ("adult", Value::from(SEOUL_REGION_ADULT)),
                ("child", Value::Null),
                ("basis", Value::from(SEOUL_REGION_BASIS)),
                ("checked", Value::from(SEOUL_REGION_CHECKED)),
            ]));
        }
        let has_xy = !g(r, "위도").is_empty() && !g(r, "경도").is_empty();
        let xy = |c: &str| -> Value {
            if has_xy {
                f(util::py_strip(g(r, c)).parse::<f64>().ok())
            } else {
                Value::Null
            }
        };
        let name = g(r, "이름");
        let mut p = vec![
            (
                "id",
                Value::from(if kid.is_empty() {
                    format!("m{i}")
                } else {
                    kid.to_string()
                }),
            ), // 카카오ID가 없는 곳(행안부만)은 줄 번호로
            ("name", Value::from(name)),
            ("addr", Value::from(g(r, "주소"))),
            ("gu", Value::from(g(r, "시군구"))), // 서울 25개 구. 화면의 지역 필터가 쓴다
            ("lat", xy("위도")),
            ("lng", xy("경도")),
            ("tel", Value::from(g(r, "전화"))),
            ("kind", Value::from(kind)),
            ("women_only", Value::from(name.contains("여성"))), // 이름에 '여성'이 든 곳은 여성전용 배지
            ("url", Value::from(g(r, "카카오장소주소"))),
            ("checked_at", Value::from(g(r, "데이터기준일자"))),
            ("source", Value::from(g(r, "출처"))),
            ("price", price.unwrap_or(Value::Null)),
            ("price_estimate", estimate.unwrap_or(Value::Null)),
            // None=조회 안 됨, []=반경 안에 없음
            (
                "parking",
                if kid.is_empty() {
                    Value::Null
                } else {
                    parking
                        .get(kid)
                        .map(|v| Value::Array(v.clone()))
                        .unwrap_or(Value::Null)
                },
            ),
            (
                "parking_radius",
                radius.map(Value::from).unwrap_or(Value::Null),
            ),
        ];
        if let Some(fv) = facts.get(kid) {
            p.push(("facts", fv.clone()));
        }
        if let Some(ph) = photos.get(kid) {
            p.push(("photo", Value::from(ph.clone())));
        }
        places.push(obj(p));
    }
    add_example_prices(&mut places);
    Ok(places)
}

fn main() -> Result<()> {
    let places = build()?;
    let cnt = |pred: &dyn Fn(&Value) -> bool| places.iter().filter(|p| pred(p)).count();
    println!(
        "온천 {}곳 (조건: onsen_merged.csv 전체) / 좌표 없는 곳 {}곳 / 확인된 요금 {}곳 / 추정 요금 {}곳 / 예시 요금(가상, 조건: 확인 요금 없음) {}곳 / 대표 사진 {}곳",
        places.len(),
        cnt(&|p| p["lat"].is_null()),
        cnt(&|p| pyjson::truthy(p.get("price"))),
        cnt(&|p| pyjson::truthy(p.get("price_estimate"))),
        cnt(&|p| p.get("price_example").is_some()),
        cnt(&|p| p.get("photo").is_some()),
    );
    let base_date = places
        .iter()
        .filter_map(|p| p["checked_at"].as_str())
        .max()
        .unwrap_or("")
        .to_string();
    let out = obj(vec![
        ("baseDate", Value::from(base_date)),
        ("places", Value::Array(places)),
    ]);
    util::write_text(OUT, &pyjson::dumps(&out, &pyjson::DEFAULT))?;
    println!("저장: {OUT}");
    println!(
        "출처: 행정안전부 전국 온천이용업소 현황, 서울시 목욕장업 인허가 정보, 카카오 로컬 API"
    );
    Ok(())
}
