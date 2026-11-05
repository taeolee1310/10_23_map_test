// ego 브라우저로 '받을 목록'의 네이버 페이지를 열어 저장한다. 탕방 데이터 수집 도구(별도 저장소 tangbang-collector)가 실행한다.
//   실행: ego-browser nodejs -e "await import('file:///<프로젝트>/scripts/ego_fetch.mjs')"
//   (프로젝트 경로에 한글이 있으면 file URL을 퍼센트 인코딩해서 넘긴다. -e 인자에는 ASCII만 둔다)
//
// 읽는 것: data/collected/naver_find_todo.csv(검색 결과), naver_home_todo.csv(홈), naver_review_todo.csv(후기 탭), naver_photo_todo.csv(사진 탭, 업체 사진 주소만 .json), naver_blog_todo.csv(블로그 탭). '다시받기'=1이면 오래된 페이지를 덮어쓴다
//          data/collected/ego_fetch_job.json  {id, max, batch, intervalMs}  — 수집 도구가 '수집 시작' 때 만든다
// 쓰는 것: 목록의 '저장할파일'(data/collected/naver_pages/…), data/collected/ego_fetch_status.json(진행 상황)
//
// 규칙(data/README.md '네이버 수집'): 곳당 10초 간격, 한 작업에 150곳까지, 캡차·'보안 확인'·차단 화면이 보이거나
// 3번 연속 비면 바로 멈춘다. 세션을 새로 열거나 위장하지 않는다. 한 번 실행에 batch개까지 받고 끝난다(state "more"면 다시 실행).
// 멈추기: data/collected/ego_fetch_stop 파일이 생기면 다음 페이지로 넘어가기 전에 멈춘다.

const fs = await import("node:fs/promises");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = (p) => path.join(ROOT, "data", "collected", p);
const JOB = C("ego_fetch_job.json");
const STATUS = C("ego_fetch_status.json");
const STOP = C("ego_fetch_stop");
const HARD_MAX = 150; // 규칙 상한. job.json에 더 큰 값이 와도 넘지 않는다
const MIN_INTERVAL = 10_000;
const BLOCK = ["보안 확인", "자동입력 방지", "captcha", "비정상적인 접근", "접근이 제한"]; // src/naver.rs BLOCK과 같게

const exists = async (p) => fs.access(p).then(() => true, () => false);
const readJson = async (p, d) => { try { return JSON.parse((await fs.readFile(p, "utf8")).replace(/^﻿/, "")); } catch { return d; } };

// csvio::write_csv가 쓰는 CSV(utf-8-sig, 최소 따옴표)를 읽는다
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = []; let row = []; let f = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = ""; rows.push(row); row = [];
    } else f += ch;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function todo() {
  const out = [];
  for (const name of ["naver_find_todo.csv", "naver_home_todo.csv", "naver_review_todo.csv", "naver_photo_todo.csv", "naver_blog_todo.csv", "naver_blogpost_todo.csv"] /* 받는 순서: TOP 3 근거(후기) → 사진 후보 → 블로그 탭 → 블로그 원문 */) {
    const p = C(name);
    if (!(await exists(p))) continue;
    for (const r of parseCsv(await fs.readFile(p, "utf8"))) {
      const file = r["저장할파일"]; const url = r["주소"];
      if (!file || !url || !url.startsWith("https://")) continue;
      out.push({ file, url, name: r["이름"] || "", kind: file.endsWith(".html") ? "search" : file.endsWith(".json") ? "photo" : file.includes("/blogpost/") ? "post" : file.includes("/review/") || file.includes("/blog/") ? "review" : "home", refresh: r["다시받기"] === "1" });
    }
  }
  return out;
}

const job = await readJson(JOB, null);
if (!job || !job.id) {
  console.log("[수집] 작업 파일(ego_fetch_job.json)이 없어요. 수집 도구에서 '수집 시작'을 눌러 주세요.");
  process.exit(0);
}
const max = Math.min(Number(job.max) || HARD_MAX, HARD_MAX);
const batch = Math.max(1, Math.min(Number(job.batch) || 25, max));
const interval = Math.max(Number(job.intervalMs) || MIN_INTERVAL, MIN_INTERVAL);

