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
var HEADERS = ['시각', '업체ID', '업체', '성인 입장료', '수건', '세신', '확인 방법', '메모', '표시', '같은 값 횟수', '상태', '검토 메모'];
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
    // 같은 업체에 같은 값이 이미 몇 번 들어왔는지 센다(여러 사람이 같은 값을 말하면 믿을 근거가 된다)
    var same = 1;
    if (last > 1) {
      var rows = sheet.getRange(2, 2, last - 1, 5).getValues(); // 업체ID ~ 세신
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === String(d.placeId) && n_(rows[i][2]) === n_(d.adult) && n_(rows[i][3]) === n_(d.towel) && n_(rows[i][4]) === n_(d.scrub)) same++;
      }
    }
    sheet.appendRow([new Date(), String(d.placeId), d.placeName, d.adult, d.towel, d.scrub, d.source, d.memo, d.flags, same, '새 제보', '']);
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
  }
  return sheet;
}
