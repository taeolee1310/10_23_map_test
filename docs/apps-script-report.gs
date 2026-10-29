/** @OnlyCurrentDoc */
/**
 * 탕방 요금 제보 → 구글 시트에 한 줄 추가 (구글 Apps Script)
 * 이 파일은 서비스 코드가 아니라 설정용 문서다. 구글 시트의 [확장 프로그램 > Apps Script]에 붙여 넣어 쓴다.
 * 설정 순서는 docs/report-setup.md 를 본다.
 *
 * - 위의 @OnlyCurrentDoc 한 줄 덕분에 이 스크립트는 '이 시트 하나'에만 접근 권한을 요청한다(계정의 다른 시트는 못 건드린다).
 * - 비밀 값(SECRET)은 이 코드에 적지 않고 [프로젝트 설정 > 스크립트 속성]에 REPORT_SECRET 으로 넣는다.
 * - Vercel 쪽 REPORT_SHEET_SECRET 과 같은 값이어야 줄이 추가된다.
 */
var SHEET_NAME = '제보';
var HEADERS = ['시각', '업체ID', '업체', '성인 입장료', '수건', '세신', '확인 방법', '메모', '표시', '같은 값 횟수', '상태', '검토 메모', '제보자(해시)', '접속(해시)'];
var LIMIT_PER_PERSON = 3;  // 한 사람(브라우저)당 제보 횟수
var LIMIT_PER_IP = 10;     // 같은 접속 주소의 보조 한도(학교·회사처럼 여럿이 같은 주소를 쓰는 경우를 넉넉히 둔다)
var STATUSES = ['새 제보', '확인함', '반영 완료', '반려'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 동시에 들어와도 줄이 섞이지 않게 차례로 처리한다
    var d = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('REPORT_SECRET');
    if (!secret || d.secret !== secret) return out_({ ok: false, error: 'auth' });

    var sheet = sheet_();
    var last = sheet.getLastRow();
    // 한 사람당 횟수 제한: 제보자(해시)·접속(해시) 칸을 세어 한도를 넘으면 받지 않는다
    var whoCount = 0, ipCount = 0;
    if (last > 1) {
      var ids = sheet.getRange(2, 13, last - 1, 2).getValues();
      for (var j = 0; j < ids.length; j++) {
        if (d.who && String(ids[j][0]) === String(d.who)) whoCount++;
        if (d.ip && String(ids[j][1]) === String(d.ip)) ipCount++;
      }
    }
    if (whoCount >= LIMIT_PER_PERSON || ipCount >= LIMIT_PER_IP) return out_({ ok: false, error: 'limit' });
    // 같은 업체에 같은 값이 이미 몇 번 들어왔는지 센다(여러 사람이 같은 값을 말하면 믿을 근거가 된다)
    var same = 1;
    if (last > 1) {
      var rows = sheet.getRange(2, 2, last - 1, 5).getValues(); // 업체ID ~ 세신
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === String(d.placeId) && n_(rows[i][2]) === n_(d.adult) && n_(rows[i][3]) === n_(d.towel) && n_(rows[i][4]) === n_(d.scrub)) same++;
      }
    }
    sheet.appendRow([new Date(), String(d.placeId), d.placeName, d.adult, d.towel, d.scrub, d.source, d.memo, d.flags, same, '새 제보', '', String(d.who || ''), String(d.ip || '')]);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: 'script' });
  } finally {
    lock.releaseLock();
  }
}

function n_(v) { return v === '' || v === null || v === undefined ? '' : Number(v); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    // 상태 칸은 드롭다운으로 고른다
    sheet.getRange('K2:K').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
    formatSheet();
  }
  return sheet;
}

/**
 * 시트를 읽기 좋게 꾸민다(칸 너비, 날짜·금액 모양, 상태별 색, 필터, 안내 탭).
 * 에디터에서 한 번 실행하면 되고, 여러 번 실행해도 같은 결과다. 이미 쌓인 제보는 지우지 않는다.
 */
function formatSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || sheet_();
  var widths = [150, 150, 210, 90, 70, 80, 130, 240, 150, 90, 90, 240, 110, 110];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]); // 제목 줄을 항상 최신으로
  var head = sheet.getRange(1, 1, 1, HEADERS.length);
  head.setFontWeight('bold').setBackground('#E8D9AE').setFontColor('#342C25').setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 32);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(3);

  var body = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), HEADERS.length);
  body.setVerticalAlignment('top').setFontColor('#342C25');
  sheet.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange('B2:B').setFontColor('#8D7665').setFontSize(9);
  sheet.getRange('D2:F').setNumberFormat('#,##0').setHorizontalAlignment('right');
  sheet.getRange('J2:K').setHorizontalAlignment('center');
  sheet.getRange('H2:H').setWrap(true);
  sheet.getRange('I2:I').setWrap(true);
  sheet.getRange('L2:L').setWrap(true);

  // 상태 칸 색, 표시 칸에 내용이 있으면 눈에 띄게
  var rules = [];
  var status = sheet.getRange('K2:K');
  var colors = { '새 제보': ['#FFF3C4', '#342C25'], '확인함': ['#DCEBEA', '#2F5A55'], '반영 완료': ['#D9EBD3', '#2D5A27'], '반려': ['#E4DCD3', '#8D7665'] };
  Object.keys(colors).forEach(function (k) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(k).setBackground(colors[k][0]).setFontColor(colors[k][1]).setRanges([status]).build());
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($I2<>"",$K2<>"반려")').setBackground('#F8E0DA').setRanges([sheet.getRange('I2:I')]).build());
  sheet.setConditionalFormatRules(rules);

  sheet.hideColumns(13, 2); // 제보자·접속 해시는 사람이 볼 일이 없어 숨긴다(필요하면 열 머리를 펼쳐 본다)

  // 필터(제목 줄에 깔때기)
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), HEADERS.length).createFilter();

  // 맨 앞 탭을 '제보'로, 비어 있는 첫 탭은 숨긴다
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);
  var blank = ss.getSheetByName('시트1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) blank.hideSheet();

  readme_(ss);
}

function readme_(ss) {
  var sh = ss.getSheetByName('읽는 법') || ss.insertSheet('읽는 법');
  sh.clear();
  var rows = [
    ['탕방 요금 제보 시트 — 읽는 법', ''],
    ['', ''],
    ['이 시트는 무엇인가요', '사용자가 사이트에서 보낸 요금 제보가 `제보` 탭에 한 줄씩 쌓입니다. 제보는 확인 전의 단서이고, 화면에는 바로 반영되지 않습니다.'],
    ['', ''],
    ['칸', '뜻'],
    ['시각', '제보가 들어온 때(한국 시간)'],
    ['업체ID · 업체', '서비스 목록과 같은 업체 번호와 이름(서버가 목록과 맞춰 적습니다)'],
    ['성인 입장료 · 수건 · 세신', '제보한 요금(원). 모르는 칸은 비어 있습니다'],
    ['확인 방법', '제보자가 고른 근거: 현장 가격표 / 직접 냈어요 / 공식 홈페이지·네이버 / 기타'],
    ['메모', '제보자가 덧붙인 말(100자). 연락처가 의심되면 가려서 적힙니다'],
    ['제보자(해시)·접속(해시)', '(숨김 칸) 한 사람당 3번 제한을 세는 데 쓰는 익명 값. 누구인지 알 수 없고 원래 값은 저장하지 않습니다'],
    ['표시', '이름 불일치, 입장료·수건·세신 이상값, 연락처 의심 등 검토할 때 먼저 볼 것. 비어 있으면 특이점 없음'],
    ['같은 값 횟수', '같은 업체에 같은 값이 몇 번째로 들어왔는지(같은 사람이 여러 번 보내도 오르므로 참고만)'],
    ['상태', '새 제보 → 확인함 → 반영 완료 / 반려. 드롭다운으로 고릅니다'],
    ['검토 메모', '확인한 근거와 결과를 적는 칸(운영자용)'],
    ['', ''],
    ['반영 규칙', '근거(네이버 가격표·공식 홈페이지)를 확인한 값만 data/curated/ 에 넣고 화면 데이터를 다시 만듭니다. 확인 못 하면 "요금 미확인"으로 둡니다.']
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows).setVerticalAlignment('top').setWrap(true);
  sh.setColumnWidth(1, 190); sh.setColumnWidth(2, 560);
  sh.getRange('A1').setFontSize(14).setFontWeight('bold');
  sh.getRange('A5:B5').setFontWeight('bold').setBackground('#E8D9AE');
  sh.getRange('A3').setFontWeight('bold'); sh.getRange('A17').setFontWeight('bold');
  sh.setHiddenGridlines(true);
  ss.setActiveSheet(ss.getSheetByName(SHEET_NAME));
}