let st = await readJson(STATUS, null);
if (!st || st.job !== job.id) st = { job: job.id, state: "running", done: 0, saved: 0, failed: 0, streak: 0, total: 0, reason: "", last: "", tried: [], startedAt: new Date().toISOString() }; // startedAt: 남은 시간 계산(실제 곳당 속도)용
// tried: 이 작업에서 이미 열어 본 파일. 빈 페이지는 파일이 안 생겨서, 이게 없으면 다음 묶음이 같은 곳을 맨 앞에서 다시 열어
// '3번 연속 빈 페이지'로 잘못 멈추고 진행 수(total)도 두 번 센다
const tried = new Set(Array.isArray(st.tried) ? st.tried : []);
if (["captcha", "failed", "stopped", "done"].includes(st.state) && st.job === job.id) {
  console.log(`[수집] 이 작업은 이미 끝났어요(${st.state}). 다시 받으려면 '수집 시작'을 새로 눌러 주세요.`);
  process.exit(0);
}
const save = async (extra = {}) => {
  Object.assign(st, extra, { updated: new Date().toISOString() });
  await fs.writeFile(STATUS, JSON.stringify(st, null, 1), "utf8");
};

const pending = [];
// 받을 것: 이 작업에서 아직 안 열어 본 곳 중 파일이 없는 곳 + '다시받기' 표시가 있고 이번 작업 전에 저장된 곳(오래된 페이지)
const jobStart = Number(job.id) || 0;
const mtime = async (p) => fs.stat(p).then((s) => s.mtimeMs, () => -1);
for (const t of await todo()) {
  if (tried.has(t.file)) continue;
  const m = await mtime(path.join(ROOT, t.file));
  if (m < 0 || (t.refresh && m < jobStart)) pending.push(t);
}
st.total = Math.min(st.done + pending.length, max);
const left = Math.max(0, max - st.done);
const list = pending.slice(0, Math.min(batch, left));
if (!list.length) {
  await save({ state: "done", reason: pending.length ? `한 번에 ${max}곳 상한에 닿았어요` : "받을 페이지가 없어요" });
  console.log(`[수집] ${st.reason}. 저장 ${st.saved}개.`);
  process.exit(0);
}
await save({ state: "running", reason: "" });
console.log(`[수집] 이번 실행 ${list.length}개 (작업 전체 ${st.done}/${st.total}, 간격 ${interval / 1000}초)`);

const pageText = (await fs.readFile(path.join(ROOT, "scripts", "naver_page_text.js"), "utf8"))
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const task = await taskSpace("탕방 데이터 수집");
const page = task.page("p1");
let lastStart = 0;
let stopped = null;

