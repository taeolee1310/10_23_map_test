//! 공공데이터 '목욕장업 인허가'(LOCALDATA 생활_목욕장업.csv, 전국)와 합친 목록을 맞춰 영업상태·면적을 붙인다.
//! - 원본: data/raw/생활_목욕장업.csv (깃에 안 올림. 지우면 공공데이터포털·LOCALDATA에서 다시 받는다)
//! - 결과: data/collected/license_match.csv (카카오ID마다 한 줄: 맞춘 방법, 관리번호, 영업상태, 폐업일자, 업태, 면적, 욕실수)
//! - 맞추는 순서(확실한 것부터):
//!   1) 관리번호: 인허가에서 온 곳(카카오ID가 'lic' + 관리번호)
//!   2) 주소+이름: 같은 도로명 주소(구 + 길 + 번지)에 같은 이름(괄호·(주)·공백 제거)
//!   3) 주소: 같은 도로명 주소에 영업 중인 곳이 하나뿐일 때(이름이 바뀐 경우가 많다). 판정에는 '확실'만 쓴다
//! - judge_facts가 '확실'(1·2)인데 공공데이터에 폐업으로 나온 곳을 '폐업(공공데이터)'로 뺀다. 면적은 대시보드에서 사람이 본다.
//!
//! 실행(프로젝트 폴더에서): cargo run --release --bin license_check

use anyhow::Result;
use std::collections::HashMap;
use tangbang_data::csvio::{self, g, Dtype, Row};
use tangbang_data::{re, util};

const RAW: &str = "data/raw/생활_목욕장업.csv";
const MERGED: &str = "data/merged/onsen_merged.csv";
const OUT: &str = "data/collected/license_match.csv";
re!(PAREN, r"\(.*?\)");
re!(NAME_JUNK, r"주식회사|\(주\)|\s+");
re!(ROAD, r"^서울\S*\s+(\S+구)\s+(.+?\d+(?:-\d+)?)");
re!(WS, r"\s+");

fn norm_name(s: &str) -> String {
    let s = NAME_JUNK.replace_all(s, "");
    PAREN.replace_all(&s, "").into_owned()
}

/// '서울특별시 종로구 대학로 12 (명륜4가)' → '종로구대학로12'
fn road_key(addr: &str) -> String {
    let s = PAREN.replace_all(addr, "");
    let s = s.split(',').next().unwrap_or("").trim().to_string();
    ROAD.captures(&s).map(|c| format!("{}{}", &c[1], WS.replace_all(&c[2], ""))).unwrap_or_default()
}

fn area(r: &Row) -> f64 {
    g(r, "소재지면적").replace(',', "").trim().parse().unwrap_or(0.0)
}

