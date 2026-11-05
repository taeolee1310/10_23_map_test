//! 네이버 플레이스 '방문자 리뷰' 탭에서 키워드(수건·드라이기·세신·샴푸·폐업 등)가 든 문장을 방문일과 함께 모은다.
//! 판정(judge_facts)이 이 문장을 방문일 기준 신뢰도로 쓴다(최근 1년 = 중간, 그 전 = 낮음).
//! 페이지는 ego 브라우저가 연다(러스트는 브라우저를 띄우지 않는다). collect_home과 같은 두 단계다.
//!
//! 1) 이 도구를 돌리면 아직 안 받은 곳(+ --refresh-days N이면 N일 지난 곳)을 data/collected/naver_review_todo.csv에 적는다.
//! 2) ego 브라우저(scripts/ego_fetch.mjs)가 후기 탭을 열어 '펼쳐서 더보기'를 4번까지 누른 뒤 화면 글자를
//!    data/collected/naver_pages/review/<네이버ID>.txt에 저장한다. 곳당 10초 간격, 한 번에 150곳, 캡차가 보이면 멈춘다.
//! 3) 다시 돌리면 저장된 페이지를 읽어 data/collected/naver_reviews.jsonl을 고친다(곳마다 한 줄, 새로 받으면 바꿈).
//! - 작성자 이름·후기 원문 전체는 저장하지 않는다. 키워드가 든 300자 미만 줄만 방문일과 함께 남긴다.
//! - naver_reviews.jsonl과 받은 페이지는 후기 문장이 들어 있어 깃에 올리지 않는다.
//! (예전 scripts/collect_reviews.mjs의 parse와 같은 규칙. 그 스크립트는 받기와 읽기를 한 번에 했다)
//!
//! --kind blog: '블로그 리뷰' 탭(/review/ugc)을 같은 방식으로 모은다 → naver_blog_todo.csv, naver_pages/blog/, naver_blogs.jsonl.
//!   글 본문은 긴 단락이라 문장으로 나눠 키워드가 든 문장만 작성일과 함께 남긴다. 판정은 '[블로그 YYYY년 M월 D일]' 근거로 쓴다.
//!
//! 실행(프로젝트 폴더에서): cargo run --release --bin collect_reviews -- [--kind visitor|blog] [--max 150] [--refresh-days 30]

use anyhow::Result;
use clap::Parser;
use serde_json::{json, Value};
use std::collections::HashMap;
use tangbang_data::csvio::{self, g, Row};
use tangbang_data::naver::{self, targets, PAGES};
use tangbang_data::{re, util};

re!(
    KEY,
    r"수건|타월|타올|드라이|세신|때밀이|샴푸|바디워시|어메니티|폐업|휴업|입장료|목욕비|목욕료|이용요금|이용료|대인|성인|마감|문\s?닫|영업\s?시간|운영|중단|휴업|공사|폐쇄"
);
re!(VISIT, r"(20\d\d)년 (\d{1,2})월 (\d{1,2})일");
// 블로그 탭: 글마다 '작성자 / 블로그 이름 / 제목 / 본문 일부' 다음에 '26.1.24.토' + '2026년 1월 24일 토요일'이 온다
re!(
    BLOG_DATE,
    r"\n\d{2}\.\d{1,2}\.\d{1,2}\.[월화수목금토일]\n(20\d\d)년 (\d{1,2})월 (\d{1,2})일 [월화수목금토일]요일"
);

const LINK_MARK: &str = "[[탕방:블로그글]]";
const POST_TODO: &str = "data/collected/naver_blogpost_todo.csv";
/// 곳마다 원문을 열어 볼 블로그 글 수 상한(최근 1년 안 글은 모두 보는 게 원칙, 사용자 결정 2026-11-04. 안전 상한만 둔다)
const POSTS_PER_PLACE: usize = 40;

