// 네이버 플레이스 방문자 후기 탭에서 키워드(수건·드라이기·세신·샴푸·폐업 등)가 든 문장을 방문일과 함께 모은다.
// ego-browser(ego lite)로 돌린다(프로젝트 수집 방식). 작성자 이름은 저장하지 않는다.
//   대상: data/collected/review_targets.json  →  저장: data/collected/naver_reviews.jsonl (이미 받은 네이버ID는 건너뜀)
//   속도: 곳마다 GAP_MS 쉬고, 한 번 실행에 MAX_PLACES곳까지. 캡차·차단이 보이거나 연속 3번 못 읽으면 우회하지 않고 멈춘다.
// 실행(PowerShell): ego-browser nodejs -e "await import('file:///C:/Users/user/ego/review-tab-20261030-1800/run.mjs')"
const fs = await import("node:fs/promises");
const ROOT = "C:/Users/user/Desktop/AX 강의/10_23/10_23_map_test/";
const TARGETS = ROOT + "data/collected/review_targets.json";
const OUT = ROOT + "data/collected/naver_reviews.jsonl";
const MAX_PLACES = 60;
const MORE_CLICKS = 4; // '펼쳐서 더보기' 클릭 수. 클릭마다 후기 약 10건이 늘어난다
const GAP_MS = 7000;
const KEY = /수건|타월|타올|드라이|세신|때밀이|샴푸|바디워시|어메니티|폐업|휴업/;
const BLOCK = /보안 확인|자동입력 방지|비정상적인 접근|접근이 제한/;

const targets = JSON.parse(await fs.readFile(TARGETS, "utf8"));
let done = new Set();
try {
  done = new Set((await fs.readFile(OUT, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l).naverId));
} catch {}
const queue = targets.filter((t) => !done.has(t.naverId)).slice(0, MAX_PLACES);
console.log(`대상 ${targets.length}곳 중 받은 ${done.size}곳 제외 → 이번 실행 ${queue.length}곳`);

const task = await taskSpace("naver reviews");
const page = task.page("p1");
let fails = 0;

function parse(text) {
  const parts = text.split(/반응 남기기\n방문일\n/);
  const reviews = [];
  const dates = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const dm = parts[i + 1].match(/(20\d\d)년 (\d{1,2})월 (\d{1,2})일/);
    if (!dm) continue;
    const date = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
    dates.push(date);
    const lines = parts[i].split("\n").map((s) => s.trim()).filter((s) => s && s.length < 300 && KEY.test(s));
    if (lines.length) reviews.push({ date, lines });
  }
  dates.sort();
  return { count: dates.length, newest: dates[dates.length - 1] || "", oldest: dates[0] || "", reviews };
}

// 이동이 도중에 끊기면(net::ERR_ABORTED) 잠깐 쉬고 다시 시도한다. 세 번 다 안 되면 그 곳은 실패로 센다.
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

for (const [i, t] of queue.entries()) {
  if (!(await open(`https://m.place.naver.com/place/${t.naverId}/review/visitor`))) {
    fails++;
    console.log(`실패 ${t.name} (이동 불가, 연속 ${fails})`);
    if (fails >= 3) {
      console.log("⛔ 연속 3회 실패. 멈춥니다.");
      break;
    }
    continue;
  }
  await page.waitForTimeout(3500);
  for (let k = 0; k < MORE_CLICKS; k++) {
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll("a")].find((e) => (e.textContent || "").trim() === "펼쳐서 더보기");
      if (!b) return false;
      b.scrollIntoView({ block: "center" });
      b.click();
      return true;
    });
    if (!clicked) break;
    await page.waitForTimeout(1500);
  }
  // 긴 후기는 잘려 있어 '더보기'(글 펼치기)를 눌러 둔다
  await page.evaluate(() => document.querySelectorAll('a[class*="wFzIYl"]').forEach((e) => e.click()));
  await page.waitForTimeout(500);
  let text = (await page.evaluate(() => document.body?.innerText || "")) || "";
  if (text.length < 300) {
    await page.waitForTimeout(6000); // 느리게 뜨는 페이지는 더 기다렸다가 한 번 더 읽는다
    text = (await page.evaluate(() => document.body?.innerText || "")) || "";
  }
  if (BLOCK.test(text)) {
    console.log("⛔ 캡차·차단 낌새. 우회하지 않고 멈춥니다.");
    break;
  }
  // 후기가 없는 가게는 '방문자 리뷰' 영역이 아예 없다. 가게 페이지가 제대로 열렸으면(마이플레이스 표시) 후기 0건으로 기록한다.
  if (!text.includes("마이플레이스")) {
    fails++;
    console.log(`실패 ${t.name} (연속 ${fails})`);
    if (fails >= 3) {
      console.log("⛔ 연속 3회 실패(요청 제한 가능성). 멈춥니다.");
      break;
    }
  } else {
    fails = 0;
    const r = parse(text);
    // listShown=false: 가게 페이지는 열렸지만 후기 목록이 화면에 없었다(후기가 없거나 아직 안 뜬 작은 가게)
    const row = { kakaoId: t.kakaoId, naverId: t.naverId, name: t.name, collectedAt: new Date().toISOString().slice(0, 10), listShown: text.includes("방문일"), ...r };
    await fs.appendFile(OUT, JSON.stringify(row) + "\n", "utf8");
    console.log(`${i + 1}/${queue.length} ${t.name} 후기 ${r.count}건(${r.oldest}~${r.newest}) 키워드 ${r.reviews.length}건`);
  }
  await page.waitForTimeout(GAP_MS);
}
