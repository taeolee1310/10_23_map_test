//! naver-crawl이 모은 업체별 JSON을 탕방용 CSV 한 장으로 정리한다. (수집이 아니라 정리 단계)
//!
//!   입력: C:/Users/user/naver-crawl/out/<업체ID>.json  (원자료, 이 도구는 읽기만 한다)
//!   출력: data/collected/naver_places.csv  (네이버ID 하나당 1줄, 같은 장소는 1줄로)
//!
//! 중복이 생기지 않게 하는 규칙
//!   1) 네이버ID가 열쇠. 같은 ID는 가장 늦게 수집한 1건만 쓴다.
//!   2) 서로 다른 ID라도 이름+주소가 같으면 같은 장소로 보고 1줄만 남긴다(광고·분점 중복 방지).
//!   3) 서울 주소가 아닌 곳은 뺀다.
//!   4) 탕방 목록(onsen_merged.csv)의 카카오ID에 붙일 때 일대일만 허용한다.
//!      한 카카오ID에 여러 네이버 줄이 걸리면 붙이지 않고 '충돌'로 센다(데이터가 두 번 읽히지 않게).
//! 실행: cargo run --release --bin naver_import

use anyhow::Result;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use tangbang_data::csvio::{self, g, Dtype, Row};
use tangbang_data::{keys, pyjson, pysort, re, util};

const SRC: &str = "C:/Users/user/naver-crawl/out";
const MERGED: &str = "data/merged/onsen_merged.csv";
const OUT: &str = "data/collected/naver_places.csv";
const MANUAL: &str = "data/curated/naver_match_manual.csv";
const SKIP: [&str; 2] = ["index.json", "queue.json"];
re!(PHONE, r"0\d{1,2}-?\d{3,4}-?\d{4}"); // 글 속 번호는 지운다
re!(ROAD, r"(\S+구)\s+(\S+(?:로|길)(?:\d+길)?)\s+(\d+(?:-\d+)?)");
re!(ID_FILE, r"^\d+\.json$");

const COLS: [&str; 10] = [
    "네이버ID",
    "이름",
    "주소",
    "결제수단",
    "편의시설",
    "가격표항목수",
    "가격표이미지만",
    "세신·수건·결제 관련 글",
    "수집일",
    "카카오ID",
];

/// 주소를 '구|도로명|번지'까지만 줄여 비교한다. 네이버 주소 뒤의 층·건물명·'지도내비게이션' 같은 군더더기를 버린다.
fn addr_id(addr: &str) -> String {
    match ROAD.captures(addr) {
        Some(c) => format!("{}|{}|{}", &c[1], &c[2], &c[3]),
        None => keys::addr_key(addr),
    }
}

fn load() -> Result<Vec<Value>> {
    let mut rows = Vec::new();
    // 파이썬 glob과 같은 순서(폴더가 돌려주는 순서)
    for e in std::fs::read_dir(SRC)? {
        let p = e?.path();
        let b = p
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if !b.ends_with(".json")
            || SKIP.contains(&b.as_str())
            || b.starts_with("probe")
            || !ID_FILE.is_match(&b)
        {
            continue;
        }
        rows.push(pyjson::load_file(p.to_str().unwrap())?);
    }
    Ok(rows)
}

fn str_or_empty(v: Option<&Value>) -> String {
    if pyjson::truthy(v) {
        pyjson::py_str(v.unwrap())
    } else {
        String::new()
    }
}

