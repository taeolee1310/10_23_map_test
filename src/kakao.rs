//! 카카오 로컬 REST. REST 키는 여기서만 환경 변수로 읽고, 요청 주소·헤더·응답 원문은 출력하지 않는다.

use serde_json::Value;
use std::time::Duration;

use crate::util;

// 🔌 API 주소는 여기 한 곳에만
pub const KEYWORD: &str = "https://dapi.kakao.com/v2/local/search/keyword.json";
pub const ADDRESS: &str = "https://dapi.kakao.com/v2/local/search/address.json";
pub const COORD2ADDRESS: &str = "https://dapi.kakao.com/v2/local/geo/coord2address.json";

/// .env를 읽는다 (파이썬 load_dotenv(override=True)와 같음). 값은 출력하지 않는다.
pub fn load_env() {
    let _ = dotenvy::dotenv_override();
}

pub fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

/// 카카오 REST 호출 공통 부분. 키·연결 문제는 '⛔'로 시작하는 한국어 한 줄.
pub fn get(url: &str, params: &[(&str, String)]) -> Result<Value, String> {
    let key = env("KAKAO_REST_API_KEY").ok_or("⛔ .env에 KAKAO_REST_API_KEY 값을 넣어 주세요")?;
    let offline = "⛔ 카카오에 연결하지 못했어요. 인터넷을 확인해 주세요".to_string();
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| offline.clone())?;
    // 🔌 API 호출
    let res = client
        .get(url)
        .header("Authorization", format!("KakaoAK {key}"))
        .query(params)
        .send()
        .map_err(|_| offline.clone())?;
    match res.status().as_u16() {
        200 => {}
        401 => return Err("⛔ 카카오 REST API 키가 틀렸어요".into()),
        403 => return Err("⛔ 카카오맵 사용 설정을 켜 주세요".into()),
        c => return Err(format!("⛔ 카카오 응답 오류예요 (코드 {c})")),
    }
    res.json::<Value>().map_err(|_| "⛔ 카카오 응답을 읽지 못했어요".to_string())
}

pub fn in_korea(lat: f64, lng: f64) -> bool {
    (33.0..=39.0).contains(&lat) && (124.0..=132.0).contains(&lng)
}

pub fn docs(v: &Value) -> Vec<Value> {
    v.get("documents").and_then(|d| d.as_array()).cloned().unwrap_or_default()
}

/// 카카오 응답의 글자 좌표를 숫자로 (x=경도, y=위도).
pub fn coord(d: &Value, k: &str) -> Result<f64, String> {
    d.get(k)
        .and_then(|v| v.as_str())
        .and_then(|s| util::py_strip(s).parse().ok())
        .ok_or_else(|| "⛔ 카카오 응답에 좌표가 없어요".to_string())
}

fn s<'a>(d: &'a Value, k: &str) -> &'a str {
    d.get(k).and_then(|v| v.as_str()).unwrap_or("")
}

#[derive(Clone)]
pub struct Place {
    pub name: String,
    pub addr: String,
    pub lat: f64,
    pub lng: f64,
}

/// 카카오 키워드 장소 검색. 한국 밖 좌표는 버린다.
pub fn search_place(query: &str, size: usize) -> Result<Vec<Place>, String> {
    let v = get(KEYWORD, &[("query", query.to_string()), ("size", size.to_string())])?;
    let mut out = Vec::new();
    for d in docs(&v) {
        let (lat, lng) = (coord(&d, "y")?, coord(&d, "x")?); // y=위도, x=경도 (글자 → 숫자)
        if !in_korea(lat, lng) {
            continue;
        }
        let road = s(&d, "road_address_name");
        out.push(Place {
            name: s(&d, "place_name").to_string(),
            addr: if road.is_empty() { s(&d, "address_name") } else { road }.to_string(), // 도로명이 비면 지번
            lat,
            lng,
        });
    }
    Ok(out)
}
