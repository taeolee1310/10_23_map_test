//! 네이버 플레이스 사진 탭에서 '업체 등록 사진' 후보 주소를 모은다(이미지 파일은 받지 않는다).
//! 사진 고르기(탕방 데이터 수집 도구 '사진 고르기' 탭)에서 사람이 대표 사진을 고르면 data/curated/place_photos.csv에 들어간다.
//! - 방문자가 올린 사진(placeReview)은 사람 얼굴·저작권 문제로 쓰지 않는다. 업체가 등록한 사진(business_N)만.
//! - collect_home과 같은 두 단계: 1) 받을 목록 data/collected/naver_photo_todo.csv
//!   2) ego(scripts/ego_fetch.mjs)가 사진 탭을 열어 업체 사진 주소를 data/collected/naver_pages/photo/<네이버ID>.json에 저장
//!   3) 다시 돌리면 읽어서 data/collected/naver_photo_candidates.jsonl(곳마다 한 줄)을 고친다.
//! - 사진은 올린 날로 거르지 않는다(내외부 확인용). 주소의 날짜(ldb-phinf.pstatic.net/YYYYMMDD_…) 순으로 최근 것부터 둔다.
//! - 대상: 후보 줄이 없는 곳, 예전 방식으로 받았는데 0장인 곳(한 번 다시), --refresh-days N이면 N일 지난 곳.
//!
//! 실행(프로젝트 폴더에서): cargo run --release --bin collect_photos -- [--max 150] [--refresh-days 30]

use anyhow::Result;
use clap::Parser;
use serde_json::{json, Value};
use std::collections::HashMap;
use tangbang_data::csvio::{self, g};
use tangbang_data::naver::{targets, PAGES};
use tangbang_data::util;

const OUT: &str = "data/collected/naver_photo_candidates.jsonl";
const TODO: &str = "data/collected/naver_photo_todo.csv";
const VIA: &str = "collect_photos";

#[derive(Parser)]
struct Args {
    #[arg(long, default_value_t = 150)]
    max: usize,
    #[arg(long)]
    refresh_days: Option<i64>,
}

fn photo_url(naver_id: &str) -> String {
    format!("https://m.place.naver.com/place/{naver_id}/photo")
}
fn photo_file(naver_id: &str) -> String {
    format!("{PAGES}/photo/{naver_id}.json")
}

/// 사진을 올린 날(주소의 날짜) 최근 순으로. 날짜를 못 읽으면 뒤로
fn newest_first(mut v: Vec<Value>) -> Vec<Value> {
    v.sort_by_key(|p| std::cmp::Reverse(util::photo_posted(p["url"].as_str().unwrap_or("")).unwrap_or_default()));
    v
}

