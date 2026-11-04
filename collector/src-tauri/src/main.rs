//! 탕방 데이터 수집 도구 — 데스크톱 앱(윈도우·맥).
//! 화면(collector/src)에서 '수집 시작'을 누르면 이 파일이 프로젝트 폴더에서 차례로 실행한다:
//!   1 받을 목록 만들기   find_naver_ids, collect_home (러스트 데이터 도구, cargo run --release)
//!   2 ego로 페이지 받기  scripts/ego_fetch.mjs 를 ego 브라우저로 실행 (Claude Code가 맡거나, 직접 실행)
//!   3 받은 페이지 읽기   find_naver_ids, collect_home
//!   4 판정 judge_facts → 5 합치기 onsen_merge → 6 화면 데이터 export_web_data
//! 수집 규칙(곳당 10초, 한 번에 150곳, 캡차·연속 3회 실패 시 멈춤)은 ego_fetch.mjs가 지키고, 이 앱은 넘기지 않는다.
//! 키: .env는 있는지만 보고 열지 않는다. 요청 주소·헤더는 출력하지 않는다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const FETCH_MAX: u32 = 150; // 한 번에 150곳 (CLAUDE.md 수집 규칙)
const FETCH_BATCH: u32 = 25; // ego_fetch.mjs 한 번 실행에 받는 개수(약 5분)
const FETCH_INTERVAL_MS: u32 = 10_000; // 곳당 10초

#[derive(Default)]
struct Inner {
    root: Mutex<Option<PathBuf>>,
    pid: Mutex<Option<u32>>,
    running: AtomicBool,
    stop: AtomicBool,
    fetch_secs: Mutex<Option<u64>>, // 이번 실행에서 ego로 받는 데 걸린 시간(예상 시간 계산용 기록)
}
type Shared = Arc<Inner>;

// ───────── 실행 파일 찾기 (앱을 아이콘으로 열면 터미널 PATH를 못 받으므로 흔한 설치 위치를 더한다) ─────────
fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default()
}

fn search_dirs() -> Vec<PathBuf> {
    let h = home();
    let mut v: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    v.extend([
        h.join(".cargo/bin"),
        h.join(".local/bin"),
        h.join(".local/share/ego/active_version_dir"),
        h.join(".claude/local"),
        h.join(".npm-global/bin"),
    ]);
    if cfg!(windows) {
        if let Some(a) = std::env::var_os("APPDATA") {
            v.push(PathBuf::from(a).join("npm"));
        }
        if let Some(a) = std::env::var_os("ProgramFiles") {
            v.push(PathBuf::from(a).join("nodejs"));
        }
    } else {
        v.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    }
    v
}

fn path_env() -> OsString {
    std::env::join_paths(search_dirs()).unwrap_or_default()
}

fn which(name: &str) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) { &["exe", "cmd", "bat"] } else { &[""] };
    for d in search_dirs() {
        for e in exts {
            let p = if e.is_empty() { d.join(name) } else { d.join(format!("{name}.{e}")) };
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn command(name: &str, root: &Path) -> Result<Command, String> {
    let exe = which(name).ok_or_else(|| format!("'{name}'을(를) 찾지 못했어요"))?;
    let mut c = Command::new(exe);
    c.current_dir(root).env("PATH", path_env()).env("NO_COLOR", "1").env("CARGO_TERM_COLOR", "never");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: 검은 창이 뜨지 않게
    }
    Ok(c)
}

// ───────── 프로젝트 폴더 ─────────
fn is_root(p: &Path) -> bool {
    std::fs::read_to_string(p.join("Cargo.toml")).map(|t| t.contains("name = \"tangbang-data\"")).unwrap_or(false)
}

fn saved_root_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("project-folder.txt"))
}

fn detect_root(app: &AppHandle) -> Option<PathBuf> {
    if let Some(f) = saved_root_file(app) {
        if let Ok(t) = std::fs::read_to_string(f) {
            let p = PathBuf::from(t.trim());
            if is_root(&p) {
                return Some(p);
            }
        }
    }
    let starts = [std::env::current_exe().ok(), std::env::current_dir().ok()];
    for s in starts.into_iter().flatten() {
        for a in s.ancestors() {
            if is_root(a) {
                return Some(a.to_path_buf());
            }
        }
    }
    None
}

fn root_of(st: &Shared) -> Result<PathBuf, String> {
    st.root.lock().unwrap().clone().ok_or_else(|| "프로젝트 폴더를 먼저 골라 주세요".into())
}

// ───────── 화면에 보내는 것 ─────────
#[derive(Serialize, Clone)]
struct Check {
    id: &'static str,
    label: &'static str,
    ok: bool,
    detail: String,
    fix: String,
}