fn flat(r: &Value) -> Row {
    let mut hints: Vec<String> = Vec::new();
    for tab in ["home", "information", "review/visitor"] {
        if let Some(list) = r
            .get("hints")
            .and_then(|h| h.get(tab))
            .and_then(|l| l.as_array())
        {
            for h in list {
                let t = PHONE.replace_all(&pyjson::py_str(h), "").into_owned();
                let t = util::py_strip(&t).to_string();
                if !hints.contains(&t) {
                    hints.push(t); // 순서 유지하며 중복 제거
                }
            }
        }
    }
    let list = |k: &str| {
        r.get(k)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    let amenities: Vec<String> = list("amenities").iter().map(pyjson::py_str).collect();
    let mut row = Row::new();
    row.insert("네이버ID".into(), pyjson::py_str(&r["id"]));
    row.insert("이름".into(), str_or_empty(r.get("name")));
    row.insert("주소".into(), str_or_empty(r.get("address")));
    row.insert("결제수단".into(), str_or_empty(r.get("payment")));
    row.insert("편의시설".into(), amenities.join(" | "));
    row.insert("가격표항목수".into(), list("prices").len().to_string());
    row.insert(
        "가격표이미지만".into(),
        if pyjson::truthy(r.get("price_image_only")) {
            "True"
        } else {
            "False"
        }
        .into(),
    );
    row.insert("세신·수건·결제 관련 글".into(), hints.join(" / "));
    row.insert(
        "수집일".into(),
        util::take_chars(&str_or_empty(r.get("collectedAt")), 10).to_string(),
    );
    row
}

/// 판다스 sort_values("수집일"). 판다스 3의 글자 칸은 안정 정렬이라 같은 날짜끼리는 읽은 순서를 지킨다.
fn sort_by_date(mut df: Vec<Row>) -> Vec<Row> {
    df.sort_by(|a, b| g(a, "수집일").cmp(g(b, "수집일")));
    df
}

fn main() -> Result<()> {
    let raw = load()?;
    println!("읽은 업체 JSON {}개 (조건: {SRC}/숫자.json)", raw.len());
    let df: Vec<Row> = raw.iter().map(flat).collect();
    println!("shape ({}, 9) / 빈칸 0", df.len());

    let n0 = df.len();
    let df = pysort::keep_last(sort_by_date(df), |r| g(r, "네이버ID").to_string());
    println!("같은 네이버ID 중복 제거: {}줄", n0 - df.len());

    let n1 = df.len();
    let df: Vec<Row> = df
        .into_iter()
        .filter(|r| g(r, "주소").starts_with("서울"))
        .collect();
    println!("서울 아닌 주소 제외: {}줄", n1 - df.len());

    let k_of = |r: &Row| format!("{}|{}", keys::name_key(g(r, "이름")), addr_id(g(r, "주소")));
    let n2 = df.len();
    let mut df = pysort::keep_last(sort_by_date(df), k_of);
    println!("이름+주소 같은 다른 ID 제거: {}줄", n2 - df.len());

    // 탕방 목록에 일대일로 붙이기
    let m = csvio::read_csv(MERGED, false, Dtype::AllStr)?.records();
    let mut key2id: HashMap<String, HashSet<String>> = HashMap::new();
    for r in &m {
        key2id
            .entry(k_of(r))
            .or_default()
            .insert(g(r, "카카오ID").to_string());
    }
    for r in df.iter_mut() {
        let kid = match key2id.get(&k_of(r)) {
            Some(s) if s.len() == 1 => s.iter().next().unwrap().clone(),
            _ => String::new(),
        };
        r.insert("카카오ID".into(), kid);
    }
    // 이름 표기만 달라 자동으로 못 붙은 곳: 사람이 확인한 짝을 붙인다. 이미 붙은 곳은 건드리지 않는다.
    let man = csvio::read_csv(MANUAL, true, Dtype::AllStr)?.records();
    let mut taken: HashSet<String> = df
        .iter()
        .map(|r| g(r, "카카오ID").to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut n_man = 0;
    for mr in &man {
        let (kid, nid) = (g(mr, "카카오ID").to_string(), g(mr, "네이버ID"));
        let hit: Vec<usize> = (0..df.len())
            .filter(|&i| g(&df[i], "네이버ID") == nid && !nid.is_empty())
            .collect();
        if !taken.contains(&kid)
            && !hit.is_empty()
            && hit.iter().all(|&i| g(&df[i], "카카오ID").is_empty())
        {
            for &i in &hit {
                df[i].insert("카카오ID".into(), kid.clone());
            }
            if !kid.is_empty() {
                taken.insert(kid);
            }
            n_man += 1;
        }
    }
    println!("사람이 확인한 짝으로 추가로 붙음 {n_man}줄 (조건: {MANUAL})");
    let mut count: HashMap<String, usize> = HashMap::new();
    for r in &df {
        let k = g(r, "카카오ID");
        if !k.is_empty() {
            *count.entry(k.to_string()).or_default() += 1;
        }
    }
    let clash: HashSet<String> = count
        .into_iter()
        .filter(|(_, n)| *n > 1)
        .map(|(k, _)| k)
        .collect();
    for r in df.iter_mut() {
        if clash.contains(g(r, "카카오ID")) {
            r.insert("카카오ID".into(), String::new());
        }
    }
    let attached = df.iter().filter(|r| !g(r, "카카오ID").is_empty()).count();
    println!(
        "탕방 목록과 일대일로 붙음 {attached}줄 / 못 붙음 {}줄 / 충돌로 보류 {}곳",
        df.len() - attached,
        clash.len()
    );

    let ids: HashSet<&str> = df.iter().map(|r| g(r, "네이버ID")).collect();
    let kids: Vec<&str> = df
        .iter()
        .map(|r| g(r, "카카오ID"))
        .filter(|s| !s.is_empty())
        .collect();
    assert!(
        ids.len() == df.len() && kids.iter().collect::<HashSet<_>>().len() == kids.len(),
        "⛔ 중복이 남았어요"
    );
    csvio::write_rows(OUT, &COLS, &df)?;
    let has = df
        .iter()
        .filter(|r| !g(r, "세신·수건·결제 관련 글").is_empty())
        .count();
    let pay = df.iter().filter(|r| !g(r, "결제수단").is_empty()).count();
    println!(
        "저장: {OUT} {}줄 (관련 글이 있는 곳 {has}곳, 결제수단이 있는 곳 {pay}곳)",
        df.len()
    );
    Ok(())
}
