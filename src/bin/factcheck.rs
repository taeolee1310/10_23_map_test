//! AI가 알려 준 가게 목록(이름 | 주소)이 카카오에 실제로 있는지 판정한다 (수업 연습, React 화면과 무관).
//! 실행: cargo run --release --bin factcheck -- [동네] [파일]   (기본 파일 taste10.txt)

use regex::Regex;
use std::time::Duration;
use tangbang_data::kakao::{self, Place};
use tangbang_data::{re, util};

const FILE: &str = "taste10.txt";
const SIZE: usize = 15; // 카카오 키워드 검색 한 번에 가져올 수 있는 최대 개수

re!(PAREN, r"\s*\([^)]*\)");
re!(LEAD_NUM, r"^\s*\d+\s*[.)]\s*");
re!(SEP_LINE, r"^[\s|:\-]+$");
re!(LOCATION, r"^\s*[•\-*]?\s*(위치|주소)\s*[:：]\s*(.+)$");
re!(NOT_WORD, r"[^0-9a-zA-Z가-힣*]");
re!(ROAD_ANY, r"(동|가|로|길)\d*길?$");
re!(ROAD_ONLY, r"(로|길)\d*길?$");
re!(HANGUL, r"^[가-힣]+");

/// 괄호 설명 (강남역 3번 출구 인근) 은 비교에 방해라서 뗀다.
fn clean(text: &str) -> String {
    util::py_strip(&PAREN.replace_all(text, "")).to_string()
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_numeric())
}

/// '1. 가**름 | 서울 강남구 ...' 또는 표 줄에서 (이름, 주소)를 꺼낸다. 못 읽으면 None.
fn parse_line(line: &str) -> Option<(String, String)> {
    let line = LEAD_NUM.replace(util::py_strip(line), "").into_owned(); // 줄 앞 번호 1. 2) 떼기
    if line.is_empty() || SEP_LINE.is_match(&line) {
        return None; // 빈 줄, | --- | 구분선
    }
    let cells: Vec<&str> = line.split('|').map(util::py_strip).filter(|c| !c.is_empty() && !is_digits(c)).collect();
    if cells.len() < 2 || ["이름", "가게", "가게명", "식당"].contains(&cells[0]) {
        return None; // 머리글 줄은 건너뜀
    }
    Some((cells[0].to_string(), cells[1].to_string()))
}

/// ① 한 줄: '가**름 | 주소'  ② 목록: '• 가게이름' 다음 줄들 중 '• 위치: 주소'
fn parse_text(lines: &[&str]) -> Vec<(String, String)> {
    let mut rows = Vec::new();
    let mut name: Option<String> = None;
    for raw in lines {
        let first = raw.chars().next();
        if matches!(first, Some('•' | '-' | '*')) {
            // 맨 앞 글머리 = 가게 이름 줄
            name = Some(clean(util::py_strip(&raw[first.unwrap().len_utf8()..])));
            continue;
        }
        if let (Some(m), Some(n)) = (LOCATION.captures(raw), name.as_ref()) {
            rows.push((n.clone(), clean(&m[2])));
            name = None;
            continue;
        }
        if let Some((a, b)) = parse_line(raw) {
            rows.push((clean(&a), clean(&b)));
        }
    }
    rows
}

/// 띄어쓰기·&·점·괄호 같은 기호를 없애고 소문자로 맞춘다. (*는 남긴다)
fn norm(text: &str) -> String {
    NOT_WORD.replace_all(text, "").to_lowercase()
}

/// 기호·띄어쓰기를 무시하고 이름 비교. 가운데 *는 아무 글자 하나로 본다.
fn same_name(want: &str, found: &str) -> bool {
    let (want, found) = (norm(want), norm(found));
    let pattern: Vec<String> = want.split('*').map(regex::escape).collect();
    Regex::new(&format!("^(?:{})", pattern.join("."))).map(|re| re.is_match(&found)).unwrap_or(false)
}

/// 주소 첫 단어(서울특별시/서울)는 표기가 달라서 뺀다.
fn address_tokens(addr: &str) -> Vec<&str> {
    util::py_split(addr).into_iter().skip(1).collect()
}

/// 구가 같고, 동(길) 이름이 찾은 주소 안에 있으면 true.
fn same_address(want: &str, found: &str) -> bool {
    let (want_t, found_t) = (address_tokens(want), address_tokens(found));
    let gu = want_t.iter().find(|t| t.ends_with('구')).copied();
    if let Some(g) = gu {
        if !found_t.contains(&g) {
            return false;
        }
    }
    if let Some(road) = want_t.iter().find(|t| Some(**t) != gu && ROAD_ANY.is_match(t)) {
        let stem = HANGUL.find(road).map(|m| m.as_str()).unwrap_or(""); // '강남대로96길' -> '강남대로'
        return found_t.join(" ").contains(stem);
    }
    gu.is_some()
}