fn log(app: &AppHandle, kind: &str, text: impl Into<String>) {
    let _ = app.emit("log", json!({ "kind": kind, "text": text.into() }));
}
fn step(app: &AppHandle, id: &str, state: &str, note: impl Into<String>) {
    let _ = app.emit("step", json!({ "id": id, "state": state, "note": note.into() }));
}

fn version_of(name: &str, root: &Path, arg: &str) -> Option<String> {
    let out = command(name, root).ok()?.arg(arg).stdin(Stdio::null()).output().ok()?;
    let s = String::from_utf8_lossy(if out.stdout.is_empty() { &out.stderr } else { &out.stdout }).to_string();
    out.status.success().then(|| s.lines().next().unwrap_or("").trim().to_string())
}

#[tauri::command]
fn get_root(app: AppHandle, st: State<'_, Shared>) -> Option<String> {
    let mut r = st.root.lock().unwrap();
    if r.is_none() {
        *r = detect_root(&app);
    }
    r.as_ref().map(|p| p.display().to_string())
}

#[tauri::command]
fn set_root(app: AppHandle, st: State<'_, Shared>, path: String) -> Result<String, String> {
    let p = PathBuf::from(path.trim());
    if !is_root(&p) {
        return Err("탕방 프로젝트 폴더가 아니에요. Cargo.toml이 있는 폴더(10_23_map_test)를 골라 주세요".into());
    }
    if let Some(f) = saved_root_file(&app) {
        let _ = std::fs::create_dir_all(f.parent().unwrap());
        let _ = std::fs::write(f, p.display().to_string());
    }
    *st.root.lock().unwrap() = Some(p.clone());
    Ok(p.display().to_string())
}

#[tauri::command]
async fn check_env(st: State<'_, Shared>) -> Result<Vec<Check>, String> {
    let root = st.root.lock().unwrap().clone();
    let r = root.clone().unwrap_or_else(home);
    let ps = if cfg!(windows) { "powershell -ExecutionPolicy Bypass -File scripts\\setup.ps1" } else { "sh scripts/setup.sh" };
    let cargo = version_of("cargo", &r, "--version");
    let ego = which("ego-browser");
    let claude = version_of("claude", &r, "--version");
    let env_ok = root.as_ref().map(|p| p.join(".env").is_file()).unwrap_or(false);
    Ok(vec![
        Check {
            id: "root",
            label: "프로젝트 폴더",
            ok: root.is_some(),
            detail: root.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "아직 못 찾았어요".into()),
            fix: "깃에서 받은 탕방 프로젝트 폴더를 골라 주세요".into(),
        },
        Check {
            id: "cargo",
            label: "러스트 데이터 도구",
            ok: cargo.is_some(),
            detail: cargo.unwrap_or_else(|| "러스트가 없어요".into()),
            fix: format!("프로젝트 폴더에서 {ps} 를 한 번 실행해 주세요"),
        },
        Check {
            id: "ego",
            label: "ego 브라우저",
            ok: ego.is_some(),
            detail: if ego.is_some() { "설치됨".into() } else { "ego-browser를 찾지 못했어요".into() },
            fix: "ego lite를 설치하고 한 번 실행해 주세요".into(),
        },
        Check {
            id: "claude",
            label: "Claude Code",
            ok: claude.is_some(),
            detail: claude.unwrap_or_else(|| "claude를 찾지 못했어요".into()),
            fix: "Claude Code를 설치하고 터미널에서 claude 로 한 번 로그인해 주세요. 없으면 '직접 실행'으로 수집할 수 있어요".into(),
        },
        Check {
            id: "env",
            label: "카카오 키 파일(.env)",
            ok: env_ok,
            detail: if env_ok { "있음 (값은 열어 보지 않아요)".into() } else { "없어요".into() },
            fix: ".env.example을 복사해 .env를 만들고 키를 직접 넣어 주세요. 네이버 수집에는 필요 없어요".into(),
        },
    ])
}

fn csv_rows(p: &Path) -> Option<usize> {
    let f = std::fs::File::open(p).ok()?;
    Some(csv::ReaderBuilder::new().flexible(true).from_reader(f).records().count())
}

fn modified(p: &Path) -> Option<u64> {
    std::fs::metadata(p).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
}

