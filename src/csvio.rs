//! CSV 읽기·쓰기. 판다스 read_csv/to_csv와 같은 결과가 나오게 맞췄다.
//! - 읽기: utf-8-sig → cp949 순서로 시도. 빈칸(NA)은 빈 글자("")로 둔다.
//! - dtype을 정하지 않은 칸은 판다스처럼 숫자로 추정해, 쓸 때 같은 모양(37.5, 12000.0)이 되게 바꿔 둔다.
//! - 쓰기: utf-8-sig, index 없음, 필요할 때만 따옴표, 줄 끝은 운영체제 기본(윈도우 \r\n).

use anyhow::{anyhow, Context, Result};
use std::collections::HashMap;

use crate::util;

pub type Row = HashMap<String, String>;

pub struct Table {
    pub cols: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// 칸 자료형 정하기. AllStr = dtype=str. Infer(목록) = 목록의 칸만 글자, 나머지는 추정.
#[derive(Clone, Copy)]
pub enum Dtype<'a> {
    AllStr,
    Infer(&'a [&'a str]),
}

const NA_VALUES: &[&str] = &[
    "", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan", "1.#IND", "1.#QNAN",
    "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null",
];

pub fn decode(bytes: &[u8]) -> Result<(String, &'static str)> {
    let b = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(bytes);
    if let Ok(s) = std::str::from_utf8(b) {
        return Ok((s.to_string(), "utf-8-sig"));
    }
    if let Some(s) = encoding_rs::EUC_KR.decode_without_bom_handling_and_without_replacement(bytes) {
        return Ok((s.into_owned(), "cp949"));
    }
    Err(anyhow!("⛔ CSV 인코딩을 읽지 못했어요 (utf-8-sig·cp949 모두 실패)"))
}

/// na_default=true면 판다스 기본 빈칸 표시("", "NA", "nan" 등)를 빈칸으로 본다(keep_default_na=True).
pub fn read_csv(path: &str, na_default: bool, dtype: Dtype) -> Result<Table> {
    Ok(read_csv_enc(path, na_default, dtype)?.0)
}

pub fn read_csv_enc(path: &str, na_default: bool, dtype: Dtype) -> Result<(Table, &'static str)> {
    let bytes = std::fs::read(path).with_context(|| format!("⛔ {path} 파일을 찾지 못했어요"))?;
    let (text, enc) = decode(&bytes)?;
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut recs: Vec<Vec<String>> = Vec::new();
    for r in rdr.records() {
        let r = r.with_context(|| format!("⛔ {path} CSV를 읽지 못했어요"))?;
        if r.len() == 1 && r[0].is_empty() {
            continue; // 빈 줄
        }
        recs.push(r.iter().map(String::from).collect());
    }
    if recs.is_empty() {
        return Ok((Table { cols: vec![], rows: vec![] }, enc));
    }
    let cols = recs.remove(0);
    let n = cols.len();
    let mut na = vec![vec![false; n]; recs.len()];
    let mut rows: Vec<Vec<String>> = Vec::with_capacity(recs.len());
    for (ri, mut r) in recs.into_iter().enumerate() {
        let orig = r.len();
        r.resize(n, String::new());
        for (ci, v) in r.iter_mut().enumerate() {
            if (na_default && NA_VALUES.contains(&v.as_str())) || ci >= orig {
                na[ri][ci] = true;
                v.clear();
            }
        }
        rows.push(r);
    }
    if let Dtype::Infer(str_cols) = dtype {
        for ci in 0..n {
            if str_cols.contains(&cols[ci].as_str()) {
                continue;
            }
            infer_column(&mut rows, &na, ci);
        }
    }
    Ok((Table { cols, rows }, enc))
}