for (const t of list) {
  if (await exists(STOP)) { stopped = { state: "stopped", reason: "사용자가 멈췄어요" }; break; }
  const wait = lastStart + interval - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
  let text = "";
  let visible = ""; // 검색 결과: 화면에 보이는 글자(캡차 판단용)
  try {
    await page.goto(t.url, { timeout: 30_000 });
    await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2_000); // 네이버 플레이스는 불러온 뒤 글자를 그린다
    if (t.kind === "photo") {
      // 사진 탭: 업체가 등록한 사진(alt="business_N")의 원본 주소만 모은다(방문자 사진은 쓰지 않는다).
      // 맨 위 사진 묶음은 아래로 내리면 화면에서 빠질 수 있어, 내리기 전과 내린 뒤에 모두 읽어 합친다.
      const grab = () => page.evaluate(() =>
        [...document.querySelectorAll('img[alt^="business_"]')].map((i) => {
          const s = i.currentSrc || i.src || "";
          let u = s;
          try { u = new URL(s).searchParams.get("src") || s; } catch {}
          return { url: u.split("?")[0], w: i.naturalWidth, h: i.naturalHeight };
        }).filter((p) => /^https:\/\/ldb-phinf\.pstatic\.net\//.test(p.url)));
      await page.waitForTimeout(1_500);
      const found = [...(await grab())];
      for (let k = 0; k < 2; k++) {
        await page.evaluate(() => window.scrollBy(0, 1200));
        await page.waitForTimeout(1_200);
        found.push(...(await grab()));
      }
      const seen = new Set();
      const photos = found.filter((p) => !seen.has(p.url) && seen.add(p.url)).slice(0, 8);
      const body = (await page.evaluate(() => document.body?.innerText || "")) || "";
      const blocked = /보안 확인|자동입력 방지|비정상적인 접근|접근이 제한/.test(body);
      text = blocked ? "보안 확인" : JSON.stringify({ valid: body.includes("마이플레이스"), blocked, photos });    } else if (t.kind === "review") {
      // 후기·블로그 탭: '펼쳐서 더보기'를 4번까지 눌러 글을 늘리고(누를 때마다 약 10건), 잘린 긴 후기는 펼친 뒤 화면 글자를 저장한다
      await page.waitForTimeout(1_500);
      for (let k = 0; k < 4; k++) {
        const clicked = await page.evaluate(() => {
          const b = [...document.querySelectorAll("a")].find((e) => (e.textContent || "").trim() === "펼쳐서 더보기");
          if (!b) return false;
          b.scrollIntoView({ block: "center" });
          b.click();
          return true;
        });
        if (!clicked) break;
        await page.waitForTimeout(1_500);
      }
      await page.evaluate(() => document.querySelectorAll('a[class*="wFzIYl"]').forEach((e) => e.click()));
      await page.waitForTimeout(500);
      text = (await page.evaluate(() => document.body?.innerText || "")) || "";
      if (text.length < 300) {
        await page.waitForTimeout(6_000); // 느리게 뜨는 페이지는 더 기다렸다가 한 번 더 읽는다
        text = (await page.evaluate(() => document.body?.innerText || "")) || "";
      }
      if (t.file.includes("/blog/")) {
        // 블로그 탭: 원문을 읽으려고 네이버 블로그 글 주소와 작성일을 같이 남긴다(카페 글은 로그인이 필요해 뺀다)
        const links = await page.evaluate(() => {
          const seen = new Set();
          return [...document.querySelectorAll('a[href*="blog.naver.com/"]')].map((a) => {
            const d = /(20\d\d)년 (\d{1,2})월 (\d{1,2})일/.exec((a.closest("li")?.innerText || ""));
            const u = new URL(a.href); u.search = ""; u.hash = "";
            return { url: u.href.replace("://blog.", "://m.blog."), date: d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}` : "" };
          }).filter((x) => /m\.blog\.naver\.com\/[^/]+\/\d+$/.test(x.url) && !seen.has(x.url) && seen.add(x.url));
        });
        text += "\n[[탕방:블로그글]]" + JSON.stringify(links);
      }
    } else if (t.kind === "post") {
      // 블로그 원문: 본문 영역 글자만 저장한다(댓글·추천 글 제외). 키워드 문장만 남기는 일은 collect_reviews가 한다
      await page.waitForTimeout(1_500);
      text = (await page.evaluate(() => (document.querySelector(".se-main-container, #viewTypeSelector, .post_ct, #postViewArea")?.innerText || document.body?.innerText || ""))) || "";
      // 사진 속 글자(간판·안내문·가격표)를 읽으려고 글의 사진을 모두(30장까지) 이미지 파일로 남긴다. 스티커·작은 아이콘은 뺀다.
      // read_photo_text가 바둑판으로 모아 글자 있는 사진만 골라 읽고 나머지는 지운다(2단계 읽기, 사용자 결정 2026-11-04)
      const picks = await page.evaluate(() => {
        const root = document.querySelector(".se-main-container") || document.body;
        const out = [];
        [...root.querySelectorAll("img")].forEach((img, i) => {
          if (img.closest(".se-sticker") || img.hasAttribute("data-tb")) return;
          img.setAttribute("data-tb", String(i));
          out.push(i);
        });
        return out.slice(0, 30);
      });
      const stem = path.basename(t.file, ".txt");
      let k = 0;
      for (const i of picks) {
        // 사진이 화면에 불러와질 때까지 내려 본 뒤, 브라우저가 쓰는 사진 주소로 받아 저장한다
        const src = await page.evaluate(async (i) => {
          const img = document.querySelector(`img[data-tb="${i}"]`);
          if (!img) return "";
          img.scrollIntoView({ block: "center" });
          for (let w = 0; w < 40 && !(img.complete && img.naturalWidth > 0 && !/^data:/.test(img.currentSrc || img.src)); w++) await new Promise((r) => setTimeout(r, 150));
          const u = img.getAttribute("data-lazy-src") || img.currentSrc || img.src || "";
          // 화면 밖 사진은 가로 80px 흐린 미리보기(type=w80_blur)로만 떠 있다. 크기 옵션만 w800으로 바꿔 받는다.
          // 작은 아이콘·이모티콘은 read_photo_text가 받은 뒤 크기로 거른다
          return /^https:\/\/[^/]*pstatic\.net\//.test(u) ? u.replace(/type=w\d+(_blur)?/, "type=w800") : "";
        }, i);
        if (!src) continue;
        const out = path.join(ROOT, "data/collected/naver_pages/blogimg", `${stem}_${k}.jpg`);
        await fs.mkdir(path.dirname(out), { recursive: true });
        // 페이지 안 fetch는 브라우저 CORS에 막혀서(사진 서버가 다른 주소), 사진 파일 한 장만 Node 요청으로 받는다. 페이지 요청은 늘지 않는다
        const res = await fetch(src, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
        if (!res || !res.ok || !/^image\//.test(res.headers.get("content-type") || "")) continue;
        await fs.writeFile(out, Buffer.from(await res.arrayBuffer()));
        k += 1;
      }
      if (k) console.log(`[사진] ${t.name} 블로그 사진 ${k}장 → naver_pages/blogimg/${stem}_*.jpg`);
    } else if (t.kind === "search") {
      text = await page.evaluate("document.documentElement.outerHTML");
      // 검색 결과 HTML의 스크립트에는 'captcha' 단어가 늘 들어 있다(2026-11-04 확인: 정상 검색인데 멈춤).
      // 캡차 판단은 화면에 보이는 글자로만 한다
      visible = (await page.evaluate(() => document.body?.innerText || "")) || "";
    } else {
      text = await page.evaluate(pageText);
    }
  } catch (e) {
    console.log(`[실패] ${t.name} — ${String(e?.message || e).split("\n")[0].slice(0, 120)}`);
  }
  text = typeof text === "string" ? text : "";
  const low = (t.kind === "search" ? visible : text).toLowerCase();
  if (BLOCK.some((w) => low.includes(w.toLowerCase()))) {
    stopped = { state: "captcha", reason: "캡차·보안 확인 화면이 보여서 멈췄어요. 우회하지 않아요. 나중에 다시 눌러 주세요." };
    break;
  }
  st.done += 1;
  tried.add(t.file);
  st.tried = [...tried];
  // 사진 탭은 사진이 0장일 수도 있어 글자 길이 대신 "가게 페이지가 열렸는지"로 빈 페이지를 판단한다
  const isEmpty = t.kind === "photo" ? !(() => { try { return JSON.parse(text).valid; } catch { return false; } })() : text.trim().length < 50;
  if (isEmpty) {
    st.failed += 1; st.streak += 1;
    console.log(`[빈 페이지] ${t.name} (연속 ${st.streak}번)`);
    if (st.streak >= 3) { stopped = { state: "failed", reason: "3번 연속 빈 페이지라 멈췄어요. 네트워크나 네이버 상태를 확인해 주세요." }; break; }
  } else {
    const out = path.join(ROOT, t.file);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, text, "utf8");
    st.saved += 1; st.streak = 0;
    console.log(`[저장] ${st.done}/${st.total} ${t.name} → ${t.file}`);
  }
  await save({ last: t.name });
}

const more = !stopped && st.done < st.total;
await save(stopped || (more ? { state: "more", reason: "" } : { state: "done", reason: st.done >= max ? `한 번에 ${max}곳 상한까지 받았어요` : "목록을 다 받았어요" }));
if (st.state !== "more") await task.finish({ keep: [] });
console.log(`[수집] 상태 ${st.state} · 저장 ${st.saved} · 빈 페이지 ${st.failed} · 진행 ${st.done}/${st.total}${st.reason ? " · " + st.reason : ""}`);
