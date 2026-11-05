//! 블로그 원문 사진(간판·안내문·가격표)에 적힌 글자를 Claude Code(`claude -p`)가 보고 읽어, 정해진 칸으로 남긴다.
//! 사진만 보고도 알 수 있는 정보(예: 루하스사우나 입구 안내판 '25년 11월 1일부터 야간 영업 안 함, 6시~23시')를 놓치지 않으려는 것이다(사용자 지침 2026-11-04).
//!
//! - 읽는 것: data/collected/naver_blogs.jsonl의 postImages(collect_reviews --kind blog가 원문과 함께 남긴 사진 파일·글 작성일)
//! - 대상: 글 작성일이 최근 1년(util::FRESH_DAYS) 안이고, 아직 읽지 않은 사진
//! - 2단계 읽기(사용자 결정 2026-11-04): 1) 사진이 3장 이상인 글은 사진을 작게 줄여 바둑판 한 장(3열, 12칸까지)으로 모으고,
//!   Claude가 글자 있는 칸(간판·안내문·가격표)만 고른다. 고르지 않은 사진은 바로 지운다. 2) 고른 사진(과 1~2장짜리 글의 사진)만 원래 크기로 읽는다.
//!   한 번에 바둑판 --max-sheets장(기본 30), 크게 읽기 --max장(기본 40), 같은 곳 사진 16장씩, 바둑판 8장씩 묶어 보낸다
//! - 결과: data/collected/photo_text.jsonl (사진마다 한 줄: 파일, 카카오ID, 날짜, 영업 시작·마감, 찜질 마감, 입장료, 안내, 다른 가게 사진 여부)
//! - Claude에게는 Read 도구만 허용한다(파일을 고치거나 인터넷을 열지 않음). 사진에 분명히 적힌 글자만 적고 추측하지 않게 한다.
//!   목욕탕이 아닌 다른 가게(같은 건물 미용실 등) 안내는 other_business로 표시해 판정에서 뺀다. 사람 얼굴·개인정보는 적지 않는다.
//! - judge_facts가 이 파일을 후기·블로그 문장과 같은 규칙(최근 1년, 가장 최근 요금, 등록보다 이른 마감)으로 쓴다.
//! - 읽은 뒤 쓸모없는 사진(글자 없음·목욕탕 정보 없음·다른 가게 사진)은 이미지 파일을 지운다. 읽은 결과 한 줄은 남겨 다시 읽지 않는다.
//! - Claude를 부를 때마다 쓴 토큰·비용을 data/collected/claude_usage.jsonl에 한 줄씩 남긴다(수집 도구 대시보드 'Claude 사용량').
//! - claude가 없으면 안내만 하고 넘어간다(수집 도구 '직접 실행'에서도 멈추지 않게).
//!
//! 실행(프로젝트 폴더에서): cargo run --release --bin read_photo_text -- [--max 40] [--max-sheets 30]

use anyhow::Result;
use clap::Parser;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Write;
use std::process::{Command, Stdio};
use tangbang_data::util;

const BLOGS: &str = "data/collected/naver_blogs.jsonl";
const OUT: &str = "data/collected/photo_text.jsonl";
const USAGE: &str = "data/collected/claude_usage.jsonl";
const PHOTO_DIR: &str = "data/collected/naver_pages/blogimg";
/// 한 번 부를 때 크게 읽을 사진 수(부를 때마다 드는 고정 비용을 나누려고 넉넉히)
const BATCH: usize = 16;
/// 한 장의 바둑판에 모을 사진 수(3열 × 4줄)
const SHEET_TILES: usize = 12;
const SHEET_COLS: u32 = 3;
const CELL: u32 = 300;
const PAD: u32 = 8;

#[derive(Parser)]
struct Args {
    /// 한 번에 원래 크기로 읽을 사진 수 상한(Claude 사용량)
    #[arg(long, default_value_t = 40)]
    max: usize,
    /// 한 번에 만들 바둑판 수 상한(바둑판 1장 = 사진 12장까지)
    #[arg(long, default_value_t = 30)]
    max_sheets: usize,
}