/// 예상 시간에 쓸 과거 기록: 최근 실행들의 '곳당 초'와 '정리(받기 뺀 나머지) 초'. 기록이 없으면 null(화면이 기본값을 쓴다)
fn timing(runs: &Path) -> Value {
    let rows: Vec<Value> = std::fs::read_to_string(runs).unwrap_or_default().lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    let (mut secs, mut pages) = (0u64, 0u64);
    let mut n_fetch = 0;
    for r in rows.iter().rev() {
        let (Some(f), Some(p)) = (r["fetchSeconds"].as_u64(), r["pages"].as_u64()) else { continue };
        if p == 0 || r["fetchState"] == "captcha" {
            continue; // 받지 않았거나 캡차로 바로 멈춘 실행은 속도를 왜곡한다
        }
        secs += f;
        pages += p;
        n_fetch += 1;
        if n_fetch >= 5 {
            break;
        }
    }
    let mut proc: Vec<u64> = rows
        .iter()
        .rev()
        .filter(|r| r["plan"] == "all" && r["ok"] == true)
        .filter_map(|r| Some(r["seconds"].as_u64()?.saturating_sub(r["fetchSeconds"].as_u64().unwrap_or(0))))
        .take(5)
        .collect();
    proc.sort_unstable();
    json!({
        "pageSec": if pages > 0 { Value::from(secs as f64 / pages as f64) } else { Value::Null },
        "pageRuns": n_fetch,
        "procSec": proc.get(proc.len() / 2).copied(),
    })
}

#[tauri::command]
async fn summary(st: State<'_, Shared>) -> Result<Value, String> {
    let root = root_of(&st)?;
    let c = |n: &str| root.join("data/collected").join(n);
    let web = root.join("web/public/data/onsen.json");
    let (places, base) = std::fs::read_to_string(&web)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .map(|v| (v["places"].as_array().map(|a| a.len()), v["baseDate"].as_str().map(String::from)))
        .unwrap_or((None, None));
    Ok(json!({
        "merged": csv_rows(&root.join("data/merged/onsen_merged.csv")),
        "homeFacts": csv_rows(&c("naver_home_facts.csv")),
        "idFound": csv_rows(&c("naver_id_found.csv")),
        "todoHome": csv_rows(&c("naver_home_todo.csv")),
        "todoFind": csv_rows(&c("naver_find_todo.csv")),
        "webPlaces": places,
        "webBaseDate": base,
        "webUpdated": modified(&web),
        "timing": timing(&c("collector_runs.jsonl")),
        // 홈 수집일(곳마다 마지막 날짜): 화면이 지금 시각 기준으로 '오래된 곳' 수를 센다
        "homeDates": latest_dates(&c("naver_home_facts.csv")),
        // 받을 목록 중 새 곳만(다시받기 줄 제외). 오래된 곳 수는 homeDates로 따로 센다
        "reviewDates": review_dates(&c("naver_reviews.jsonl")),
        "blogDates": review_dates(&c("naver_blogs.jsonl")),
        "todoBlogNew": csv_pick(&c("naver_blog_todo.csv"), &["다시받기"]).iter().filter(|r| r["다시받기"] != "1").count(),
        "todoPhoto": csv_rows(&c("naver_photo_todo.csv")),
        "todoReviewNew": csv_pick(&c("naver_review_todo.csv"), &["다시받기"]).iter().filter(|r| r["다시받기"] != "1").count(),
        "todoHomeNew": csv_pick(&c("naver_home_todo.csv"), &["다시받기"]).iter().filter(|r| r["다시받기"] != "1").count(),
    }))
}

/// 후기 기록(naver_reviews.jsonl): 곳마다 카카오ID·받은 날·키워드 후기 수만(문장은 화면에 보내지 않는다)
fn review_rows(p: &Path) -> Vec<Value> {
    std::fs::read_to_string(p)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| json!({ "kakaoId": v["kakaoId"], "collectedAt": v["collectedAt"], "keyword": v["reviews"].as_array().map(|a| a.len()).unwrap_or(0) }))
        .collect()
}
fn review_dates(p: &Path) -> Vec<String> {
    review_rows(p).iter().filter_map(|v| v["collectedAt"].as_str().map(String::from)).collect()
}

/// 네이버ID마다 마지막 수집일
fn latest_dates(p: &Path) -> Vec<String> {
    let mut m: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for r in csv_pick(p, &["네이버ID", "수집일"]) {
        let (id, d) = (r["네이버ID"].as_str().unwrap_or("").to_string(), r["수집일"].as_str().unwrap_or("").to_string());
        let e = m.entry(id).or_default();
        if d > *e {
            *e = d;
        }
    }
    m.into_values().collect()
}

