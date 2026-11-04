//! 행정안전부 전국 온천이용업소 현황(원본 CSV)을 서비스에서 쓰기 좋게 정리해 data/collected/onsen_official_clean.csv로 저장한다.
//! 좌표는 원본에 없다. 카카오로 채우는 일은 하루 30줄 한도 규칙이 있어 여기서 하지 않는다.
//! 실행: cargo run --release --bin onsen_official

use anyhow::Result;
use std::collections::HashSet;
use tangbang_data::csvio::{self, Dtype};
use tangbang_data::{keys, re, util};

const RAW: &str = "data/raw/행정안전부_전국 온천이용업소 현황_20260827.csv";
const OUT: &str = "data/collected/onsen_official_clean.csv";
const BASE_DATE: &str = "2026-08-27"; // 파일 이름의 기준일 (20260827)

// 일반인이 이용하는 온천이 아닌 기관(시청·병원·연수원 등). 이름에 이 말이 들면 뺀다.
re!(INSTITUTION, r"시청|군청|병원|의료재단|대학교|연수원|수련원|인재원|협동조합|복지회|자산관리");
const KEEP_NAMES: &[&str] = &["문화온천(현대병원)"]; // 이름에 '병원'이 들었지만 온천 목욕탕이라 남긴다
re!(NAME_TAIL, r"(\))[^)]+$");

const COLS: [&str; 6] = ["이름", "시도", "시군구", "주소", "전화", "데이터기준일자"];

fn main() -> Result<()> {
    let (raw, enc) = csvio::read_csv_enc(RAW, true, Dtype::Infer(&[]))?;
    println!("읽은 인코딩: {enc}");
    let na: Vec<(String, usize)> = raw
        .cols
        .iter()
        .enumerate()
        .map(|(i, c)| (c.clone(), raw.rows.iter().filter(|r| r[i].is_empty()).count()))
        .collect();
    println!("({}, {}) 빈칸: {}", raw.rows.len(), raw.cols.len(), util::dict_repr(&na));

    let (ni, ai, pi) = (raw.ci("업소(기관명)")?, raw.ci("주소")?, raw.ci("대표전화")?);
    let mut rows: Vec<[String; 6]> = Vec::new();
    for r in &raw.rows {
        let name = util::py_strip(&r[ni]).to_string();
        let tokens = util::py_split(util::py_strip(&r[ai]));
        let sido = keys::sido(tokens.first().copied().unwrap_or(""));
        let sgg = keys::sigungu_of(&tokens);
        // 시·도를 정식 이름으로 바꾼 주소. ')' 뒤에 붙은 업소 이름 꼬리("(망상동)동해약천…")는 자른다.
        let addr = NAME_TAIL.replace_all(&tokens[1..].join(" "), "${1}").into_owned();
        let phone = util::py_strip(&r[pi]);
        let phone = if phone.starts_with("010") { "" } else { phone }; // 개인 휴대폰은 뺀다
        rows.push([name, sido.clone(), sgg, format!("{sido} {addr}"), phone.to_string(), BASE_DATE.to_string()]);
    }

    let before = rows.len();
    let mut seen = HashSet::new();
    rows.retain(|r| seen.insert((r[0].clone(), r[3].clone())));
    println!("이름+주소가 같은 중복 {}줄 제거", before - rows.len());

    let is_inst = |r: &[String; 6]| INSTITUTION.is_match(&r[0]) && !KEEP_NAMES.contains(&r[0].as_str());
    // 지금은 없는 행정구역: 진해시(창원시 진해구로 통합), 구 없는 '창원시', 대구로 넘어간 경북 군위군
    let is_old = |r: &[String; 6]| r[2] == "진해시" || r[2] == "창원시" || (r[1] == "경상북도" && r[2] == "군위군");
    let inst: Vec<&str> = rows.iter().filter(|r| is_inst(r)).map(|r| r[0].as_str()).collect();
    let old: Vec<&str> = rows.iter().filter(|r| is_old(r) && !is_inst(r)).map(|r| r[0].as_str()).collect();
    println!("기관 {}곳 제외: {}", inst.len(), inst.join(", "));
    println!("옛 행정구역 {}곳 제외: {}", old.len(), old.join(", "));
    rows.retain(|r| !(is_inst(r) || is_old(r)));
    rows.sort_by(|a, b| (&a[1], &a[2], &a[0]).cmp(&(&b[1], &b[2], &b[0])));

    let empty_phone = rows.iter().filter(|r| r[4].is_empty()).count();
    println!("({}, 6) 빈칸(전화 빈 글자 포함): {{'전화': {empty_phone}}}", rows.len());
    println!("시도별 업소 수 (조건: 이름+주소 중복 제거 후 전체)");
    for (k, v) in util::value_counts(rows.iter().map(|r| r[1].as_str())) {
        println!("{k}    {v}");
    }

    let body: Vec<Vec<String>> = rows.into_iter().map(|r| r.to_vec()).collect();
    csvio::write_csv(OUT, &COLS, &body)?;
    println!("저장: {OUT} (기준일 {BASE_DATE})");
    println!("출처: 행정안전부 전국 온천이용업소 현황 (공공데이터포털)");
    Ok(())
}