/// 판다스가 숫자 칸으로 읽는 경우, 다시 쓸 때 나오는 모양으로 바꿔 둔다.
fn infer_column(rows: &mut [Vec<String>], na: &[Vec<bool>], ci: usize) {
    crate::re!(INT, r"^[+-]?[0-9]+$");
    let vals: Vec<&str> = rows
        .iter()
        .enumerate()
        .filter(|(ri, _)| !na[*ri][ci])
        .map(|(_, r)| r[ci].as_str())
        .collect();
    if vals.is_empty() {
        return;
    }
    let has_na = vals.len() < rows.len();
    if vals.iter().all(|v| INT.is_match(v) && v.parse::<i64>().is_ok()) {
        for (ri, r) in rows.iter_mut().enumerate() {
            if na[ri][ci] {
                continue;
            }
            let i: i64 = r[ci].parse().unwrap();
            r[ci] = if has_na { util::py_float(i as f64) } else { i.to_string() };
        }
    } else if vals.iter().all(|v| util::parse_num(v).is_some() && util::py_strip(v) == *v) {
        for (ri, r) in rows.iter_mut().enumerate() {
            if na[ri][ci] {
                continue;
            }
            r[ci] = util::py_float(util::parse_num(&r[ci]).unwrap());
        }
    }
}

impl Table {
    pub fn empty(cols: &[&str]) -> Table {
        Table { cols: cols.iter().map(|s| s.to_string()).collect(), rows: vec![] }
    }

    pub fn ci(&self, c: &str) -> Result<usize> {
        self.cols
            .iter()
            .position(|x| x == c)
            .ok_or_else(|| anyhow!("⛔ 칸 '{c}'이(가) 없어요 (있는 칸: {})", self.cols.join(", ")))
    }

    pub fn records(&self) -> Vec<Row> {
        self.rows
            .iter()
            .map(|r| self.cols.iter().cloned().zip(r.iter().cloned()).collect())
            .collect()
    }
}

/// r["칸"] — 칸이 없으면 멈춘다(판다스 KeyError와 같음).
pub fn g<'a>(r: &'a Row, c: &str) -> &'a str {
    match r.get(c) {
        Some(v) => v.as_str(),
        None => panic!("⛔ 칸 '{c}'이(가) 없어요"),
    }
}

/// r.get("칸", "")
pub fn get<'a>(r: &'a Row, c: &str) -> &'a str {
    r.get(c).map(|v| v.as_str()).unwrap_or("")
}

fn quote(field: &str) -> String {
    if field.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

pub const LINE: &str = if cfg!(windows) { "\r\n" } else { "\n" };

/// 판다스 to_csv(index=False, encoding="utf-8-sig")와 같은 모양으로 쓴다.
pub fn write_csv<S: AsRef<str>>(path: &str, cols: &[S], rows: &[Vec<String>]) -> Result<()> {
    util::ensure_parent(path)?;
    let mut out = String::from("\u{feff}");
    let line = |fields: Vec<&str>, out: &mut String| {
        if fields.len() == 1 && fields[0].is_empty() {
            out.push_str("\"\"");
        } else {
            let q: Vec<String> = fields.iter().map(|f| quote(f)).collect();
            out.push_str(&q.join(","));
        }
        out.push_str(LINE);
    };
    line(cols.iter().map(|c| c.as_ref()).collect(), &mut out);
    for r in rows {
        line(r.iter().map(|s| s.as_str()).collect(), &mut out);
    }
    std::fs::write(path, out).with_context(|| format!("⛔ {path}에 쓰지 못했어요"))?;
    Ok(())
}

/// 줄(Row)들을 정해진 칸 순서로 쓴다. 없는 칸은 빈칸.
pub fn write_rows<S: AsRef<str>>(path: &str, cols: &[S], rows: &[Row]) -> Result<()> {
    let body: Vec<Vec<String>> = rows
        .iter()
        .map(|r| cols.iter().map(|c| get(r, c.as_ref()).to_string()).collect())
        .collect();
    write_csv(path, cols, &body)
}

/// 판다스 concat처럼 앞 칸 순서를 지키고 새 칸은 뒤에 붙인다.
pub fn union_cols(a: &[String], b: &[&str]) -> Vec<String> {
    let mut out = a.to_vec();
    for c in b {
        if !out.iter().any(|x| x == c) {
            out.push(c.to_string());
        }
    }
    out
}
