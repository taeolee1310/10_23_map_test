// 네이버 플레이스 홈 페이지의 '영업시간 펼쳐보기'를 눌러 요일별 영업시간과 휴무 문구를 모은다.
// ego-browser(ego lite)로 돌린다(프로젝트 수집 방식).
//   대상: data/collected/review_targets.json  →  저장: data/collected/naver_hours.jsonl (이미 받은 네이버ID는 건너뜀)
//   속도: 곳마다 GAP_MS 쉬고, 한 번 실행에 MAX_PLACES곳까지. 캡차·차단이 보이거나 연속 3번 못 열면 우회하지 않고 멈춘다.
// 실행(PowerShell): ego-browser nodejs -e "await import('file:///C:/Users/user/ego/hours-20261030-2000/run.mjs')"
const fs = await import("node:fs/promises");
const ROOT = "C:/Users/user/Desktop/AX 강의/10_23/10_23_map_test/";
const TARGETS = ROOT + "data/collected/review_targets.json";
const OUT = ROOT + "data/collected/naver_hours.jsonl";
const MAX_PLACES = 60;
const GAP_MS = 5000;
const BLOCK = /보안 확인|자동입력 방지|비정상적인 접근|접근이 제한/;
const DAY = /^([월화수목금토일])(\(\d{1,2}\/\d{1,2}\))?$/;

const targets = JSON.parse(await fs.readFile(TARGETS, "utf8"));
let done = new Set();
try {
  done = new Set((await fs.readFile(OUT, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l).naverId));
} catch {}
const queue = targets.filter((t) => !done.has(t.naverId)).slice(0, MAX_PLACES);
console.log(`대상 ${targets.length}곳 중 받은 ${done.size}곳 제외 → 이번 실행 ${queue.length}곳`);

const task = await taskSpace("naver hours");
const page = task.page("p1");
let fails = 0;

async function open(url) {
  for (let a = 0; a < 3; a++) {
    try {
      await page.goto(url);
      return true;
    } catch (e) {
      console.log(`이동 오류(${a + 1}/3): ${String(e).slice(0, 80)}`);
      await page.waitForTimeout(5000);
    }
  }
  return false;
}

// '영업시간' ~ '접기' 사이를 요일별로 푼다. 요일 줄 다음 줄들이 그 요일의 시간·비고다.
function parse(text) {
  const i = text.indexOf("영업시간\n");
  if (i < 0) return null;
  let block = text.slice(i + 5);
  const end = block.search(/\n접기\n|\n영업시간 수정 제안하기|\n전화번호\n/);
  if (end >= 0) block = block.slice(0, end);
  const lines = block.split("\n").map((s) => s.trim()).filter(Boolean);
  const week = {};
  const notes = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.match(DAY);
    if (m) {
      cur = m[1];
      week[cur] = [];
    } else if (cur) {
      week[cur].push(ln);
    } else {
      notes.push(ln); // 요일 표 앞의 '영업 중 23:00에 영업 종료' 같은 지금 상태 줄
    }
  }
  const tail = text.slice(i, i + 900).match(/\n(매[^\n]*휴무[^\n]*|연중무휴|[^\n]*정기 ?휴무[^\n]*)\n접기/);
  return { week, now: notes.join(" / "), closedNote: tail ? tail[1] : "" };
}

for (const [k, t] of queue.entries()) {
  if (!(await open(`https://m.place.naver.com/place/${t.naverId}/home`))) {
    fails++;
    console.log(`실패 ${t.name} (이동 불가, 연속 ${fails})`);
    if (fails >= 3) {
      console.log("⛔ 연속 3회 실패. 멈춥니다.");
      break;
    }
    continue;
  }
  await page.waitForTimeout(4500);
  let text = (await page.evaluate(() => document.body?.innerText || "")) || "";
  if (text.length < 300) {
    await page.waitForTimeout(6000);
    text = (await page.evaluate(() => document.body?.innerText || "")) || "";
  }
  if (BLOCK.test(text)) {
    console.log("⛔ 캡차·차단 낌새. 우회하지 않고 멈춥니다.");
    break;
  }
  if (!text.includes("마이플레이스")) {
    fails++;
    console.log(`실패 ${t.name} (연속 ${fails})`);
    if (fails >= 3) {
      console.log("⛔ 연속 3회 실패(요청 제한 가능성). 멈춥니다.");
      break;
    }
  } else {
    fails = 0;
    // 영업시간 펼쳐보기는 링크 안의 span이라 글자로 찾아 가장 가까운 링크를 누른다(없으면 영업시간 정보가 접혀 있지 않은 곳)
    const expanded = await page.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent || "").trim() === "펼쳐보기");
      if (!el) return false;
      const target = el.closest("a,button,[role=button]") || el.parentElement;
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    });
    if (expanded) await page.waitForTimeout(1500);
    const after = (await page.evaluate(() => document.body?.innerText || "")) || "";
    const hours = parse(after);
    const row = { kakaoId: t.kakaoId, naverId: t.naverId, name: t.name, collectedAt: new Date().toISOString().slice(0, 10), expanded, hours };
    await fs.appendFile(OUT, JSON.stringify(row) + "\n", "utf8");
    const days = hours ? Object.keys(hours.week).length : 0;
    console.log(`${k + 1}/${queue.length} ${t.name} 요일 ${days}개 ${expanded ? "" : "(펼칠 곳 없음)"}`);
  }
  await page.waitForTimeout(GAP_MS);
}