/// 어느 탭을 모을지: 방문자 후기(visitor) / 블로그 리뷰(blog)
#[derive(Clone, Copy, PartialEq, clap::ValueEnum)]
enum Kind {
    Visitor,
    Blog,
}
impl Kind {
    fn out(self) -> &'static str {
        match self {
            Kind::Visitor => "data/collected/naver_reviews.jsonl",
            Kind::Blog => "data/collected/naver_blogs.jsonl",
        }
    }
    fn todo(self) -> &'static str {
        match self {
            Kind::Visitor => "data/collected/naver_review_todo.csv",
            Kind::Blog => "data/collected/naver_blog_todo.csv",
        }
    }
    fn url(self, naver_id: &str) -> String {
        match self {
            Kind::Visitor => format!("https://m.place.naver.com/place/{naver_id}/review/visitor"),
            Kind::Blog => format!("https://m.place.naver.com/place/{naver_id}/review/ugc"),
        }
    }
    fn file(self, naver_id: &str) -> String {
        match self {
            Kind::Visitor => format!("{PAGES}/review/{naver_id}.txt"),
            Kind::Blog => format!("{PAGES}/blog/{naver_id}.txt"),
        }
    }
    fn name(self) -> &'static str {
        match self {
            Kind::Visitor => "방문자 후기",
            Kind::Blog => "블로그 리뷰",
        }
    }
    /// 탭이 제대로 열렸는지(가게 페이지 표시)
    fn valid(self, text: &str) -> bool {
        text.contains("마이플레이스")
    }
    fn parse(self, text: &str) -> (usize, String, String, Vec<Value>) {
        match self {
            Kind::Visitor => parse_visitor(text),
            Kind::Blog => parse_blog(text),
        }
    }
}

#[derive(Parser)]
struct Args {
    /// 모을 탭: visitor(방문자 후기, 기본) / blog(블로그 리뷰)
    #[arg(long, value_enum, default_value_t = Kind::Visitor)]
    kind: Kind,
    /// 한 번에 ego로 열 곳 수 상한
    #[arg(long, default_value_t = 150)]
    max: usize,
    /// 마지막으로 받은 날이 이 날수보다 오래된 곳은 다시 받는다
    #[arg(long)]
    refresh_days: Option<i64>,
    /// 저장된 페이지를 날짜와 상관없이 다시 읽는다(키워드를 바꿨을 때)
    #[arg(long)]
    reparse: bool,
}

fn short(s: &str) -> bool {
    !s.is_empty() && s.encode_utf16().count() < 300
}

/// 방문자 후기 탭 글자 → (후기 수, 가장 최근 방문일, 가장 이른 방문일, 키워드 줄이 있는 후기들)
fn parse_visitor(text: &str) -> (usize, String, String, Vec<Value>) {
    let parts: Vec<&str> = text.split("반응 남기기\n방문일\n").collect();
    let mut dates: Vec<String> = Vec::new();
    let mut reviews = Vec::new();
    for i in 0..parts.len().saturating_sub(1) {
        let Some(m) = VISIT.captures(parts[i + 1]) else {
            continue;
        };
        let date = format!("{}-{:0>2}-{:0>2}", &m[1], &m[2], &m[3]);
        dates.push(date.clone());
        let lines: Vec<&str> = parts[i]
            .split('\n')
            .map(str::trim)
            .filter(|s| short(s) && KEY.is_match(s))
            .collect();
        if !lines.is_empty() {
            reviews.push(json!({ "date": date, "lines": lines }));
        }
    }
    dates.sort();
    (
        dates.len(),
        dates.last().cloned().unwrap_or_default(),
        dates.first().cloned().unwrap_or_default(),
        reviews,
    )
}