/// CSV에서 고른 칸만 읽는다(없는 칸은 빈 값). 대시보드 계산은 화면(collector/src/metrics.ts)이 한다
fn csv_pick(p: &Path, cols: &[&str]) -> Vec<Value> {
    let Ok(t) = std::fs::read_to_string(p) else { return vec![] };
    let mut r = csv::ReaderBuilder::new().flexible(true).from_reader(t.trim_start_matches('\u{feff}').as_bytes());
    let Ok(head) = r.headers().cloned() else { return vec![] };
    let idx: Vec<Option<usize>> = cols.iter().map(|c| head.iter().position(|h| h == *c)).collect();
    r.records()
        .filter_map(Result::ok)
        .map(|rec| {
            let m: serde_json::Map<String, Value> = cols
                .iter()
                .zip(&idx)
                .map(|(c, i)| (c.to_string(), Value::from(i.and_then(|i| rec.get(i)).unwrap_or(""))))
                .collect();
            Value::Object(m)
        })
        .collect()
}

// ───────── 사진 고르기 ─────────
// 후보: data/collected/naver_photo_candidates.jsonl (네이버 업체 등록 사진 주소. 이미지 파일은 받지 않는다)
// 고른 것: data/curated/place_photos.csv (사람이 눈으로 보고 고른 대표 사진. 이 화면에서 누른 것만 쓴다)
const PHOTO_COLS: [&str; 7] = ["카카오ID", "네이버ID", "이름", "사진URL", "종류", "출처", "확인일"];

fn photo_file(root: &Path) -> PathBuf {
    root.join("data/curated/place_photos.csv")
}

/// 고른 사진 표를 읽는다(칸 이름 → 값). 없으면 빈 표
fn read_photo_rows(root: &Path) -> Vec<Vec<String>> {
    let Ok(t) = std::fs::read_to_string(photo_file(root)) else { return vec![] };
    let mut r = csv::ReaderBuilder::new().flexible(true).from_reader(t.trim_start_matches('\u{feff}').as_bytes());
    let Ok(head) = r.headers().cloned() else { return vec![] };
    let idx: Vec<Option<usize>> = PHOTO_COLS.iter().map(|c| head.iter().position(|h| h == *c)).collect();
    r.records()
        .filter_map(Result::ok)
        .map(|rec| idx.iter().map(|i| i.and_then(|i| rec.get(i)).unwrap_or("").to_string()).collect())
        .collect()
}

/// 데이터 도구(csvio::write_csv)와 같은 모양으로 쓴다: utf-8-sig, 윈도우는 CRLF, 필요할 때만 따옴표
fn write_photo_rows(root: &Path, rows: &[Vec<String>]) -> Result<(), String> {
    let mut w = csv::WriterBuilder::new()
        .terminator(if cfg!(windows) { csv::Terminator::CRLF } else { csv::Terminator::Any(b'\n') })
        .from_writer(vec![]);
    w.write_record(PHOTO_COLS).map_err(|e| e.to_string())?;
    for r in rows {
        w.write_record(r).map_err(|e| e.to_string())?;
    }
    let mut out = "\u{feff}".as_bytes().to_vec();
    out.extend(w.into_inner().map_err(|e| e.to_string())?);
    let p = photo_file(root);
    // 바꾸기 전 파일을 한 번 남겨 둔다(사람이 고른 값이라 실수로 지워지면 되돌릴 수 있게)
    let _ = std::fs::copy(&p, p.with_extension("csv.bak"));
    std::fs::write(&p, out).map_err(|e| e.to_string())
}

