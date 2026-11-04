//! 행안부 온천 목록(onsen_official_clean.csv)과 카카오 온천 목록(onsen_clean.csv)을 합쳐 data/merged/onsen_merged.csv로 저장한다.
//!
//! 같은 곳 판단: ① 주소(괄호·공백 뺀 글자)가 같거나 ② 시군구가 같고 이름(괄호·(주) 뺀 글자)이 같을 때.
//! 같은 곳이면 이름·주소·시도는 행안부 것, 좌표·구분·카카오 정보는 카카오 것을 쓴다.
//! 행안부에만 있는 곳은 좌표가 비어 있다. (카카오로 채우는 건 30줄 한도 규칙이 있어 따로 한다)
//! 실행: cargo run --release --bin onsen_merge

use anyhow::Result;
use std::collections::{HashMap, HashSet};
use tangbang_data::csvio::{self, g, get, Dtype, Row};
use tangbang_data::{keys, util};

const OFFICIAL: &str = "data/collected/onsen_official_clean.csv";
const KAKAO: &str = "data/collected/onsen_clean.csv";
const SEOUL_BATH: &str = "data/collected/seoul_bath_clean.csv"; // 선택. 없으면 온천만 합친다
const SEOUL_LICENSE: &str = "data/collected/seoul_bath_license_clean.csv"; // 선택. 서울시 인허가에만 있는 목욕탕
const OUT: &str = "data/merged/onsen_merged.csv";
const EXCLUDE: &str = "data/curated/naver_notfound_exclude.csv"; // 네이버 플레이스에서 못 찾아 뺀 곳 (이름+주소로 맞춤)
const EXCLUDE_REVIEWED: &str = "data/curated/excluded.csv"; // 폐업·피트니스·마사지 중심이라 뺀 곳 (judge_facts가 추가만 한다)

const COLUMNS: [&str; 13] = [
    "이름",
    "시도",
    "시군구",
    "주소",
    "위도",
    "경도",
    "전화",
    "구분",
    "분류",
    "카카오ID",
    "카카오장소주소",
    "출처",
    "데이터기준일자",
];

fn read(path: &str) -> Result<Vec<Row>> {
    Ok(csvio::read_csv(path, false, Dtype::Infer(&["카카오ID"]))?.records())
}

fn sort(df: &mut [Row]) {
    df.sort_by(|a, b| {
        (g(a, "시도"), g(a, "시군구"), g(a, "이름")).cmp(&(
            g(b, "시도"),
            g(b, "시군구"),
            g(b, "이름"),
        ))
    });
}

fn prepare_kakao(k: &mut [Row]) {
    for r in k.iter_mut() {
        let addr = g(r, "주소").to_string();
        let tokens = util::py_split(&addr);
        let sido = keys::sido(tokens.first().copied().unwrap_or(""));
        let sgg = keys::sigungu_of(&tokens);
        let rest = tokens[1..].join(" ");
        r.insert("주소".into(), format!("{sido} {rest}"));
        r.insert("시도".into(), sido);
        r.insert("시군구".into(), sgg);
    }
}