struct Img {
    kid: String,
    name: String,
    file: String,
    date: String,
    stem: String,
}

fn claude() -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", "claude"]);
        c
    } else {
        Command::new("claude")
    }
}

fn prompt(name: &str, files: &[String]) -> String {
    format!(
        "너는 목욕탕 지도 서비스 '탕방'의 사진 판독 담당이다. 아래 사진 파일을 Read 도구로 하나씩 열어 보고, 서울의 목욕탕 '{name}'에 대해 사진에 **글자로 분명히 적힌** 정보만 읽는다.\n\
         사진마다 JSON 한 줄만 출력한다(설명·코드블록 없이). 형식:\n\
         {{\"file\":\"<받은 경로 그대로>\",\"useful\":true|false,\"other_business\":true|false,\"open\":\"HH:MM\"|null,\"close\":\"HH:MM\"|null,\"jjimjil_close\":\"HH:MM\"|null,\"adult\":정수|null,\"child\":정수|null,\"jjimjil\":정수|null,\"notices\":[\"짧은 사실\"]}}\n\
         규칙:\n\
         - 글자가 없거나 목욕탕 이용 정보가 아니면 useful false, 나머지 null·빈 목록.\n\
         - 같은 건물의 다른 가게(속눈썹·미용실·식당·헬스 등) 안내나 가격표면 other_business true, 나머지 null.\n\
         - open·close는 목욕탕 전체 영업 시작·끝(24시 표기는 \"24:00\"), jjimjil_close는 찜질방만 따로 끝나는 시간.\n\
         - adult는 대인(성인) 목욕 입장료, child는 소인, jjimjil은 찜질 포함 요금. 원 단위 정수. 세신·회원권·물품 값은 넣지 않는다.\n\
         - notices는 요일·기간·변경 같은 안내를 20자 안팎 사실 문장으로 최대 3개(예: \"2025-11-01부터 야간 영업 안 함\", \"매주 화요일 휴무\"). 날짜가 적혀 있으면 YYYY-MM-DD로.\n\
         - 추측하지 않는다. 흐리거나 잘린 글자는 적지 않는다. 사람 얼굴·이름·전화번호 같은 개인정보는 적지 않는다.\n\
         - 파일을 고치거나 다른 명령을 쓰지 않는다.\n\
         사진 파일:\n{}",
        files.join("\n")
    )
}

fn screen_prompt(sheets: &[(String, usize)]) -> String {
    format!(
        "너는 목욕탕 지도 서비스 '탕방'의 사진 고르기 담당이다. 아래 바둑판 이미지를 Read 도구로 하나씩 연다.\n\
         바둑판 하나는 블로그 글 하나의 사진을 3열로, 왼쪽→오른쪽·위→아래 순서로 1번부터 붙인 것이다(칸 수는 경로 뒤에 적었다).\n\
         목욕탕 이용에 관한 **글자**가 보이는 칸(간판·안내문·공지·가격표·요금표·영업시간표)의 번호만 고른다. 음식·탕 내부·사람·풍경·물건 사진은 고르지 않는다. 글자가 있는지 헷갈리면 고른다.\n\
         바둑판마다 JSON 한 줄만 출력한다(설명·코드블록 없이): {{\"sheet\":\"<받은 경로 그대로>\",\"tiles\":[번호,...]}}\n\
         파일을 고치거나 다른 명령을 쓰지 않는다.\n\
         바둑판:\n{}",
        sheets.iter().map(|(p, n)| format!("{p} ({n}칸)")).collect::<Vec<_>>().join("\n")
    )
}

fn decode(f: &str) -> Option<image::DynamicImage> {
    image::ImageReader::open(f).ok()?.with_guessed_format().ok()?.decode().ok()
}