#[tauri::command]
async fn photos(st: State<'_, Shared>) -> Result<Value, String> {
    let root = root_of(&st)?;
    let cands: Vec<Value> = std::fs::read_to_string(root.join("data/collected/naver_photo_candidates.jsonl"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    let chosen: Vec<Value> = read_photo_rows(&root)
        .into_iter()
        .map(|r| json!({ "kakaoId": r[0], "naverId": r[1], "name": r[2], "url": r[3], "kind": r[4], "source": r[5], "checked": r[6] }))
        .collect();
    let web = std::fs::read_to_string(root.join("web/public/data/onsen.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .unwrap_or(Value::Null);
    // 곳마다 마지막 후기 방문일·블로그 작성일(collect_reviews가 저장한 newest). 정보가 없는 곳이 아직 영업하는지 가늠하는 데 쓴다
    let mut activity = serde_json::Map::new();
    for (file, key) in [("data/collected/naver_reviews.jsonl", "review"), ("data/collected/naver_blogs.jsonl", "blog")] {
        for l in std::fs::read_to_string(root.join(file)).unwrap_or_default().lines() {
            let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
            let (Some(k), Some(d)) = (v["kakaoId"].as_str(), v["newest"].as_str()) else { continue };
            if d.is_empty() {
                continue;
            }
            let e = activity.entry(k.to_string()).or_insert_with(|| json!({}));
            e[key] = Value::from(d);
        }
    }
    Ok(json!({ "candidates": cands, "chosen": chosen, "places": web["places"], "baseDate": web["baseDate"], "activity": activity }))
}

/// 대표 사진을 정한다(같은 곳이 있으면 바꾼다). url이 비어 있으면 '사진 없이 두기'로 기록한다
#[tauri::command]
async fn pick_photo(st: State<'_, Shared>, kakao_id: String, naver_id: String, name: String, url: String, kind: String, today: String) -> Result<(), String> {
    let root = root_of(&st)?;
    if st.running.load(Ordering::SeqCst) {
        return Err("수집이 끝난 뒤에 저장해 주세요(같은 파일을 쓰는 단계가 있어요)".into());
    }
    if !url.is_empty() && !url.starts_with("https://") {
        return Err("사진 주소가 올바르지 않아요".into());
    }
    let mut rows = read_photo_rows(&root);
    // 사진 없이 두기도 '사람이 확인함'으로 남긴다(사진URL 비움, 종류 '사진 없음'). export_web_data는 빈 주소를 건너뛴다
    let kind = if url.is_empty() { "사진 없음".to_string() } else { kind };
    let row = vec![kakao_id.clone(), naver_id, name, url.clone(), kind, "네이버 플레이스 업체 등록 사진".into(), today];
    match rows.iter().position(|r| r[0] == kakao_id) {
        Some(i) => rows[i] = row,
        None => rows.push(row),
    }
    write_photo_rows(&root, &rows)
}

// ───────── 서비스 반영 상태 ─────────
// 서비스(tangbang.vercel.app)는 깃 main에 푸시돼야 바뀐다. 화면 데이터·사람이 고른 값이 깃과 다른지 보고,
// 다르면 화면에 'Claude에게 커밋·푸시를 요청하세요' 알림을 띄운다. 이 앱은 커밋·푸시를 직접 하지 않는다(실수로 공개 저장소가 바뀌지 않게).
const PUBLISH_PATHS: [&str; 2] = ["web/public/data/onsen.json", "data/curated"];

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let out = command("git", root).ok()?.args(args).stdin(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
async fn publish_status(st: State<'_, Shared>) -> Result<Value, String> {
    let root = root_of(&st)?;
    let Some(status) = git(&root, &[&["-c", "core.quotepath=false", "status", "--porcelain", "--"][..], &PUBLISH_PATHS[..]].concat()) else {
        return Ok(json!({ "git": false }));
    };
    let changed: Vec<String> = status.lines().filter(|l| l.len() > 3).map(|l| l[3..].trim().trim_matches('"').to_string()).collect();
    // 커밋은 했지만 아직 푸시 안 한 커밋 수(원격 추적 브랜치가 없으면 0)
    let ahead = git(&root, &["rev-list", "--count", "@{u}..HEAD"]).and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0);
    let photos_changed = changed.iter().any(|f| f.contains("place_photos"));
    Ok(json!({ "git": true, "changed": changed, "ahead": ahead, "photosChanged": photos_changed }))
}

#[tauri::command]
async fn dashboard(st: State<'_, Shared>) -> Result<Value, String> {
    let root = root_of(&st)?;
    let c = |n: &str| root.join("data/collected").join(n);
    let web = std::fs::read_to_string(root.join("web/public/data/onsen.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .unwrap_or(Value::Null);
    let runs: Vec<Value> = std::fs::read_to_string(c("collector_runs.jsonl"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Ok(json!({
        "baseDate": web["baseDate"],
        "places": web["places"],
        "home": csv_pick(&c("naver_home_facts.csv"), &["카카오ID", "네이버ID", "수집일", "상태", "네이버분류", "영업표시", "가격표", "폐업언급"]),
        "found": csv_pick(&c("naver_id_found.csv"), &["카카오ID", "결과", "확인일"]),
        "naverPlaces": csv_pick(&c("naver_places.csv"), &["카카오ID", "네이버ID"]),
        "manual": csv_pick(&root.join("data/curated/naver_match_manual.csv"), &["카카오ID", "네이버ID"]),
        "reviews": review_rows(&c("naver_reviews.jsonl")),
        "blogs": review_rows(&c("naver_blogs.jsonl")),
        "license": csv_pick(&c("license_match.csv"), &["카카오ID", "맞춘방법", "확실", "영업상태", "업태", "면적", "욕실수"]),
        "todoHome": csv_rows(&c("naver_home_todo.csv")),
        "todoFind": csv_rows(&c("naver_find_todo.csv")),
        "runs": runs,
    }))
}

/// 수집 기록 한 줄(대시보드 '수집 기록'). 이 PC에만 쌓인다(깃에 안 올림)
fn append_run(root: &Path, rec: Value) {
    use std::fs::OpenOptions;
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(root.join("data/collected/collector_runs.jsonl")) {
        let _ = writeln!(f, "{rec}");
    }
}

#[tauri::command]
async fn fetch_status(st: State<'_, Shared>) -> Result<Value, String> {
    let root = root_of(&st)?;
    let p = root.join("data/collected/ego_fetch_status.json");
    Ok(std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null))
}

// ───────── 실행 ─────────
fn run_proc(app: &AppHandle, st: &Shared, mut c: Command, stdin: Option<String>) -> Result<bool, String> {
    c.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() });
    let mut child = c.spawn().map_err(|e| format!("실행하지 못했어요: {e}"))?;
    *st.pid.lock().unwrap() = Some(child.id());
    if let (Some(text), Some(mut w)) = (stdin, child.stdin.take()) {
        let _ = w.write_all(text.as_bytes());
    }
    let pipe = |r: Box<dyn Read + Send>, kind: &'static str| {
        let app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(r).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    log(&app, kind, line);
                }
            }
        })
    };
    let a = pipe(Box::new(child.stdout.take().unwrap()), "out");
    let b = pipe(Box::new(child.stderr.take().unwrap()), "err");
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = (a.join(), b.join());
    *st.pid.lock().unwrap() = None;
    Ok(status.success())
}