/// 블로그 탭 글자 → (글 수, 가장 최근 작성일, 가장 이른 작성일, 키워드 문장이 있는 글들).
/// 본문은 긴 한 단락이라 문장으로 나눈 뒤 키워드가 든 300자 미만 문장만 남긴다(글 전체는 저장하지 않는다)
/// 블로그 탭 파일 끝에 ego_fetch가 붙인 글 주소·작성일: [(url, date)]
fn blog_links(text: &str) -> Vec<(String, String)> {
    let Some((_, j)) = text.split_once(LINK_MARK) else { return vec![] };
    serde_json::from_str::<Vec<Value>>(j.trim())
        .unwrap_or_default()
        .iter()
        .filter_map(|v| Some((v["url"].as_str()?.to_string(), v["date"].as_str().unwrap_or("").to_string())))
        .collect()
}

/// 블로그 원문 저장 파일: naver_pages/blogpost/<네이버ID>_<블로그아이디>_<글번호>.txt (사진은 blogimg/<같은 이름>_<k>.jpg)
fn post_stem(nid: &str, url: &str) -> Option<String> {
    let mut it = url.trim_end_matches('/').rsplit('/');
    let (no, user) = (it.next()?, it.next()?);
    (no.bytes().all(|b| b.is_ascii_digit()) && !user.is_empty()).then(|| format!("{nid}_{user}_{no}"))
}

/// 원문을 열 때 ego가 찍어 둔 사진 파일(최대 4장)
fn post_images(stem: &str) -> Vec<String> {
    (0..8)
        .map(|k| format!("{PAGES}/blogimg/{stem}_{k}.jpg"))
        .filter(|p| std::path::Path::new(p).exists())
        .collect()
}

/// 블로그 원문에서 키워드 문장만(300자 미만, 같은 문장은 한 번)
fn post_lines(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for s in naver::sentences(text) {
        if short(&s) && KEY.is_match(&s) && !lines.contains(&s) {
            lines.push(s);
        }
    }
    lines
}

