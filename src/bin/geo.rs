//! 주소 → 좌표 → 주소 (카카오 로컬 API, 수업 연습, React 화면과 무관).
//! 실행: cargo run --release --bin geo

use tangbang_data::{kakao, util};

/// 주소 → (위도, 경도). 못 찾으면 None.
fn address_to_coord(address: &str) -> Result<Option<(f64, f64)>, String> {
    let docs = kakao::docs(&kakao::get(
        kakao::ADDRESS,
        &[("query", address.to_string())],
    )?);
    let Some(d) = docs.first() else {
        return Ok(None);
    };
    let (lat, lng) = (kakao::coord(d, "y")?, kakao::coord(d, "x")?); // y=위도, x=경도 (글자 → 숫자)
    if !kakao::in_korea(lat, lng) {
        return Err("⛔ 한국 밖 좌표가 나왔어요. 위도·경도 순서를 확인해 주세요".into());
    }
    Ok(Some((lat, lng)))
}

/// (위도, 경도) → 도로명 주소. 도로명이 없으면 지번 주소. 못 찾으면 None.
fn coord_to_address(lat: f64, lng: f64) -> Result<Option<String>, String> {
    if !kakao::in_korea(lat, lng) {
        return Err("⛔ 한국 밖 좌표예요. 위도·경도 순서를 확인해 주세요".into());
    }
    // 요청은 x=경도, y=위도
    let v = kakao::get(
        kakao::COORD2ADDRESS,
        &[("x", util::py_float(lng)), ("y", util::py_float(lat))],
    )?;
    let docs = kakao::docs(&v);
    let Some(d) = docs.first() else {
        return Ok(None);
    };
    let road = d
        .get("road_address")
        .filter(|r| tangbang_data::pyjson::truthy(Some(r))); // 도로명은 null일 수 있다
    let name = match road {
        Some(r) => r["address_name"].as_str(),
        None => d["address"]["address_name"].as_str(),
    };
    Ok(name.map(String::from))
}

fn run() -> Result<(), String> {
    let address = util::py_strip(&util::input("주소: ")).to_string();
    let Some((lat, lng)) = address_to_coord(&address)? else {
        println!("'{address}'을(를) 찾지 못했어요");
        std::process::exit(0);
    };
    println!(
        "1) 주소 → 좌표: (위도 {}, 경도 {})",
        util::py_float(lat),
        util::py_float(lng)
    );
    match coord_to_address(lat, lng)? {
        None => println!("2) 좌표 → 주소: 이 좌표의 주소를 찾지 못했어요"),
        Some(back) => println!("2) 좌표 → 주소: {back}"),
    }
    Ok(())
}

fn main() {
    kakao::load_env();
    if let Err(e) = run() {
        println!("{e}");
        std::process::exit(1);
    }
    println!("출처: 카카오 로컬 API (주소→좌표, 좌표→주소)");
}