fn merge(o: &[Row], mut k: Vec<Row>) -> Vec<Row> {
    prepare_kakao(&mut k);
    let mut by_addr: HashMap<String, usize> = HashMap::new();
    let mut by_name: HashMap<(String, String), usize> = HashMap::new();
    for (idx, r) in k.iter().enumerate() {
        by_addr.insert(keys::key_addr(g(r, "주소")), idx); // 같은 주소가 여럿이면 마지막
        by_name
            .entry((g(r, "시군구").to_string(), keys::name_key(g(r, "이름"))))
            .or_insert(idx);
    }

    let mut used = HashSet::new();
    let mut rows = Vec::new();
    for r in o {
        let mut idx = by_addr.get(&keys::key_addr(g(r, "주소"))).copied();
        if idx.is_none() {
            idx = by_name
                .get(&(g(r, "시군구").to_string(), keys::name_key(g(r, "이름"))))
                .copied();
        }
        if idx.is_some_and(|i| used.contains(&i)) {
            idx = None; // 카카오 한 곳이 행안부 두 곳에 붙지 않게 한다
        }
        let mut row = Row::new();
        for c in ["이름", "시도", "시군구", "주소", "전화", "데이터기준일자"] {
            row.insert(c.into(), get(r, c).to_string());
        }
        for c in ["위도", "경도", "구분", "분류", "카카오ID", "카카오장소주소"] {
            row.insert(c.into(), String::new());
        }
        row.insert("출처".into(), "행안부".into());
        if let Some(i) = idx {
            used.insert(i);
            let kr = &k[i];
            for c in ["위도", "경도", "구분", "분류", "카카오ID", "카카오장소주소"]
            {
                row.insert(c.into(), g(kr, c).to_string());
            }
            if g(r, "전화").is_empty() {
                row.insert("전화".into(), g(kr, "전화").to_string());
            }
            row.insert("출처".into(), "행안부+카카오".into());
        }
        rows.push(row);
    }
    for (idx, kr) in k.iter().enumerate() {
        if !used.contains(&idx) {
            let mut row: Row = COLUMNS
                .iter()
                .filter(|c| **c != "출처")
                .map(|c| (c.to_string(), g(kr, c).to_string()))
                .collect();
            row.insert("출처".into(), "카카오".into());
            rows.push(row);
        }
    }
    sort(&mut rows);
    rows
}

fn main() -> Result<()> {
    let (o, k) = (read(OFFICIAL)?, read(KAKAO)?);
    println!("행안부 {}곳, 카카오 {}곳", o.len(), k.len());
    let mut df = merge(&o, k);
    for (path, source) in [(SEOUL_BATH, "카카오"), (SEOUL_LICENSE, "서울시 인허가")] {
        // 카카오ID가 이미 있는 곳은 넘긴다
        if util::exists(path) {
            let have: HashSet<String> = df.iter().map(|r| g(r, "카카오ID").to_string()).collect();
            let sb: Vec<Row> = read(path)?
                .into_iter()
                .filter(|r| !have.contains(g(r, "카카오ID")))
                .collect();
            let n = sb.len();
            for mut r in sb {
                r.insert("출처".into(), source.into());
                let row: Row = COLUMNS
                    .iter()
                    .map(|c| (c.to_string(), g(&r, c).to_string()))
                    .collect();
                df.push(row);
            }
            sort(&mut df);
            println!("{path}에서 {n}곳 추가");
        }
    }
    for path in [EXCLUDE, EXCLUDE_REVIEWED] {
        if util::exists(path) {
            let ex: HashSet<String> = read(path)?
                .iter()
                .map(|r| format!("{}|{}", g(r, "이름"), g(r, "주소")))
                .collect();
            let before = df.len();
            df.retain(|r| !ex.contains(&format!("{}|{}", g(r, "이름"), g(r, "주소"))));
            println!(
                "{path}에 있어서 뺀 곳 {}곳 (조건: 이름+주소 일치)",
                before - df.len()
            );
        }
    }
    df.retain(|r| g(r, "주소").starts_with("서울")); // 서비스는 서울만 (멘토 피드백)
    println!("({}, {})", df.len(), COLUMNS.len());
    println!(
        "출처별 (조건: 합친 전체): {}",
        util::dict_repr(&util::value_counts(df.iter().map(|r| g(r, "출처"))))
    );
    let has_xy = df.iter().filter(|r| !g(r, "위도").is_empty()).count();
    println!(
        "좌표 있는 곳: {} / 좌표 없는 곳: {}",
        has_xy,
        df.len() - has_xy
    );
    println!(
        "시도별: {}",
        util::dict_repr(&util::value_counts(df.iter().map(|r| g(r, "시도"))))
    );
    csvio::write_rows(OUT, &COLUMNS, &df)?;
    println!("저장: {OUT}");
    println!("출처: 행정안전부 전국 온천이용업소 현황(기준일 2026-08-27), 카카오 로컬 API");
    Ok(())
}