fn parse_blog(text: &str) -> (usize, String, String, Vec<Value>) {
    let text = text.split(LINK_MARK).next().unwrap_or("").replace("\r\n", "\n");
    // 글 목록은 '리스트형식으로 보기' 뒤에서 시작한다(위쪽은 가게 머리말)
    let start = text
        .find("리스트형식으로 보기")
        .map(|i| i + "리스트형식으로 보기".len())
        .unwrap_or(0);
    let body = &text[start..];
    let mut dates: Vec<String> = Vec::new();
    let mut posts = Vec::new();
    let mut last = 0;
    for m in BLOG_DATE.captures_iter(body) {
        let whole = m.get(0).unwrap();
        let date = format!("{}-{:0>2}-{:0>2}", &m[1], &m[2], &m[3]);
        dates.push(date.clone());
        let mut lines: Vec<String> = Vec::new();
        for s in naver::sentences(&body[last..whole.start()]) {
            if short(&s) && KEY.is_match(&s) && !lines.contains(&s) {
                lines.push(s);
            }
        }
        if !lines.is_empty() {
            posts.push(json!({ "date": date, "lines": lines }));
        }
        last = whole.end();
    }
    dates.sort();
    (
        dates.len(),
        dates.last().cloned().unwrap_or_default(),
        dates.first().cloned().unwrap_or_default(),
        posts,
    )
}
fn main() -> Result<()> {
    let a = Args::parse();
    let t = targets(None, None)?;
    let today = util::today_kst();
    let kst = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
    let file_day = |path: &str| -> Option<String> {
        let m = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
        Some(
            chrono::DateTime::<chrono::Utc>::from(m)
                .with_timezone(&kst)
                .format("%Y-%m-%d")
                .to_string(),
        )
    };
    let cutoff = a.refresh_days.map(|n| {
        (chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").unwrap() - chrono::Duration::days(n))
            .format("%Y-%m-%d")
            .to_string()
    });

    // 기존 기록: 네이버ID마다 한 줄(같은 곳이 여러 줄이면 마지막 줄)
    let mut rows: Vec<Value> = std::fs::read_to_string(a.kind.out())
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    let mut index: HashMap<String, usize> = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        index.insert(r["naverId"].as_str().unwrap_or("").to_string(), i);
    }
    println!(
        "{} 기록 {}곳 / 대상 {}곳 (오늘 {today}, 한국 시간)",
        a.kind.name(),
        index.len(),
        t.len()
    );
    if let Some(c) = &cutoff {
        println!("다시 받기: 마지막으로 받은 날이 {c} 이전인 곳");
    }

    let make = |r: &Row, text: &str, day: String| -> Value {
        let (count, newest, oldest, reviews) = a.kind.parse(text);
        json!({
            "kakaoId": g(r, "카카오ID"), "naverId": g(r, "네이버ID"), "name": g(r, "이름"),
            "collectedAt": day, "listShown": text.contains(if a.kind == Kind::Blog { "블로그 리뷰" } else { "방문일" }),
            "count": count, "newest": newest, "oldest": oldest, "reviews": reviews,
        })
    };

    let (mut added, mut replaced, mut bad) = (0, 0, 0);
    let mut todo: Vec<Vec<String>> = Vec::new();
    let mut stale: Vec<(String, Vec<String>)> = Vec::new();
    for r in &t {
        let nid = g(r, "네이버ID");
        let path = a.kind.file(nid);
        let line = |again: bool| {
            vec![
                g(r, "카카오ID").to_string(),
                nid.to_string(),
                g(r, "이름").to_string(),
                a.kind.url(nid),
                path.clone(),
                if again { "1".into() } else { String::new() },
            ]
        };
        let saved = naver::read_page(&path);
        if let Some(text) = &saved {
            if naver::blocked(text) {
                println!("⛔ 캡차·차단 화면이 저장돼 있어요 ({}: {path}). 우회하지 않고 멈춥니다. 파일을 지우고 나중에 다시 받으세요.", g(r, "이름"));
                return Ok(());
            }
        }
        match index.get(nid).copied() {
            Some(i) => {
                let old_day = rows[i]["collectedAt"].as_str().unwrap_or("").to_string();
                if let (Some(text), Some(day)) = (&saved, file_day(&path)) {
                    if (day > old_day || a.reparse) && a.kind.valid(text) {
                        rows[i] = make(r, text, day);
                        replaced += 1;
                        continue;
                    }
                }
                if let Some(c) = &cutoff {
                    if old_day.as_str() < c.as_str() {
                        stale.push((old_day, line(true)));
                    }
                }
            }
            None => match &saved {
                // 가게 페이지가 제대로 열렸으면(마이플레이스 표시) 후기 0건이어도 기록한다
                Some(text) if a.kind.valid(text) => {
                    rows.push(make(
                        r,
                        text,
                        file_day(&path).unwrap_or_else(|| today.clone()),
                    ));
                    index.insert(nid.to_string(), rows.len() - 1);
                    added += 1;
                }
                Some(_) => {
                    println!(
                        "건너뜀 {} ({} 페이지가 아님: {path})",
                        g(r, "이름"),
                        a.kind.name()
                    );
                    bad += 1;
                }
                None => todo.push(line(false)),
            },
        }
    }
    // 블로그 원문: 탭에 남긴 글 주소 중 최근 1년 안 글을 최신순으로 모두 연다(곳마다 40개 상한). 받은 원문의 키워드 문장은 'originals'에 둔다
    let mut post_todo: Vec<Vec<String>> = Vec::new();
    let (mut post_read, mut post_places) = (0, 0);
    if a.kind == Kind::Blog {
        let from = util::fresh_from();
        let by_nid: HashMap<&str, &Row> = t.iter().map(|r| (g(r, "네이버ID"), r)).collect();
        for row in rows.iter_mut() {
            let nid = row["naverId"].as_str().unwrap_or("").to_string();
            let Some(text) = naver::read_page(&a.kind.file(&nid)) else { continue };
            let mut links: Vec<(String, String)> = blog_links(&text).into_iter().filter(|l| l.1 >= from).collect();
            // 최신순. 1년 안 글은 모두 연다(루하스사우나 영업시간 안내판 글은 12번째였다). 쓸모없는 사진은 read_photo_text가 읽은 뒤 지운다
            links.sort_by(|x, y| y.1.cmp(&x.1));
            links.truncate(POSTS_PER_PLACE);
            let mut originals: Vec<Value> = Vec::new();
            let mut images: Vec<Value> = Vec::new();
            for (url, date) in &links {
                let Some(stem) = post_stem(&nid, url) else { continue };
                let file = format!("{PAGES}/blogpost/{stem}.txt");
                match naver::read_page(&file) {
                    Some(body) => {
                        post_read += 1;
                        let lines = post_lines(&body);
                        if !lines.is_empty() {
                            originals.push(json!({ "date": date, "lines": lines }));
                        }
                        for p in post_images(&stem) {
                            images.push(json!({ "file": p, "date": date }));
                        }
                    }
                    None => {
                        if let Some(r) = by_nid.get(nid.as_str()) {
                            post_todo.push(vec![g(r, "카카오ID").to_string(), nid.clone(), g(r, "이름").to_string(), url.clone(), file, String::new()]);
                        }
                    }
                }
            }
            if !originals.is_empty() {
                post_places += 1;
            }
            if row.get("originals") != Some(&Value::from(originals.clone())) || row.get("postImages") != Some(&Value::from(images.clone())) {
                row["originals"] = Value::from(originals);
                // 사진 속 글자는 read_photo_text(Claude가 사진을 보고 읽음)가 읽어 photo_text.jsonl에 남긴다
                row["postImages"] = Value::from(images);
                replaced += 1;
            }
        }
        println!("블로그 원문: 읽은 글 {post_read}개, 키워드 문장이 있는 곳 {post_places}곳 / 받을 원문 {}개 (조건: 최근 1년 글, 최신순 곳마다 {POSTS_PER_PLACE}개) → {POST_TODO}", post_todo.len().min(a.max.max(post_todo.len())));
        if a.max > 0 {
            post_todo.truncate(a.max);
            csvio::write_csv(POST_TODO, &["카카오ID", "네이버ID", "이름", "주소", "저장할파일", "다시받기"], &post_todo)?;
        }
    }
    stale.sort_by(|x, y| x.0.cmp(&y.0));
    let (new_n, stale_n) = (todo.len(), stale.len());
    todo.extend(stale.into_iter().map(|(_, l)| l));
    todo.truncate(a.max);
    if added > 0 || replaced > 0 {
        let body: String = rows.iter().map(|v| format!("{v}\n")).collect();
        util::ensure_parent(a.kind.out())?;
        std::fs::write(a.kind.out(), body)?;
    }
    // --max 0은 '읽기만'(수집 도구 3단계). 받을 목록은 1단계에서 만든 것을 그대로 둔다(비우면 예상 시간이 틀어짐)
    if a.max > 0 {
        csvio::write_csv(
            a.kind.todo(),
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
    let kw: usize = rows
        .iter()
        .filter(|v| v["reviews"].as_array().is_some_and(|a| !a.is_empty()))
        .count();
    println!("저장된 {} 페이지에서 추가 {added}곳 · 새 내용으로 바꿈 {replaced}곳 · 알맞지 않은 파일 {bad}개 → {}", a.kind.name(), a.kind.out());
    println!(
        "{} 기록 {}곳 중 키워드 문장이 있는 곳 {kw}곳",
        a.kind.name(),
        rows.len()
    );
    println!(
        "ego로 열 곳 {}곳 (새 곳 {new_n} + 오래된 곳 {stale_n}, 상한 {}) → {}",
        todo.len(),
        a.max,
        a.kind.todo()
    );
    Ok(())
}