fn cargo_bin(app: &AppHandle, st: &Shared, root: &Path, bin: &str, args: &[&str]) -> Result<(), String> {
    log(app, "info", format!("▶ {bin} {}", args.join(" ")));
    let mut c = command("cargo", root)?;
    c.args(["run", "--release", "--quiet", "--bin", bin]);
    if !args.is_empty() {
        c.arg("--").args(args);
    }
    if run_proc(app, st, c, None)? {
        Ok(())
    } else {
        Err(format!("{bin}이(가) 실패했어요. 아래 기록을 확인해 주세요"))
    }
}

fn file_url(p: &Path) -> String {
    use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
    const SET: &AsciiSet = &CONTROLS.add(b' ').add(b'"').add(b'#').add(b'%').add(b'<').add(b'>').add(b'?').add(b'`').add(b'{').add(b'}').add(b'\'');
    let s = p.display().to_string().replace('\\', "/");
    let s = s.strip_prefix("//?/").unwrap_or(&s).to_string();
    let enc = utf8_percent_encode(&s, SET).to_string(); // 한글도 %XX로 → -e 인자가 ASCII만 남는다
    if enc.starts_with('/') { format!("file://{enc}") } else { format!("file:///{enc}") }
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn read_status(root: &Path) -> Value {
    std::fs::read_to_string(root.join("data/collected/ego_fetch_status.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null)
}

/// ego로 페이지 받기. 돌려주는 값: 멈춘 이유(캡차 등)가 있으면 Some
fn fetch(app: &AppHandle, st: &Shared, root: &Path, engine: &str) -> Result<Option<String>, String> {
    let col = root.join("data/collected");
    let _ = std::fs::remove_file(col.join("ego_fetch_stop"));
    let _ = std::fs::remove_file(col.join("ego_fetch_status.json"));
    let job = json!({ "id": now_ms().to_string(), "max": FETCH_MAX, "batch": FETCH_BATCH, "intervalMs": FETCH_INTERVAL_MS });
    std::fs::write(col.join("ego_fetch_job.json"), job.to_string()).map_err(|e| e.to_string())?;
    let entry = format!("await import('{}')", file_url(&root.join("scripts/ego_fetch.mjs")));

    if engine == "claude" {
        log(app, "info", "▶ Claude Code에게 ego 수집을 맡겨요 (곳당 10초, 한 번에 150곳)");
        let prompt = format!(
            "너는 '탕방 데이터 수집 도구' 앱이 부른 수집 담당이다. 이 프로젝트 폴더에서 네이버 페이지를 ego 브라우저로 저장하는 일만 한다.\n\
             1. 아래 명령을 Bash 도구로 실행한다. Bash의 timeout은 600000으로 준다. 스크립트가 10초 간격·한 번에 150곳·캡차 멈춤을 스스로 지킨다.\n\
             ego-browser nodejs -e \"{entry}\"\n\
             2. 실행이 끝나면 data/collected/ego_fetch_status.json을 Read로 읽는다. state가 \"more\"이면 1번 명령을 그대로 다시 실행하고, 다른 값이면 멈춘다.\n\
             3. 캡차·차단·빈 페이지로 멈췄으면 다시 시도하지 않는다. 새 세션, 다른 주소, 위장 같은 방법으로 피해 가지 않는다. 이 명령 말고 다른 페이지를 열거나 파일을 고치지 않는다.\n\
             4. 끝나면 저장 개수와 멈춘 이유를 한국어 세 줄 이내로 알려 준다. 주소는 적지 않는다."
        );
        let mut c = command("claude", root)?;
        c.args(["-p", "--permission-mode", "dontAsk", "--allowedTools", "Bash(ego-browser nodejs:*)", "Read"]);
        let ok = run_proc(app, st, c, Some(prompt))?;
        if !ok && !st.stop.load(Ordering::SeqCst) {
            return Err("Claude Code가 실패했어요. 터미널에서 claude 로 로그인돼 있는지 확인하거나 '직접 실행'으로 바꿔 주세요".into());
        }
    } else {
        log(app, "info", "▶ ego 브라우저로 직접 받아요 (곳당 10초, 한 번에 150곳)");
        loop {
            let mut c = command("ego-browser", root)?;
            c.args(["nodejs", "-e", &entry]);
            if !run_proc(app, st, c, None)? && !st.stop.load(Ordering::SeqCst) {
                return Err("ego 브라우저 실행이 실패했어요. ego lite가 켜져 있는지 확인해 주세요".into());
            }
            if st.stop.load(Ordering::SeqCst) || read_status(root)["state"] != "more" {
                break;
            }
        }
    }
    let s = read_status(root);
    let state = s["state"].as_str().unwrap_or("");
    let reason = s["reason"].as_str().unwrap_or("").to_string();
    log(app, "info", format!("ego 수집: 저장 {} · 빈 페이지 {} · {}", s["saved"], s["failed"], if reason.is_empty() { state } else { &reason }));
    Ok(matches!(state, "captcha" | "failed" | "stopped").then_some(reason))
}

fn pipeline(app: &AppHandle, st: &Shared, root: &Path, plan: &str, engine: &str, refresh_days: Option<i64>) -> Result<String, String> {
    let stopped = || st.stop.load(Ordering::SeqCst);
    macro_rules! go {
        ($id:expr, $body:expr) => {{
            if stopped() {
                step(app, $id, "skip", "멈춤");
                return Ok("멈췄어요".into());
            }
            step(app, $id, "run", "");
            match (|| -> Result<Option<String>, String> { $body })() {
                Ok(note) => step(app, $id, if note.is_some() { "warn" } else { "ok" }, note.clone().unwrap_or_default()),
                Err(e) => {
                    step(app, $id, "fail", e.clone());
                    return Err(e);
                }
            }
        }};
    }
    if let Some(bin) = plan.strip_prefix("tool:") {
        go!(plan, cargo_bin(app, st, root, bin, &[]).map(|_| None));
        return Ok(format!("{bin} 완료"));
    }
    let mut warn: Option<String> = None;
    let all = plan == "all";
    if all || plan == "prepare" {
        go!("prepare", {
            cargo_bin(app, st, root, "find_naver_ids", &[])?;
            // 다시 받기: 수집일이 N일 넘게 지난 곳도 목록에 넣는다(오래된 곳부터, 새 곳과 합쳐 150곳까지)
            let days = refresh_days.map(|d| d.to_string());
            let args: Vec<&str> = match &days { Some(d) => vec!["--refresh-days", d.as_str()], None => vec![] };
            cargo_bin(app, st, root, "collect_home", &args)?;
            cargo_bin(app, st, root, "collect_reviews", &args)?;
            let mut blog_args = vec!["--kind", "blog"];
            blog_args.extend(args.iter().copied());
            cargo_bin(app, st, root, "collect_reviews", &blog_args)?;
            cargo_bin(app, st, root, "collect_photos", &args)?; // 사진 후보(업체 등록 사진 주소)
            Ok(None)
        });
    }
    if all || plan == "fetch" {
        go!("fetch", {
            let t = now_ms();
            let w = fetch(app, st, root, engine);
            *st.fetch_secs.lock().unwrap() = Some(((now_ms() - t) / 1000) as u64);
            let w = w?;
            warn = w.clone();
            Ok(w)
        });
    }
    if all || plan == "read" {
        go!("read", {
            cargo_bin(app, st, root, "find_naver_ids", &[])?;
            cargo_bin(app, st, root, "collect_home", &[])?;
            // 읽기만(받을 목록은 1단계에서 이미 만듦)
            cargo_bin(app, st, root, "collect_reviews", &["--max", "0"])?;
            cargo_bin(app, st, root, "collect_reviews", &["--kind", "blog", "--max", "0"])?;
            cargo_bin(app, st, root, "collect_photos", &["--max", "0"])?;
            Ok(None)
        });
    }
    if all || plan == "judge" {
        go!("judge", {
            // 공공데이터(목욕장업 인허가) 영업상태·면적을 먼저 맞춘다(원본이 없으면 안내만 하고 넘어감)
            cargo_bin(app, st, root, "license_check", &[])?;
            cargo_bin(app, st, root, "judge_facts", &[])?;
            // 후기 근거가 없거나 적으면 TOP 3가 적게 나온다. 끝내되 '멈춤'(주의)으로 표시해 알린다
            let n = std::fs::read_to_string(root.join("data/collected/naver_reviews.jsonl")).map(|t| t.lines().filter(|l| !l.trim().is_empty()).count()).unwrap_or(0);
            Ok((n < 300).then(|| format!("후기 근거가 {n}곳뿐이라 TOP 3가 적게 나와요. 수집을 더 돌려 후기를 받아 주세요")))
        });
    }
    if all || plan == "merge" {
        go!("merge", cargo_bin(app, st, root, "onsen_merge", &[]).map(|_| None));
    }
    if all || plan == "export" {
        go!("export", cargo_bin(app, st, root, "export_web_data", &[]).map(|_| None));
    }
    Ok(match warn {
        Some(w) => format!("받은 만큼 정리했어요. {w}"),
        None => "모두 끝났어요".into(),
    })
}

#[tauri::command]
fn start(app: AppHandle, st: State<'_, Shared>, plan: String, engine: String, refresh_days: Option<i64>) -> Result<(), String> {
    let root = root_of(&st)?;
    if st.running.swap(true, Ordering::SeqCst) {
        return Err("이미 실행 중이에요".into());
    }
    st.stop.store(false, Ordering::SeqCst);
    if plan == "all" || plan == "fetch" {
        // 지난 작업의 진행 상황이 새 실행의 진행 막대·남은 시간에 섞이지 않게
        let _ = std::fs::remove_file(root.join("data/collected/ego_fetch_status.json"));
    }
    let st = st.inner().clone();
    thread::spawn(move || {
        let t0 = now_ms();
        *st.fetch_secs.lock().unwrap() = None;
        let r = pipeline(&app, &st, &root, &plan, &engine, refresh_days);
        st.running.store(false, Ordering::SeqCst);
        let stopped = st.stop.load(Ordering::SeqCst);
        let fs = read_status(&root);
        let fetched = plan == "all" || plan == "fetch";
        append_run(
            &root,
            json!({
                "at": SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
                "plan": plan,
                "engine": if fetched { engine.as_str() } else { "" },
                "ok": r.is_ok() && !stopped,
                "message": match &r { Ok(m) => if stopped { "멈췄어요".to_string() } else { m.clone() }, Err(e) => e.clone() },
                "saved": if fetched { fs["saved"].clone() } else { Value::Null },
                "failed": if fetched { fs["failed"].clone() } else { Value::Null },
                "fetchState": if fetched { fs["state"].clone() } else { Value::Null },
                "seconds": ((now_ms() - t0) / 1000) as u64,
                "fetchSeconds": *st.fetch_secs.lock().unwrap(),
                "pages": if fetched { fs["done"].clone() } else { Value::Null },
            }),
        );
        let _ = app.emit(
            "finished",
            match r {
                Ok(m) => json!({ "ok": !stopped, "message": if stopped { "멈췄어요".to_string() } else { m } }),
                Err(e) => json!({ "ok": false, "message": e }),
            },
        );
    });
    Ok(())
}

#[tauri::command]
fn stop(st: State<'_, Shared>) -> Result<(), String> {
    st.stop.store(true, Ordering::SeqCst);
    if let Some(root) = st.root.lock().unwrap().clone() {
        // ego_fetch.mjs는 다음 페이지로 넘어가기 전에 이 파일을 보고 멈춘다
        let _ = std::fs::write(root.join("data/collected/ego_fetch_stop"), "stop");
    }
    if let Some(pid) = *st.pid.lock().unwrap() {
        let st = st.inner().clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(12)); // 페이지 하나를 마칠 시간을 준 뒤에도 살아 있으면 끈다
            // 그새 끝났으면 끄지 않는다. 끝난 프로세스 번호는 다른 프로그램이 다시 받을 수 있어서, 그대로 끄면 엉뚱한 걸 끈다
            if *st.pid.lock().unwrap() == Some(pid) {
                kill_tree(pid);
            }
        });
    }
    Ok(())
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(0x0800_0000).output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
    }
}

#[tauri::command]
fn is_running(st: State<'_, Shared>) -> bool {
    st.running.load(Ordering::SeqCst)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![get_root, set_root, check_env, summary, dashboard, photos, pick_photo, publish_status, fetch_status, start, stop, is_running])
        .run(tauri::generate_context!())
        .expect("탕방 데이터 수집 도구를 열지 못했어요");
}
