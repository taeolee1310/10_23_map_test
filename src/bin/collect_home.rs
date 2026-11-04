//! 네이버 플레이스 홈 페이지에서 TOP3(수건·세신·드라이기)와 보조 정보 근거를 모은다.
//! 페이지는 ego 브라우저가 연다(러스트는 브라우저를 띄우지 않는다). 절차는 data/README.md의 '네이버 수집'.
//!
//! 1) 이 도구를 돌리면 아직 안 받은 곳을 data/collected/naver_home_todo.csv에 적는다(주소·저장할 파일 이름).
//! 2) ego 브라우저로 목록의 페이지를 하나씩 열어 scripts/naver_page_text.js 결과를 '저장할 파일'에 저장한다.
//!    곳당 10초 간격, 한 번에 150곳, 캡차·차단이 보이거나 3번 연속 비면 멈춘다(우회하지 않는다).
//! 3) 다시 돌리면 저장된 페이지를 읽어 data/collected/naver_home_facts.csv에 추가한다(이어받기).
//! - 대상: data/merged/onsen_merged.csv 중 네이버ID가 있는 곳 (naver_places.csv + curated/naver_match_manual.csv)
//! - 방문자 리뷰는 작성자 이름·원문을 저장하지 않고, 키워드가 든 문장만 '방문자리뷰(날짜없음)'으로 남긴다.
//!
//! 실행(프로젝트 폴더에서): cargo run --release --bin collect_home -- [--gu 강남구] [--limit 3] [--max 150]
//! 다음 단계: judge_facts → onsen_merge → export_web_data

use anyhow::Result;
use clap::Parser;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use tangbang_data::csvio::{self, g, Dtype, Row};
use tangbang_data::naver::{self, COLS, OUT};
use tangbang_data::{pysort, util};

const TODO: &str = "data/collected/naver_home_todo.csv";

#[derive(Parser)]
struct Args {
    #[arg(long)]
    gu: Option<String>,
    #[arg(long)]
    limit: Option<usize>,
    /// 한 번에 ego로 열 곳 수 상한
    #[arg(long, default_value_t = 150)]
    max: usize,
}

fn read(path: &str) -> Result<Vec<Row>> {
    Ok(csvio::read_csv(path, true, Dtype::AllStr)?.records())
}

fn targets(gu: Option<&str>, limit: Option<usize>) -> Result<Vec<Row>> {
    let m = read("data/merged/onsen_merged.csv")?;
    let n = read("data/collected/naver_places.csv")?;
    let mm = read("data/curated/naver_match_manual.csv")?;
    let pairs: Vec<(String, String)> = n
        .iter()
        .chain(mm.iter())
        .map(|r| (g(r, "카카오ID").to_string(), g(r, "네이버ID").to_string()))
        .filter(|(k, v)| !k.is_empty() && !v.is_empty())
        .collect();
    let map: HashMap<String, String> = pysort::keep_first(pairs, |p| p.0.clone()).into_iter().collect();
    let mut t: Vec<Row> = m
        .iter()
        .filter_map(|r| {
            map.get(g(r, "카카오ID")).map(|nid| {
                let mut r = r.clone();
                r.insert("네이버ID".into(), nid.clone());
                r
            })
        })
        .collect();
    let ex_path = "data/collected/excluded_candidates.csv";
    if util::exists(ex_path) {
        let sure: HashSet<String> =
            read(ex_path)?.iter().filter(|r| g(r, "확신") == "확실").map(|r| g(r, "카카오ID").to_string()).collect();
        println!("제외 후보(확실) {}곳은 수집에서 뺌", sure.len());
        t.retain(|r| !sure.contains(g(r, "카카오ID")));
    }
    println!("목록 {}곳 중 네이버ID 있음 {}곳 (없는 {}곳은 건너뜀)", m.len(), t.len(), m.len() as i64 - t.len() as i64);
    if let Some(gu) = gu {
        let re = Regex::new(gu)?;
        t.retain(|r| re.is_match(g(r, "주소")));
        println!("조건: 주소에 '{gu}' 포함 → {}곳", t.len());
    }
    if let Some(l) = limit.filter(|l| *l > 0) {
        t.truncate(l);
    }
    Ok(t)
}

fn main() -> Result<()> {
    let a = Args::parse();
    let t = targets(a.gu.as_deref(), a.limit)?;
    let (cols, mut done) = if util::exists(OUT) {
        let tb = csvio::read_csv(OUT, true, Dtype::AllStr)?;
        (csvio::union_cols(&tb.cols, COLS), tb.records())
    } else {
        (COLS.iter().map(|s| s.to_string()).collect(), vec![])
    };
    let seen: HashSet<String> = done.iter().map(|r| g(r, "네이버ID").to_string()).collect();
    let t: Vec<Row> = t.into_iter().filter(|r| !seen.contains(g(r, "네이버ID"))).collect();
    println!("이어받기: 이미 받은 {}곳 제외 → 남은 {}곳", seen.len(), t.len());

    let today = util::today_kst();
    let (mut added, mut bad) = (0, 0);
    let mut todo: Vec<Vec<String>> = Vec::new();
    for r in &t {
        let nid = g(r, "네이버ID");
        let path = naver::home_file(nid);
        let Some(text) = naver::read_page(&path) else {
            if todo.len() < a.max {
                todo.push(vec![g(r, "카카오ID").into(), nid.into(), g(r, "이름").into(), naver::home_url(nid), path]);
            }
            continue;
        };
        if naver::blocked(&text) {
            // 캡차 화면을 저장한 것이다. 기록하지 않고 멈춘다(ego 수집도 여기서 멈춰야 한다)
            println!("⛔ 캡차·차단 화면이 저장돼 있어요 ({}: {path}). 우회하지 않고 멈춥니다. 파일을 지우고 나중에 다시 받으세요.", g(r, "이름"));
            return Ok(());
        }
        if !naver::valid_home(&text) {
            println!("건너뜀 {} (홈 페이지가 아님: {path})", g(r, "이름"));
            bad += 1;
            continue;
        }
        let mut row: Row = COLS.iter().map(|c| (c.to_string(), String::new())).collect();
        for c in ["카카오ID", "네이버ID", "이름"] {
            row.insert(c.into(), g(r, c).to_string());
        }
        // 수집일 = 파일을 저장한 날(KST). 알 수 없으면 오늘
        let day = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| {
                let kst = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
                chrono::DateTime::<chrono::Utc>::from(t).with_timezone(&kst).format("%Y-%m-%d").to_string()
            })
            .unwrap_or_else(|_| today.clone());
        row.insert("수집일".into(), day);
        row.extend(naver::parse(&text));
        row.insert("상태".into(), "ok".into());
        done.push(row);
        added += 1;
        println!("{} ok", g(r, "이름"));
    }
    if added > 0 {
        csvio::write_rows(OUT, &cols, &done)?;
    }
    csvio::write_csv(TODO, &["카카오ID", "네이버ID", "이름", "주소", "저장할파일"], &todo)?;
    println!("저장된 페이지에서 추가 {added}곳 → {OUT} / 홈 페이지가 아닌 파일 {bad}개");
    println!("ego로 열 곳 {}곳 (상한 {}) → {TODO}", todo.len(), a.max);
    Ok(())
}
