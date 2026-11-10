//! 탕방 제보함: 사이트에서 들어온 제보를 받아서 → 근거를 확인하고 → 반영하는 운영자용 화면. 내 PC에서만 돈다.
//! 실행: cargo run --release --bin report_desk            (http://127.0.0.1:8765 가 브라우저로 열린다, 끄려면 Ctrl+C)
//!       cargo run --release --bin report_desk -- --demo  (예시 제보로 보기. 파일·DB는 아무것도 바꾸지 않는다)
//!       옵션: --port 번호, --no-open
//! 규칙은 src/reportdesk.rs, 요구사항은 docs/prd-report-triage.md.
//! - 제보 읽기·상태 바꾸기·공개는 scripts/d1_publish.mjs(--json)에 맡긴다. 관리 토큰·Worker 주소는 이 프로그램이 읽지 않고 출력하지도 않는다.
//! - 127.0.0.1에서만 열리고, Host가 로컬이 아니거나 실행할 때 만든 토큰이 없는 '바꾸는 요청'은 거절한다.

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;

use tangbang_data::reportdesk::{self as desk, Action};
use tangbang_data::{csvio, pyjson, util};

const PAGE: &str = include_str!("../report_desk.html");
const COLORS: &str = include_str!("../../web/src/styles/tangbang-colors.css");
const READ_COND: &str = "상태 new, 최근 200건까지";
const MAX_BODY: usize = 256 * 1024;

struct App {
    demo: bool,
    token: String,
    port: u16,
    demo_reports: Vec<Value>,
    last: Option<Undo>,
}

/// 파일 하나를 바꾼 기록(되돌리기용).
struct FileChange {
    path: &'static str,
    before: String,
    after: String,
}
/// 방금 한 판정. 되돌리기는 한 단계만 한다.
struct Undo {
    label: String,
    ids: Vec<i64>,
    files: Vec<FileChange>,
    removed: Vec<Value>, // 예시 모드에서 목록에서 뺀 제보
}

struct Req {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_req(stream: &TcpStream) -> Option<Req> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(10))).ok()?;
    let mut rd = BufReader::new(stream);
    let mut line = String::new();
    rd.read_line(&mut line).ok()?;
    let mut it = line.split_whitespace();
    let (method, path) = (it.next()?.to_string(), it.next()?.to_string());
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if rd.read_line(&mut h).ok()? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        return None;
    }
    let mut body = vec![0; len];
    rd.read_exact(&mut body).ok()?;
    Some(Req { method, path: path.split('?').next().unwrap_or("/").to_string(), headers, body })
}

fn respond(mut stream: &TcpStream, status: &str, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}
fn send_json(stream: &TcpStream, status: &str, v: &Value) {
    respond(stream, status, "application/json; charset=utf-8", v.to_string().as_bytes());
}