/// 사진들을 3열 바둑판 한 장으로(왼쪽→오른쪽, 위→아래 순서로 1번부터)
fn make_sheet(files: &[&str], out: &str) -> Result<()> {
    let rows = (files.len() as u32).div_ceil(SHEET_COLS);
    let (w, h) = (SHEET_COLS * (CELL + PAD) + PAD, rows * (CELL + PAD) + PAD);
    let mut canvas = image::RgbImage::from_pixel(w, h, image::Rgb([180, 180, 180]));
    for (i, f) in files.iter().enumerate() {
        let Some(img) = decode(f) else { continue };
        let t = img.thumbnail(CELL, CELL).to_rgb8();
        let (cx, cy) = (PAD + (i as u32 % SHEET_COLS) * (CELL + PAD), PAD + (i as u32 / SHEET_COLS) * (CELL + PAD));
        let mut cell = image::RgbImage::from_pixel(CELL, CELL, image::Rgb([255, 255, 255]));
        image::imageops::overlay(&mut cell, &t, ((CELL - t.width()) / 2) as i64, ((CELL - t.height()) / 2) as i64);
        image::imageops::overlay(&mut canvas, &cell, cx as i64, cy as i64);
    }
    if let Some(p) = std::path::Path::new(out).parent() {
        std::fs::create_dir_all(p)?;
    }
    canvas.save(out)?;
    Ok(())
}

/// Claude를 부를 때마다 쓴 토큰·비용을 남긴다(수집 도구 대시보드 'Claude 사용량')
fn log_usage(step: &str, v: &Value, items: usize) {
    let u = &v["usage"];
    let n = |k: &str| u[k].as_u64().unwrap_or(0);
    let at = chrono::Utc::now()
        .with_timezone(&chrono::FixedOffset::east_opt(9 * 3600).unwrap())
        .format("%Y-%m-%dT%H:%M:%S+09:00")
        .to_string();
    let line = json!({
        "at": at, "step": step, "items": items,
        "input": n("input_tokens"), "output": n("output_tokens"),
        "cacheRead": n("cache_read_input_tokens"), "cacheWrite": n("cache_creation_input_tokens"),
        "costUsd": v["total_cost_usd"].as_f64().unwrap_or(0.0), "ms": v["duration_ms"].as_u64().unwrap_or(0),
    });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(USAGE) {
        let _ = writeln!(f, "{line}");
    }
}

