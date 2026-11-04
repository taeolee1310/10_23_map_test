//! 카카오 키워드 장소 검색 (수업 연습, React 화면과 무관).
//! 실행: cargo run --release --bin place

use tangbang_data::{kakao, util};

fn main() {
    kakao::load_env();
    let query = util::py_strip(&util::input("검색어: ")).to_string();
    let places = match kakao::search_place(&query, 5) {
        Ok(p) => p,
        Err(e) => {
            println!("{e}");
            std::process::exit(1);
        }
    };
    if places.is_empty() {
        println!("'{query}'을(를) 찾지 못했어요");
    }
    for (i, p) in places.iter().enumerate() {
        println!(
            "{}. {} | {} | ({}, {})",
            i + 1,
            p.name,
            p.addr,
            util::py_float(p.lat),
            util::py_float(p.lng)
        );
    }
    println!("출처: 카카오 로컬 API (키워드로 장소 검색)");
}