/// scripts/d1_publish.mjs를 --json으로 부른다. 성공하면 data, 실패하면 '무슨 일 + 다음에 할 일' 문장.
fn d1(args: &[&str]) -> Result<Value> {
    let out = Command::new("node")
        .args(["--env-file=.env", "scripts/d1_publish.mjs"])
        .args(args)
        .arg("--json")
        .output()
        .map_err(|_| anyhow!("node를 실행하지 못했어요. Node.js가 설치되어 있는지 확인해 주세요"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let j: Value = text
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .and_then(|l| serde_json::from_str(l).ok())
        .ok_or_else(|| anyhow!("관리 도구(d1_publish.mjs)가 결과를 내지 않았어요. .env가 프로젝트 폴더에 있는지 확인해 주세요"))?;
    if j["ok"].as_bool() == Some(true) {
        return Ok(j["data"].clone());
    }
    let e = &j["error"];
    let problems: Vec<&str> = e["problems"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect()).unwrap_or_default();
    bail!(
        "{} {}{}",
        e["message"].as_str().unwrap_or("관리 도구가 오류를 냈어요"),
        e["fix"].as_str().unwrap_or(""),
        if problems.is_empty() { String::new() } else { format!(" ({})", problems.join(" / ")) }
    )
}

fn load_places() -> Result<Vec<Value>> {
    let v = pyjson::load_file(desk::ONSEN_FILE)?;
    Ok(v["places"].as_array().cloned().unwrap_or_default())
}
fn place_map(list: &[Value]) -> HashMap<String, Value> {
    list.iter().filter_map(|p| Some((p["id"].as_str()?.to_string(), p.clone()))).collect()
}

fn mtime(path: &str) -> Option<std::time::SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}
/// 확인 파일이 화면 데이터보다 나중에 바뀌었는지(= 반영했지만 화면 데이터에 아직 안 들어감).
fn curated_newer() -> bool {
    match mtime(desk::ONSEN_FILE) {
        Some(o) => [desk::PRICE_FILE, desk::FACTS_FILE].iter().any(|f| mtime(f).is_some_and(|t| t > o)),
        None => false,
    }
}

impl App {
    fn reports(&self) -> Result<Vec<Value>> {
        if self.demo {
            return Ok(self.demo_reports.clone());
        }
        Ok(d1(&["reports", "new"])?["reports"].as_array().cloned().unwrap_or_default())
    }

    fn list(&self) -> Result<Value> {
        let places = place_map(&load_places()?);
        let reports = self.reports()?;
        let mut groups = desk::triage(&reports, &places);
        // 이미 수집해 둔 네이버 근거를 제보 옆에 붙인다(제보가 들어온 업체만)
        let home = home_facts();
        for g in groups.iter_mut() {
            let ev = g["place_id"].as_str().and_then(|id| home.get(id)).map(desk::evidence).unwrap_or(Value::Null);
            g["evidence"] = ev;
        }
        let sweep = desk::plan_sweep(&groups, &util::today_kst());
        // 조건: 상태 new 제보를 업체별로 묶어 칩마다 센다(제보 건수 기준)
        let mut counts: Map<String, Value> = desk::CHIPS.iter().map(|c| (c.to_string(), json!(0))).collect();
        for g in &groups {
            let n = g["report_ids"].as_array().map(|a| a.len()).unwrap_or(0);
            let c = g["chip"].as_str().unwrap_or("");
            counts.insert(c.to_string(), json!(counts[c].as_u64().unwrap_or(0) + n as u64));
        }
        Ok(json!({
            "ok": true, "demo": self.demo, "total": reports.len(), "groups": groups, "counts": counts,
            "cond": READ_COND, "today": util::today_kst(), "stale": !self.demo && curated_newer(),
            "sweep": sweep.len(), "undo": self.last.as_ref().map(|u| u.label.clone()),
            "options": { "towel": desk::TOWEL_OPTIONS, "dryer": desk::DRYER_OPTIONS, "pay": desk::PAY_OPTIONS },
        }))
    }

    fn decide(&mut self, b: &Value) -> Result<Value> {
        let today = util::today_kst();
        let place_id = b["place_id"].as_str().unwrap_or("");
        let ids: Vec<i64> = b["ids"].as_array().map(|a| a.iter().filter_map(|x| x.as_i64()).collect()).unwrap_or_default();
        if ids.is_empty() {
            bail!("처리할 제보가 없어요");
        }
        // 화면이 오래됐을 수 있으니 지금 new인 제보로 다시 확인한다
        let all = self.reports()?;
        let picked: Vec<Value> = all
            .iter()
            .filter(|r| r["id"].as_i64().is_some_and(|i| ids.contains(&i)) && r["place_id"].as_str() == Some(place_id))
            .cloned()
            .collect();
        if picked.len() != ids.len() {
            bail!("그사이 제보 상태가 바뀌었어요. 새로고침한 뒤 다시 해 주세요");
        }
        let verdict = b["verdict"].as_str().unwrap_or("");
        let mut wrote: Vec<String> = Vec::new();
        let mut files: Vec<FileChange> = Vec::new();
        let plan: Vec<Action> = match verdict {
            "apply" => {
                let ev = b["evidence"].as_object().cloned().unwrap_or_default();
                let source = b["source"].as_str().unwrap_or("").trim().to_string();
                desk::check_evidence(&ev)?;
                if source.is_empty() {
                    bail!("근거 출처를 골라 주세요");
                }
                if picked.iter().any(desk::is_test) || !desk::can_key(place_id) || !place_map(&load_places()?).contains_key(place_id) {
                    bail!("이 업체는 반영할 수 없어요(시험 제보이거나, 서비스 목록에 없거나, 업체ID가 줄 번호예요). 반려 또는 확인 못 함으로 처리해 주세요");
                }
                let plan = desk::plan_apply(&picked, &ev, &source, &today);
                if !self.demo {
                    (wrote, files) = write_curated(place_id, &ev, &source, &today)?;
                }
                plan
            }
            "reject" => {
                let reason = b["reason"].as_str().unwrap_or("").trim();
                if reason.is_empty() {
                    bail!("반려 사유를 골라 주세요");
                }
                desk::plan_reject(&picked, reason, &today)
            }
            "unknown" => desk::plan_unknown(&picked, b["memo"].as_str().unwrap_or(""), &today),
            _ => bail!("판정을 골라 주세요"),
        };
        let label = format!("{} {}", b["place_name"].as_str().unwrap_or("제보"), match verdict { "apply" => "반영", "reject" => "반려", _ => "확인 못 함" });
        let (done, failed) = self.run(&plan, label, files);
        Ok(json!({ "ok": failed.is_empty(), "demo": self.demo, "done": done, "failed": failed, "wrote": wrote }))
    }

    /// 계획대로 제보 상태를 바꾸고, 되돌릴 수 있게 방금 한 일을 기억한다(한 단계만).
    fn run(&mut self, plan: &[Action], label: String, files: Vec<FileChange>) -> (Vec<Value>, Vec<Value>) {
        let (mut done, mut failed, mut ids) = (Vec::new(), Vec::new(), Vec::new());
        for a in plan {
            let res = if self.demo { Ok(Value::Null) } else { d1(&["report-set", &a.id.to_string(), a.status, &a.note]) };
            match res {
                Ok(_) => {
                    ids.push(a.id);
                    done.push(json!({ "id": a.id, "status": a.status, "note": a.note }))
                }
                Err(e) => failed.push(json!({ "id": a.id, "status": a.status, "error": e.to_string() })),
            }
        }
        let mut removed = Vec::new();
        if self.demo {
            let (gone, keep): (Vec<Value>, Vec<Value>) = self.demo_reports.drain(..).partition(|r| r["id"].as_i64().is_some_and(|i| ids.contains(&i)));
            self.demo_reports = keep;
            removed = gone;
        }
        self.last = (!ids.is_empty() || !files.is_empty()).then_some(Undo { label, ids, files, removed });
        (done, failed)
    }

    /// 정리 대상(시험·반려 추천·이미 반영됨)을 한 번에 처리한다. 대상은 누르는 순간의 제보로 다시 계산한다.
    fn sweep(&mut self) -> Result<Value> {
        let places = place_map(&load_places()?);
        let plan = desk::plan_sweep(&desk::triage(&self.reports()?, &places), &util::today_kst());
        if plan.is_empty() {
            bail!("정리할 제보가 없어요");
        }
        let (done, failed) = self.run(&plan, format!("정리 {}건", plan.len()), vec![]);
        Ok(json!({ "ok": failed.is_empty(), "demo": self.demo, "done": done, "failed": failed, "wrote": [] }))
    }

    /// 방금 한 판정을 되돌린다: 파일을 판정 전 글자로 돌려놓고 제보를 다시 new로 바꾼다.
    fn undo(&mut self) -> Result<Value> {
        let Some(u) = self.last.take() else { bail!("되돌릴 것이 없어요") };
        let mut lines = Vec::new();
        for f in &u.files {
            // 그 뒤에 파일이 또 바뀌었으면 덮어쓰지 않는다
            if std::fs::read_to_string(f.path).ok().as_deref() == Some(f.after.as_str()) {
                std::fs::write(f.path, &f.before).map_err(|e| anyhow!("⛔ {}을(를) 되돌리지 못했어요: {e}", f.path))?;
                lines.push(format!("파일 되돌림: {}", f.path));
            } else {
                lines.push(format!("{}은(는) 그 뒤에 바뀌어서 되돌리지 않았어요. 직접 확인해 주세요", f.path));
            }
        }
        let mut failed = 0;
        for id in &u.ids {
            if !self.demo && d1(&["report-set", &id.to_string(), "new"]).is_err() {
                failed += 1;
            }
        }
        self.demo_reports.extend(u.removed);
        lines.push(format!("제보 {}건을 다시 새 제보로 돌렸어요{}", u.ids.len() - failed, if failed > 0 { format!(" · {failed}건은 실패(다시 읽어 확인해 주세요)") } else { String::new() }));
        Ok(json!({ "ok": failed == 0, "label": u.label, "lines": lines }))
    }

    fn rebuild(&self) -> Result<Value> {
        if self.demo {
            return Ok(json!({ "ok": true, "demo": true, "lines": ["예시 모드라 화면 데이터를 다시 만들지 않았어요."] }));
        }
        let out = Command::new("cargo")
            .args(["run", "--release", "--quiet", "--bin", "export_web_data"])
            .output()
            .map_err(|_| anyhow!("cargo를 실행하지 못했어요"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            let tail: Vec<&str> = err.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
            bail!("화면 데이터 만들기(export_web_data)가 실패했어요: {}", tail.join(" / "));
        }
        let ing = d1(&["ingest"])?;
        let diff = d1(&["diff"])?;
        Ok(json!({ "ok": true, "ingest": { "received": ing["received"], "upserted": ing["upserted"], "deleted": ing["deleted"] },
            "counts": diff["counts"], "added": diff["added"], "removed": diff["removed"], "priceChanges": diff["priceChanges"] }))
    }

    fn publish(&self) -> Result<Value> {
        if self.demo {
            return Ok(json!({ "ok": true, "demo": true }));
        }
        let j = d1(&["publish", "--note", "제보함 반영"])?;
        Ok(json!({ "ok": true, "from": j["from"], "to": j["to"], "count": j["count"] }))
    }
}

/// 확인한 값을 data/curated/에 적는다. 요금은 onsen_prices.csv, 나머지는 place_facts.json. 둘 다 준비된 뒤에 쓴다.
fn write_curated(place_id: &str, ev: &Map<String, Value>, source: &str, today: &str) -> Result<(Vec<String>, Vec<FileChange>)> {
    let mut wrote = Vec::new();
    let mut files = Vec::new();
    let (adult, towel) = (ev.get("adult").and_then(|v| v.as_i64()), ev.get("towel").and_then(|v| v.as_i64()));
    let mut price_out = None;
    if adult.is_some() || towel.is_some() {
        let bytes = std::fs::read(desk::PRICE_FILE).map_err(|_| anyhow!("⛔ {} 파일을 찾지 못했어요", desk::PRICE_FILE))?;
        let text = String::from_utf8(bytes).map_err(|_| anyhow!("⛔ {}이(가) utf-8이 아니에요. 자동으로 쓰지 않았어요", desk::PRICE_FILE))?;
        let (out, what) = desk::update_prices_text(&text, place_id, adult, towel, source, today)?;
        price_out = Some((out, what, text));
    }
    let mut facts_out = None;
    if ev.keys().any(|k| !["adult", "towel"].contains(&k.as_str())) {
        let text = std::fs::read_to_string(desk::FACTS_FILE).map_err(|_| anyhow!("⛔ {} 파일을 찾지 못했어요", desk::FACTS_FILE))?;
        let (mut root, nl) = desk::load_facts_text(&text)?;
        let done = desk::update_facts(&mut root, place_id, ev, source, today)?;
        facts_out = Some((desk::facts_text(&root, nl), done, text));
    }
    // 줄 끝을 바꾸지 않도록 글자 그대로 쓴다(util::write_text는 윈도우에서 \n을 \r\n으로 바꾼다)
    if let Some((out, what, before)) = price_out {
        std::fs::write(desk::PRICE_FILE, &out).map_err(|e| anyhow!("⛔ {}에 쓰지 못했어요: {e}", desk::PRICE_FILE))?;
        wrote.push(format!("{}: {what}", desk::PRICE_FILE));
        files.push(FileChange { path: desk::PRICE_FILE, before, after: out });
    }
    if let Some((out, done, before)) = facts_out {
        std::fs::write(desk::FACTS_FILE, &out).map_err(|e| anyhow!("⛔ {}에 쓰지 못했어요: {e}", desk::FACTS_FILE))?;
        wrote.push(format!("{}: {place_id} {}", desk::FACTS_FILE, done.join(", ")));
        files.push(FileChange { path: desk::FACTS_FILE, before, after: out });
    }
    Ok((wrote, files))
}

/// 이미 수집해 둔 네이버 홈 근거(카카오ID → 한 줄). 파일이 없으면 빈 목록.
fn home_facts() -> HashMap<String, HashMap<String, String>> {
    if !util::exists(desk::HOME_FACTS_FILE) {
        return HashMap::new();
    }
    csvio::read_csv(desk::HOME_FACTS_FILE, false, csvio::Dtype::AllStr)
        .map(|t| t.records().into_iter().filter_map(|r| Some((r.get("카카오ID")?.clone(), r))).collect())
        .unwrap_or_default()
}

fn handle(app: &mut App, stream: &TcpStream) {
    let Some(req) = read_req(stream) else { return };
    // 다른 사이트가 이 주소를 제 이름으로 불러 쓰지 못하게 Host를 확인한다
    let host = req.headers.get("host").map(|h| h.as_str()).unwrap_or("");
    if host != format!("127.0.0.1:{}", app.port) && host != format!("localhost:{}", app.port) {
        return respond(stream, "403 Forbidden", "text/plain; charset=utf-8", "로컬에서만 열 수 있어요".as_bytes());
    }
    let api = |r: Result<Value>| match r {
        Ok(v) => send_json(stream, "200 OK", &v),
        Err(e) => send_json(stream, "200 OK", &json!({ "ok": false, "error": e.to_string() })),
    };
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/") => {
            let page = PAGE.replace("__TOKEN__", &app.token);
            respond(stream, "200 OK", "text/html; charset=utf-8", page.as_bytes())
        }
        ("GET", "/colors.css") => respond(stream, "200 OK", "text/css; charset=utf-8", COLORS.as_bytes()),
        ("GET", "/api/reports") => api(app.list()),
        ("POST", p) => {
            if req.headers.get("x-desk-token") != Some(&app.token) {
                return send_json(stream, "403 Forbidden", &json!({ "ok": false, "error": "이 창에서 연 화면이 아니에요. 새로고침해 주세요" }));
            }
            let body: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
            match p {
                "/api/decide" => api(app.decide(&body)),
                "/api/sweep" => api(app.sweep()),
                "/api/undo" => api(app.undo()),
                "/api/rebuild" => api(app.rebuild()),
                "/api/publish" => api(app.publish()),
                _ => respond(stream, "404 Not Found", "text/plain", b""),
            }
        }
        _ => respond(stream, "404 Not Found", "text/plain", b""),
    }
}

