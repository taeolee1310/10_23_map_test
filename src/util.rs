//! 작은 공용 함수: 파이썬과 같은 숫자 표기·공백 처리·한국 시간.

use std::io::{self, BufRead, Write};
use std::path::Path;

pub fn exists(p: &str) -> bool {
    Path::new(p).exists()
}

/// 오늘 날짜(KST, YYYY-MM-DD). 한국은 서머타임이 없어 +9시간 고정.
pub fn today_kst() -> String {
    let kst = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
    chrono::Utc::now()
        .with_timezone(&kst)
        .format("%Y-%m-%d")
        .to_string()
}

/// 오늘(KST)에서 n일 전 날짜 'YYYY-MM-DD'
pub fn kst_days_ago(n: i64) -> String {
    (chrono::NaiveDate::parse_from_str(&today_kst(), "%Y-%m-%d").unwrap() - chrono::Duration::days(n))
        .format("%Y-%m-%d")
        .to_string()
}

/// 양질의 정보 기준(사용자 지침 2026-11-04): 후기·블로그(사진 속 요금 같은 정보 포함)는 최근 1년(오늘 KST에서 365일) 안의 것만 쓴다
pub const FRESH_DAYS: i64 = 365;
pub fn fresh_from() -> String {
    kst_days_ago(FRESH_DAYS)
}

/// 네이버 업체 사진 주소의 올린 날: 'https://ldb-phinf.pstatic.net/20200606_5/...' → '2020-06-06'. 못 읽으면 None(오래된 것으로 본다)
pub fn photo_posted(url: &str) -> Option<String> {
    let seg = url.split("pstatic.net/").nth(1)?.get(0..8)?;
    if !seg.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(format!("{}-{}-{}", &seg[0..4], &seg[4..6], &seg[6..8]))
}

/// 파이썬 str.isspace()와 같은 공백 판정.
pub fn is_py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// 파이썬 s.strip()
pub fn py_strip(s: &str) -> &str {
    s.trim_matches(is_py_space)
}

/// 파이썬 s.split() (공백 여러 개를 하나로)
pub fn py_split(s: &str) -> Vec<&str> {
    s.split(is_py_space).filter(|x| !x.is_empty()).collect()
}

/// 파이썬 s[:n] (글자 수 기준)
pub fn take_chars(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

pub fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// 파이썬 repr(float)와 같은 표기 (12000.0, 37.5012345, 1e-05).
pub fn py_float(f: f64) -> String {
    if f.is_nan() {
        return "nan".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "inf".into() } else { "-inf".into() };
    }
    let a = f.abs();
    if a != 0.0 && !(1e-4..1e16).contains(&a) {
        let s = format!("{:e}", f);
        let (m, e) = s.split_once('e').unwrap();
        let ei: i32 = e.parse().unwrap();
        return format!("{}e{}{:02}", m, if ei < 0 { '-' } else { '+' }, ei.abs());
    }
    let s = format!("{}", f);
    if s.contains('.') {
        s
    } else {
        format!("{}.0", s)
    }
}

/// 파이썬 json.dumps가 쓰는 실수 표기 (NaN, Infinity 포함).
pub fn json_float(f: f64) -> String {
    if f.is_nan() {
        "NaN".into()
    } else if f.is_infinite() {
        if f > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        }
    } else {
        py_float(f)
    }
}

/// 판다스 to_numeric이 숫자로 읽는 글자만 숫자로 (쉼표·글자는 None).
pub fn parse_num(s: &str) -> Option<f64> {
    crate::re!(NUM, r"^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$");
    let t = py_strip(s);
    if NUM.is_match(t) {
        t.parse().ok()
    } else {
        None
    }
}

/// 파이썬 input(prompt)
pub fn input(prompt: &str) -> String {
    print!("{prompt}");
    io::stdout().flush().ok();
    let mut s = String::new();
    io::stdin().lock().read_line(&mut s).ok();
    s.trim_end_matches(['\r', '\n']).to_string()
}

/// 파이썬 dict 출력 모양 {'a': 1, 'b': 2}
pub fn dict_repr(pairs: &[(String, usize)]) -> String {
    let inner: Vec<String> = pairs.iter().map(|(k, v)| format!("'{k}': {v}")).collect();
    format!("{{{}}}", inner.join(", "))
}

/// 판다스 value_counts: 많은 순, 같으면 먼저 나온 순.
pub fn value_counts<'a>(vals: impl IntoIterator<Item = &'a str>) -> Vec<(String, usize)> {
    let mut order: Vec<(String, usize)> = Vec::new();
    for v in vals {
        match order.iter_mut().find(|(k, _)| k == v) {
            Some(e) => e.1 += 1,
            None => order.push((v.to_string(), 1)),
        }
    }
    order.sort_by(|a, b| b.1.cmp(&a.1));
    order
}

/// 파이썬 open(path, "w", encoding="utf-8")처럼 쓴다. 윈도우에서는 줄바꿈이 \r\n이 된다.
pub fn write_text(path: &str, content: &str) -> anyhow::Result<()> {
    ensure_parent(path)?;
    let body = if cfg!(windows) {
        content.replace('\n', "\r\n")
    } else {
        content.to_string()
    };
    std::fs::write(path, body)?;
    Ok(())
}

pub fn ensure_parent(path: &str) -> anyhow::Result<()> {
    if let Some(p) = Path::new(path).parent() {
        if !p.as_os_str().is_empty() {
            std::fs::create_dir_all(p)?;
        }
    }
    Ok(())
}