fn main() -> Result<()> {
    if !util::exists(RAW) {
        println!("⛔ 원본이 없어요: {RAW}. LOCALDATA(공공데이터포털)에서 '목욕장업' 전체 CSV를 받아 이 이름으로 넣어 주세요.");
        return Ok(());
    }
    let (tb, enc) = csvio::read_csv_enc(RAW, true, Dtype::AllStr)?;
    let all = tb.records();
    let seoul: Vec<Row> = all
        .into_iter()
        .filter(|r| {
            let a = if g(r, "도로명주소").trim().is_empty() { g(r, "지번주소") } else { g(r, "도로명주소") };
            a.trim().starts_with("서울")
        })
        .collect();
    // 공공데이터는 매달 새로 나온다. 받은 지 35일이 지났으면 새 파일을 받으라고 알린다(폐업을 놓치지 않게)
    let newest = seoul.iter().map(|r| g(r, "데이터갱신시점").get(0..10).unwrap_or("")).max().unwrap_or("").to_string();
    let got = std::fs::metadata(RAW).and_then(|m| m.modified()).ok().map(|t| {
        chrono::DateTime::<chrono::Utc>::from(t).with_timezone(&chrono::FixedOffset::east_opt(9 * 3600).unwrap()).format("%Y-%m-%d").to_string()
    }).unwrap_or_default();
    println!("공공데이터 기준: 데이터갱신시점 최신 {newest} / 파일 받은 날 {got}");
    if got < util::kst_days_ago(35) {
        println!("⚠ 공공데이터 파일이 35일 넘게 지났어요. LOCALDATA에서 '목욕장업' 최신 CSV를 받아 {RAW}에 덮어써 주세요(매달 갱신).");
    }
    let live = |r: &Row| g(r, "영업상태명").starts_with("영업");
    println!("인허가 원본 {RAW} ({enc}): 서울 {}곳 (영업 중 {}곳, 폐업 {}곳)", seoul.len(), seoul.iter().filter(|r| live(r)).count(), seoul.iter().filter(|r| !live(r)).count());

    let mut by_no: HashMap<&str, &Row> = HashMap::new();
    let mut by_road: HashMap<String, Vec<&Row>> = HashMap::new();
    for r in &seoul {
        by_no.insert(g(r, "관리번호"), r);
        by_road.entry(road_key(g(r, "도로명주소"))).or_default().push(r);
    }

    let merged = csvio::read_csv(MERGED, true, Dtype::AllStr)?.records();
    let cols = ["카카오ID", "이름", "맞춘방법", "확실", "관리번호", "인허가이름", "영업상태", "상세영업상태", "폐업일자", "업태", "면적", "욕실수", "데이터갱신시점"];
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut count: HashMap<&str, usize> = HashMap::new();
    for p in &merged {
        let kid = g(p, "카카오ID");
        let (m, how): (Option<&Row>, &str) = if let Some(r) = kid.strip_prefix("lic").and_then(|no| by_no.get(no)) {
            (Some(r), "관리번호")
        } else {
            let cands: &[&Row] = by_road.get(&road_key(g(p, "주소"))).map(|v| v.as_slice()).unwrap_or(&[]);
            let mut named: Vec<&Row> = cands.iter().copied().filter(|c| norm_name(g(c, "사업장명")) == norm_name(g(p, "이름"))).collect();
            // 같은 이름이 여러 번 인허가를 받았으면(폐업 뒤 다시 개업) 영업 중인 것을 쓴다
            named.sort_by_key(|c| live(c));
            let live_c: Vec<&Row> = cands.iter().copied().filter(|c| live(c)).collect();
            if let Some(r) = named.last() {
                (Some(*r), "주소+이름")
            } else if live_c.len() == 1 {
                (Some(live_c[0]), "주소(영업 중 1곳)")
            } else {
                (None, if cands.is_empty() { "못 맞춤" } else { "주소만 겹침" })
            }
        };
        *count.entry(how).or_default() += 1;
        let sure = matches!(how, "관리번호" | "주소+이름");
        let mut row = vec![kid.to_string(), g(p, "이름").to_string(), how.to_string(), if sure { "확실".into() } else { String::new() }];
        match m {
            Some(r) => row.extend([
                g(r, "관리번호").to_string(),
                g(r, "사업장명").to_string(),
                g(r, "영업상태명").to_string(),
                g(r, "상세영업상태명").to_string(),
                g(r, "폐업일자").to_string(),
                g(r, "업태구분명").to_string(),
                format!("{}", area(r)),
                g(r, "욕실수").to_string(),
                g(r, "데이터갱신시점").to_string(),
            ]),
            None => row.extend(std::iter::repeat_n(String::new(), 9)),
        }
        out.push(row);
    }
    csvio::write_csv(OUT, &cols, &out)?;
    let mut c: Vec<_> = count.into_iter().collect();
    c.sort_by(|a, b| b.1.cmp(&a.1));
    println!("합친 목록 {}곳 맞추기: {}", merged.len(), c.iter().map(|(k, v)| format!("{k} {v}")).collect::<Vec<_>>().join(" / "));
    let closed: Vec<&Vec<String>> = out.iter().filter(|r| r[3] == "확실" && !r[6].is_empty() && !r[6].starts_with("영업")).collect();
    println!("확실히 맞춘 곳 중 공공데이터 폐업·휴업 {}곳 (조건: 맞춘방법 관리번호·주소+이름, 영업상태가 '영업'으로 시작하지 않음)", closed.len());
    for r in &closed {
        println!("  {} → {} {}", r[1], r[6], r[8]);
    }
    println!("→ {OUT}");
    Ok(())
}