fn main() -> Result<()> {
    let a = Args::parse();
    let t = targets(None, None)?;
    let today = util::today_kst();
    let cutoff = a.refresh_days.map(|n| {
        (chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").unwrap() - chrono::Duration::days(n))
            .format("%Y-%m-%d")
            .to_string()
    });
    let file_time = |p: &str| -> Option<chrono::DateTime<chrono::Utc>> {
        Some(std::fs::metadata(p).ok()?.modified().ok()?.into())
    };

    let total = |v: &Value| v["photos"].as_array().map_or(0, |p| p.len());
    let mut rows: Vec<Value> = std::fs::read_to_string(OUT)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    // 사진은 내외부를 보는 용도라 올린 날로 거르지 않는다(사용자 결정 2026-11-04). 고르기에서 최근 사진이 먼저 보이게 정렬만 한다
    let mut moved = 0;
    for v in rows.iter_mut() {
        let mut all: Vec<Value> = v["photos"].as_array().cloned().unwrap_or_default();
        all.extend(v["oldPhotos"].as_array().cloned().unwrap_or_default());
        let sorted = newest_first(all);
        if v.get("oldPhotos").is_some() || v["photos"].as_array() != Some(&sorted) {
            moved += 1;
        }
        v["photos"] = Value::from(sorted);
        if let Some(o) = v.as_object_mut() {
            o.remove("oldPhotos");
        }
    }
    let mut index: HashMap<String, usize> = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        index.insert(r["naverId"].as_str().unwrap_or("").to_string(), i);
    }
    println!(
        "사진 후보 기록 {}곳 / 대상 {}곳 (오늘 {today}, 한국 시간)",
        index.len(),
        t.len()
    );

    let (mut added, mut replaced, mut bad, mut kept) = (0, 0, 0, 0);
    let mut todo: Vec<Vec<String>> = Vec::new();
    let mut again: Vec<(String, Vec<String>)> = Vec::new();
    for r in &t {
        let nid = g(r, "네이버ID");
        let path = photo_file(nid);
        let line = |re: bool| {
            vec![
                g(r, "카카오ID").to_string(),
                nid.to_string(),
                g(r, "이름").to_string(),
                photo_url(nid),
                path.clone(),
                if re { "1".into() } else { String::new() },
            ]
        };
        // 저장된 파일: {"valid":true,"photos":[{"url","w","h"}]}
        let saved: Option<(Value, chrono::DateTime<chrono::Utc>)> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(s.trim_start_matches('\u{feff}')).ok())
            .zip(file_time(&path));
        let make = |v: &Value, at: &chrono::DateTime<chrono::Utc>| {
            json!({
                "kakaoId": g(r, "카카오ID"), "naverId": nid, "name": g(r, "이름"),
                "photos": newest_first(v["photos"].as_array().cloned().unwrap_or_default()),
                "fetchedAt": at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true), "via": VIA,
            })
        };
        let usable = |v: &Value| v["valid"] == true;
        match index.get(nid).copied() {
            Some(i) => {
                let old_at = rows[i]["fetchedAt"].as_str().unwrap_or("").to_string();
                if let Some((v, at)) = &saved {
                    if usable(v) && at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true) > old_at
                    {
                        // 새로 받은 후보가 예전보다 적으면(페이지를 덜 읽었을 수 있음) 바꾸지 않는다. 사람이 고를 후보를 잃지 않게
                        let old_n = total(&rows[i]);
                        let new_n = v["photos"].as_array().map_or(0, |p| p.len());
                        if new_n >= old_n {
                            rows[i] = make(v, at);
                            replaced += 1;
                        } else {
                            kept += 1;
                            println!("{} 새 후보 {new_n}장이 예전 {old_n}장보다 적어 예전 후보를 그대로 둠", g(r, "이름"));
                        }
                        continue;
                    }
                }
                let empty_old = rows[i]["via"] != VIA
                    && total(&rows[i]) == 0;
                let stale = cutoff
                    .as_ref()
                    .is_some_and(|c| old_at.get(0..10).unwrap_or("") < c.as_str());
                if empty_old || stale {
                    again.push((old_at, line(true)));
                }
            }
            None => match &saved {
                Some((v, at)) if usable(v) => {
                    rows.push(make(v, at));
                    index.insert(nid.to_string(), rows.len() - 1);
                    added += 1;
                }
                Some(_) => bad += 1,
                None => todo.push(line(false)),
            },
        }
    }
    again.sort_by(|x, y| x.0.cmp(&y.0));
    let (new_n, again_n) = (todo.len(), again.len());
    todo.extend(again.into_iter().map(|(_, l)| l));
    todo.truncate(a.max);
    if added > 0 || replaced > 0 || moved > 0 {
        let body: String = rows.iter().map(|v| format!("{v}\n")).collect();
        std::fs::write(OUT, body)?;
    }
    // --max 0은 '읽기만'. 받을 목록은 그대로 둔다
    if a.max > 0 {
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
    }
    let with: usize = rows
        .iter()
        .filter(|v| v["photos"].as_array().is_some_and(|p| !p.is_empty()))
        .count();
    println!("저장된 사진 페이지에서 추가 {added}곳 · 새 내용으로 바꿈 {replaced}곳 · 적어서 예전 것 유지 {kept}곳 · 읽을 수 없는 파일 {bad}개 → {OUT}");
    println!("사진 후보가 있는 곳 {with}곳 / 기록 {}곳", rows.len());
    println!(
        "ego로 열 곳 {}곳 (새 곳 {new_n} + 다시 볼 곳 {again_n}, 상한 {}) → {TODO}",
        todo.len(),
        a.max
    );
    Ok(())
}