fn random_token() -> String {
    // 표준 라이브러리의 무작위 씨앗(운영체제에서 받음)으로 실행할 때마다 다른 값을 만든다
    (0..2)
        .map(|i| {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(i);
            format!("{:016x}", h.finish())
        })
        .collect()
}

fn open_browser(url: &str) {
    let _ = if cfg!(windows) {
        Command::new("cmd").args(["/C", "start", "", url]).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).spawn()
    };
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let demo = args.iter().any(|a| a == "--demo");
    let port: u16 = args.iter().position(|a| a == "--port").and_then(|i| args.get(i + 1)).and_then(|p| p.parse().ok()).unwrap_or(8765);
    if !util::exists("Cargo.toml") || !util::exists(desk::ONSEN_FILE) {
        bail!("⛔ 프로젝트 폴더(Cargo.toml이 있는 곳)에서 실행해 주세요. {}도 있어야 해요", desk::ONSEN_FILE);
    }
    let demo_reports = if demo {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        desk::demo_reports(&load_places()?, &now)
    } else {
        vec![]
    };
    let mut app = App { demo, token: random_token(), port, demo_reports, last: None };
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| anyhow!("⛔ 127.0.0.1:{port}를 열지 못했어요({e}). 이미 떠 있으면 그 창을 쓰거나 --port로 다른 번호를 주세요"))?;
    let url = format!("http://127.0.0.1:{port}/");
    println!("탕방 제보함: {url} (끄려면 Ctrl+C){}", if demo { " · 예시 모드: 파일·DB를 바꾸지 않아요" } else { "" });
    println!("읽는 조건: {READ_COND}");
    if !args.iter().any(|a| a == "--no-open") {
        open_browser(&url);
    }
    for stream in listener.incoming().flatten() {
        handle(&mut app, &stream);
    }
    Ok(())
}