/// claude -p 한 번 부르기(Read만 허용, 결과는 JSON으로 받아 토큰 사용량도 남김). 답에서 '{'로 시작하는 줄만 JSON으로 읽는다
fn ask(step: &str, items: usize, prompt_text: &str) -> Result<(bool, Vec<Value>)> {
    let mut c = claude();
    // 기본 Claude Code 안내문(약 5만 토큰)을 매번 읽지 않게 짧은 안내문으로 바꾼다(부를 때마다 드는 고정 비용을 줄임)
    // 스킬 목록·연결 도구(MCP)·프로젝트 지침도 사진 판독에는 필요 없어 빼고, 가벼운 모델(sonnet)로 읽는다.
    // 사진 폴더에서 실행해 프로젝트 CLAUDE.md도 읽지 않게 한다(사진 경로는 절대 경로로 준다)
    c.current_dir(PHOTO_DIR);
    c.args([
        "-p", "--model", "sonnet", "--disable-slash-commands", "--strict-mcp-config", "--no-session-persistence",
        "--permission-mode", "dontAsk", "--allowedTools", "Read", "--tools", "Read", "--output-format", "json",
        "--system-prompt", "너는 탕방 데이터 수집 도구의 사진 판독기다. 받은 지시대로 Read 도구로 이미지 파일을 열어 보고, 지시한 JSON 줄만 출력한다. 다른 도구·명령은 쓰지 않는다.",
    ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = c.spawn()?;
    child.stdin.take().unwrap().write_all(prompt_text.as_bytes())?;
    let out = child.wait_with_output()?;
    let raw = String::from_utf8_lossy(&out.stdout);
    let meta: Value = serde_json::from_str(raw.trim()).unwrap_or(Value::Null);
    if !meta.is_null() {
        log_usage(step, &meta, items);
    }
    let text = meta["result"].as_str().map(String::from).unwrap_or_else(|| raw.to_string());
    let vals = text
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with('{'))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect();
    Ok((out.status.success() && meta["is_error"] != true, vals))
}

fn name_of(p: &str) -> String {
    p.replace('\\', "/").rsplit('/').next().unwrap_or("").to_string()
}

fn append(lines: &[Value]) -> Result<()> {
    if lines.is_empty() {
        return Ok(());
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(OUT)?;
    for l in lines {
        writeln!(f, "{l}")?;
    }
    Ok(())
}

fn main() -> Result<()> {
    let a = Args::parse();
    let from = util::fresh_from();
    let done: HashSet<String> = std::fs::read_to_string(OUT)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|v| v["file"].as_str().map(String::from))
        .collect();
    // 최근 1년 글의 아직 안 읽은 사진
    let mut todo: Vec<Img> = Vec::new();
    for l in std::fs::read_to_string(BLOGS).unwrap_or_default().lines() {
        let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
        for im in v["postImages"].as_array().cloned().unwrap_or_default() {
            let (f, d) = (im["file"].as_str().unwrap_or(""), im["date"].as_str().unwrap_or(""));
            if !f.is_empty() && d >= from.as_str() && !done.contains(f) && std::path::Path::new(f).exists() {
                let stem = f.rsplit_once('_').map(|x| x.0).unwrap_or(f).to_string(); // '<글>_<k>.jpg' → '<글>'
                todo.push(Img {
                    kid: v["kakaoId"].as_str().unwrap_or("").into(),
                    name: v["name"].as_str().unwrap_or("").into(),
                    file: f.into(),
                    date: d.into(),
                    stem,
                });
            }
        }
    }
    // 작은 아이콘·이모티콘(가로 200px 또는 세로 150px 미만)은 Claude에 보내지 않고 바로 지운다
    let mut tiny = Vec::new();
    todo.retain(|im| {
        let small = image::image_dimensions(&im.file).map(|(w, h)| w < 200 || h < 150).unwrap_or(false);
        if small {
            tiny.push(json!({ "file": im.file, "useful": false, "tiny": true, "kakaoId": im.kid, "date": im.date, "readAt": util::today_kst() }));
            let _ = std::fs::remove_file(&im.file);
        }
        !small
    });
    if !tiny.is_empty() {
        println!("작은 아이콘·이모티콘 {}장은 읽지 않고 지움", tiny.len());
        append(&tiny)?;
    }
    println!("블로그 사진 글자 읽기: 안 읽은 사진 {}장 (조건: 최근 1년 글({from} 이후)) / 이번 상한: 바둑판 {}장, 크게 읽기 {}장", todo.len(), a.max_sheets, a.max);
    if todo.is_empty() {
        return Ok(());
    }
    if claude().arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| !s.success()).unwrap_or(true) {
        println!("⚠ Claude Code(claude)를 찾지 못해 사진 글자를 읽지 않았어요. 설치·로그인 뒤 다시 돌리면 이어서 읽어요.");
        return Ok(());
    }
    let root = std::env::current_dir()?;
    let abs = |f: &str| root.join(f).to_string_lossy().replace('\\', "/");

    // ── 1단계: 사진이 3장 이상인 글은 바둑판으로 모아 글자 있는 칸만 고른다 ──
    let mut posts: Vec<(String, Vec<usize>)> = Vec::new(); // (글, todo 번호들) 글 순서 유지
    for (i, im) in todo.iter().enumerate() {
        match posts.iter_mut().find(|p| p.0 == im.stem) {
            Some(p) => p.1.push(i),
            None => posts.push((im.stem.clone(), vec![i])),
        }
    }
    let mut picked: Vec<usize> = Vec::new();
    let mut sheets: Vec<(String, Vec<usize>)> = Vec::new(); // (바둑판 파일, 칸 → todo 번호)
    for (stem, idx) in &posts {
        if idx.len() <= 2 {
            picked.extend(idx); // 1~2장이면 바로 크게 읽는다
            continue;
        }
        for (n, chunk) in idx.chunks(SHEET_TILES).enumerate() {
            if sheets.len() >= a.max_sheets {
                break;
            }
            let out = format!("data/collected/naver_pages/blogimg/sheet/{}_s{n}.jpg", name_of(stem));
            let files: Vec<&str> = chunk.iter().map(|&i| todo[i].file.as_str()).collect();
            if make_sheet(&files, &out).is_ok() {
                sheets.push((out, chunk.to_vec()));
            } else {
                picked.extend(chunk); // 바둑판을 못 만들면 크게 읽기로 넘긴다
            }
        }
    }
    let (mut screened_out, mut removed) = (0, 0);
    for group in sheets.chunks(8) {
        let list: Vec<(String, usize)> = group.iter().map(|(p, c)| (abs(p), c.len())).collect();
        let (ok, vals) = ask("사진 고르기(바둑판)", group.len(), &screen_prompt(&list))?;
        if vals.is_empty() && !ok {
            println!("⚠ Claude Code가 실패했어요(바둑판 고르기). 로그인 상태를 확인해 주세요. 남은 사진은 다음에 이어서 읽어요.");
            break;
        }
        let mut lines = Vec::new();
        for (sheet, cells) in group {
            let Some(v) = vals.iter().find(|v| name_of(v["sheet"].as_str().unwrap_or("")) == name_of(sheet)) else { continue };
            let tiles: HashSet<usize> = v["tiles"].as_array().into_iter().flatten().filter_map(|t| t.as_u64()).map(|t| t as usize).collect();
            for (k, &i) in cells.iter().enumerate() {
                if tiles.contains(&(k + 1)) {
                    picked.push(i);
                } else {
                    let im = &todo[i];
                    lines.push(json!({ "file": im.file, "useful": false, "screened": true, "kakaoId": im.kid, "date": im.date, "readAt": util::today_kst() }));
                    screened_out += 1;
                    if std::fs::remove_file(&im.file).is_ok() {
                        removed += 1;
                    }
                }
            }
            let _ = std::fs::remove_file(sheet);
        }
        append(&lines)?;
    }
    println!("1단계(바둑판 {}장): 크게 읽을 사진 {}장, 글자 없어 지운 사진 {screened_out}장", sheets.len(), picked.len());

    // ── 2단계: 고른 사진만 원래 크기로 읽는다(같은 곳 사진끼리 16장씩) ──
    picked.sort();
    picked.truncate(a.max);
    let (mut read, mut useful) = (0, 0);
    let mut i = 0;
    while i < picked.len() {
        let kid = todo[picked[i]].kid.clone();
        let mut j = i;
        while j < picked.len() && todo[picked[j]].kid == kid && j - i < BATCH {
            j += 1;
        }
        let group: Vec<&Img> = picked[i..j].iter().map(|&k| &todo[k]).collect();
        let files: Vec<String> = group.iter().map(|t| abs(&t.file)).collect();
        let (ok, vals) = ask("사진 글자 읽기", group.len(), &prompt(&group[0].name, &files))?;
        if vals.is_empty() && !ok {
            println!("⚠ Claude Code가 실패했어요({}). 로그인 상태를 확인해 주세요. 남은 사진은 다음에 이어서 읽어요.", group[0].name);
            break;
        }
        let mut lines = Vec::new();
        for mut v in vals {
            // Claude가 경로를 조금 다르게 적어도(상대 경로 등) 파일 이름으로 맞춘다
            let got = name_of(v["file"].as_str().unwrap_or(""));
            let Some(t) = group.iter().find(|t| name_of(&t.file) == got) else { continue };
            v["file"] = json!(t.file);
            v["kakaoId"] = json!(t.kid);
            v["date"] = json!(t.date);
            v["readAt"] = json!(util::today_kst());
            if v["useful"] == true && v["other_business"] != true {
                useful += 1;
            } else if std::fs::remove_file(&t.file).is_ok() {
                removed += 1; // 쓸모없는 사진은 지운다(결과 줄은 남아 다시 받지도 읽지도 않음)
            }
            read += 1;
            lines.push(v);
        }
        append(&lines)?;
        println!("  {} 사진 {}장 → 읽음 {}장", group[0].name, group.len(), lines.len());
        i = j;
    }
    println!("2단계: 크게 읽은 사진 {read}장, 목욕탕 정보가 있는 사진 {useful}장 → {OUT} / 지운 사진 모두 {removed}장");
    Ok(())
}