/// 도로명(예: 강남대로102길)이 통째로 같으면 true. 도로명이 없는 주소는 false.
fn same_road_address(want: &str, found: &str) -> bool {
    let (want_t, found_t) = (address_tokens(want), address_tokens(found));
    match want_t.iter().find(|t| ROAD_ONLY.is_match(t)) {
        Some(road) => found_t.contains(road),
        None => false,
    }
}

/// 이름 첫 단어(상호)가 찾은 이름 안에 있으면 true. 예: 무월식탁 강남점 ~ 무월식탁 강남본점.
fn similar_name(want: &str, found: &str) -> bool {
    let core = norm(util::py_split(want).first().copied().unwrap_or("")).replace('*', "");
    core.chars().count() >= 2 && norm(found).contains(&core)
}

/// (판정, 찾은 곳 이름, 찾은 곳 주소)
fn judge(area: &str, name: &str, addr: &str) -> Result<(&'static str, String, String), String> {
    let places = kakao::search_place(&format!("{area} {name}"), SIZE)?;
    let same: Vec<&Place> = places.iter().filter(|p| same_name(name, &p.name)).collect();
    if same.is_empty() {
        // 이름이 조금 달라도(지점명 등) 상호가 비슷하고 도로명 주소가 같으면 🟡
        for p in &places {
            if similar_name(name, &p.name) && same_road_address(addr, &p.addr) {
                return Ok(("🟡", p.name.clone(), p.addr.clone()));
            }
        }
        return Ok(("❌", String::new(), String::new()));
    }
    for p in &same {
        if same_address(addr, &p.addr) {
            return Ok(("✅", p.name.clone(), p.addr.clone()));
        }
    }
    Ok(("🟡", same[0].name.clone(), same[0].addr.clone()))
}

fn main() {
    kakao::load_env();
    let args: Vec<String> = std::env::args().collect();
    let area = match args.get(1) {
        Some(a) => a.clone(),
        None => util::py_strip(&util::input("동네(예: 서울특별시 강남구, 그냥 Enter면 주소에서 읽음): ")).to_string(),
    };
    let path = args.get(2).cloned().unwrap_or_else(|| FILE.to_string());
    let Ok(text) = std::fs::read_to_string(&path) else {
        println!("⛔ {path} 파일을 찾지 못했어요");
        std::process::exit(1);
    };
    let text = text.trim_start_matches('\u{feff}');
    let lines: Vec<&str> = text.lines().collect();
    let rows = parse_text(&lines);
    if rows.is_empty() {
        println!("⛔ {path}에서 읽을 줄이 없어요. '가**름 | 주소' 또는 '• 이름 / • 위치: 주소' 모양으로 채워 주세요");
        std::process::exit(1);
    }

    let (mut ok, mut maybe, mut no) = (0usize, 0usize, 0usize);
    println!("동네: {} / 검사할 가게: {}개\n", if area.is_empty() { "주소에서 읽음" } else { &area }, rows.len());
    for (i, (name, addr)) in rows.iter().enumerate() {
        let a = if area.is_empty() { util::py_split(addr).into_iter().take(2).collect::<Vec<_>>().join(" ") } else { area.clone() };
        let (mark, found_name, found_addr) = match judge(&a, name, addr) {
            Ok(x) => x,
            Err(e) => {
                println!("{e}");
                std::process::exit(1);
            }
        };
        match mark {
            "✅" => ok += 1,
            "🟡" => maybe += 1,
            _ => no += 1,
        }
        println!("{}. {mark} {name} | AI 주소: {addr}", i + 1);
        if mark == "🟡" {
            println!("      카카오에 있는 곳: {found_name} | {found_addr}");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let total = rows.len();
    let wrong = maybe + no;
    let pct = (wrong as f64 / total as f64 * 100.0).round_ties_even();
    println!("\n✅ {ok}개 / 🟡 {maybe}개 / ❌ {no}개 (전체 {total}개)");
    println!("AI 실수율(🟡+❌): {wrong}/{total} = {pct:.0}%");
    println!("판정 기준: 이름이 같고 구·동(길)이 맞으면 ✅, 이름은 같은데 주소가 다르거나 상호·도로명만 같으면 🟡, 못 찾으면 ❌");
    println!("출처: 카카오 로컬 API (키워드로 장소 검색)");
}
