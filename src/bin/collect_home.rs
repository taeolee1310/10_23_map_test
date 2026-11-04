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
//! - --refresh-days N: 수집일이 N일 넘게 지난 곳도 다시 받는다(오래된 곳부터). 다시 받은 페이지가 저장되면 그 곳의 줄을 새 내용으로 바꾼다.
//!
//! 실행(프로젝트 폴더에서): cargo run --release --bin collect_home -- [--gu 강남구] [--limit 3] [--max 150] [--refresh-days 30]
//! 다음 단계: judge_facts → onsen_merge → export_web_data

use anyhow::Result;
use clap::Parser;
use std::collections::HashMap;
use tangbang_data::csvio::{self, g, Dtype, Row};
use tangbang_data::naver::{self, targets, COLS, OUT};
use tangbang_data::util;

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
    /// 수집일이 이 날수보다 오래된 곳은 다시 받는다(없으면 다시 받지 않음)
    #[arg(long)]
    refresh_days: Option<i64>,
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
    let today = util::today_kst();
    let kst = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
    let file_day = |path: &str| -> Option<String> {
        let t = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
        Some(
            chrono::DateTime::<chrono::Utc>::from(t)
                .with_timezone(&kst)
                .format("%Y-%m-%d")
                .to_string(),
        )
    };
    // 다시 받을 기준일: 오늘(KST) − N일. 수집일이 이보다 앞이면 오래된 곳
    let cutoff = a.refresh_days.map(|n| {
        let d = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").unwrap()
            - chrono::Duration::days(n);
        d.format("%Y-%m-%d").to_string()
    });
    let mut index: HashMap<String, usize> = HashMap::new();
    for (i, r) in done.iter().enumerate() {
        index.insert(g(r, "네이버ID").to_string(), i); // 같은 곳이 여러 줄이면 마지막 줄이 기준
    }
    let parse_row = |r: &Row, text: &str, day: String| -> Row {
        let mut row: Row = COLS
            .iter()
            .map(|c| (c.to_string(), String::new()))
            .collect();
        for c in ["카카오ID", "네이버ID", "이름"] {
            row.insert(c.into(), g(r, c).to_string());
        }
        row.insert("수집일".into(), day); // 수집일 = 파일을 저장한 날(KST)
        row.extend(naver::parse(text));
        row.insert("상태".into(), "ok".into());
        row
    };

    let (mut added, mut refreshed, mut bad) = (0, 0, 0);
    let mut todo: Vec<Vec<String>> = Vec::new();
    let mut stale: Vec<(String, Vec<String>)> = Vec::new(); // (수집일, 받을 줄) — 오래된 곳부터 받으려고 모은다
    let new_count = t
        .iter()
        .filter(|r| !index.contains_key(g(r, "네이버ID")))
        .count();
    println!(
        "이어받기: 이미 받은 {}곳, 아직 안 받은 {}곳",
        index.len(),
        new_count
    );
    if let Some(c) = &cutoff {
        println!(
            "다시 받기: 수집일이 {c} 이전인 곳(오늘 {today} 기준 {}일 넘게 지남)",
            a.refresh_days.unwrap()
        );
    }
    for r in &t {
        let nid = g(r, "네이버ID");
        let path = naver::home_file(nid);
        let row_url = vec![
            g(r, "카카오ID").into(),
            nid.into(),
            g(r, "이름").into(),
            naver::home_url(nid),
            path.clone(),
        ];
        if let Some(&i) = index.get(nid) {
            // 이미 받은 곳: 기록보다 새로 저장된 페이지가 있으면 그 내용으로 바꾸고, 오래됐으면 다시 받을 목록에 넣는다
            let old_day = g(&done[i], "수집일").to_string();
            let saved = file_day(&path);
            if let (Some(day), Some(text)) = (saved.clone(), naver::read_page(&path)) {
                if day > old_day {
                    if naver::blocked(&text) {
                        println!("⛔ 캡차·차단 화면이 저장돼 있어요 ({}: {path}). 우회하지 않고 멈춥니다. 파일을 지우고 나중에 다시 받으세요.", g(r, "이름"));
                        return Ok(());
                    }
                    if naver::valid_home(&text) {
                        done[i] = parse_row(r, &text, day);
                        refreshed += 1;
                        println!(
                            "{} 새로 받은 페이지로 바꿈 ({old_day} → {})",
                            g(r, "이름"),
                            g(&done[i], "수집일")
                        );
                        continue;
                    }
                }
            }
            if let Some(c) = &cutoff {
                if old_day.as_str() < c.as_str() {
                    let mut line = row_url;
                    line.push("1".into());
                    stale.push((old_day, line));
                }
            }
            continue;
        }
        let Some(text) = naver::read_page(&path) else {
            let mut line = row_url;
            line.push(String::new());
            todo.push(line);
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
        let day = file_day(&path).unwrap_or_else(|| today.clone());
        done.push(parse_row(r, &text, day));
        index.insert(nid.to_string(), done.len() - 1);
        added += 1;
        println!("{} ok", g(r, "이름"));
    }
    // 새 곳 먼저, 그다음 오래된 곳부터. 합쳐서 --max까지
    stale.sort_by(|x, y| x.0.cmp(&y.0));
    let stale_total = stale.len();
    todo.extend(stale.into_iter().map(|(_, l)| l));
    todo.truncate(a.max);
    if added > 0 || refreshed > 0 {
        csvio::write_rows(OUT, &cols, &done)?;
    }
    csvio::write_csv(
        TODO,
        &[
            "카카오ID",
            "네이버ID",
            "이름",
            "주소",
            "저장할파일",
            "다시받기",
        ],
        &todo,
    )?;
    println!("저장된 페이지에서 추가 {added}곳 · 새 내용으로 바꿈 {refreshed}곳 → {OUT} / 홈 페이지가 아닌 파일 {bad}개");
    println!("ego로 열 곳 {}곳 (새 곳 {new_count} 중 남은 것 + 오래된 곳 {stale_total}, 상한 {}) → {TODO}", todo.len(), a.max);
    Ok(())
}
