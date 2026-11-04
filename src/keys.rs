//! 같은 곳인지 비교할 때 쓰는 이름·주소 열쇠와 시·도 이름.

use crate::util;

crate::re!(NAME_JUNK, r"\(.*?\)|㈜|주식회사|\s");
crate::re!(PAREN_WS, r"\(.*?\)|\s");

/// 이름 비교용: 괄호·㈜·주식회사·공백을 뺀다.
pub fn name_key(s: &str) -> String {
    NAME_JUNK.replace_all(s, "").into_owned()
}

/// 주소 비교용(괄호·공백을 뺀 글자).
pub fn key_addr(s: &str) -> String {
    PAREN_WS.replace_all(s, "").into_owned()
}

/// 시·도 표기가 달라도(경기/경기도) 같게 비교하려고 첫 토큰을 빼고, 괄호·공백도 뺀다.
pub fn addr_key(addr: &str) -> String {
    let t = util::py_split(addr);
    let rest = if t.len() > 1 {
        t[1..].join(" ")
    } else {
        String::new()
    };
    key_addr(&rest)
}

/// 주소에서 시·군·구 ('창원시 의창구'처럼 시 아래 구가 있으면 둘 다). 토큰이 하나뿐이면 빈 글자.
pub fn sigungu_addr(addr: &str) -> String {
    let t = util::py_split(addr);
    if t.len() > 2 && t[1].ends_with('시') && t[2].ends_with('구') {
        return format!("{} {}", t[1], t[2]);
    }
    t.get(1).map(|s| s.to_string()).unwrap_or_default()
}

/// 토큰 목록에서 시·군·구. 토큰이 둘보다 적으면 멈춘다(파이썬 IndexError와 같음).
pub fn sigungu_of(tokens: &[&str]) -> String {
    if tokens.len() >= 3 && tokens[1].ends_with('시') && tokens[2].ends_with('구') {
        return format!("{} {}", tokens[1], tokens[2]);
    }
    match tokens.get(1) {
        Some(t) => t.to_string(),
        None => panic!("⛔ 주소에 시·군·구가 없어요: {}", tokens.join(" ")),
    }
}

/// 약칭 → 정식 시·도 이름. ("남구" 같은 부분 일치를 막으려고 정식 이름으로 맞춘다)
pub fn sido(first: &str) -> String {
    let full = match first {
        "서울" => "서울특별시",
        "부산" => "부산광역시",
        "대구" => "대구광역시",
        "인천" => "인천광역시",
        "광주" => "광주광역시",
        "대전" => "대전광역시",
        "울산" => "울산광역시",
        "세종" => "세종특별자치시",
        "경기" => "경기도",
        "강원" | "강원도" => "강원특별자치도",
        "충북" => "충청북도",
        "충남" => "충청남도",
        "전북" | "전라북도" => "전북특별자치도",
        "전남" => "전라남도",
        "경북" => "경상북도",
        "경남" => "경상남도",
        "제주" => "제주특별자치도",
        other => other,
    };
    full.to_string()
}
