# 수집 프로그램·제보함 배포와 업데이트

탕방의 두 운영 도구(수집 프로그램, 제보함)를 측근에게만 나눠 주고, 새 버전이 나오면 쓰는 사람이 알고 바로 업데이트하게 하는 방법이다. (2026-11-20)

## 한눈에

| | 수집 프로그램 | 제보함 |
| --- | --- | --- |
| 저장소(비공개) | `taeolee1310/tangbang-collector` | `taeolee1310/tangbang-report-desk` |
| 앱 이름(`app`) | `collector` | `report-desk` |
| 모양 | Tauri 데스크톱 앱(설치 파일) | 내 PC에서 도는 프로그램 하나 + 브라우저 화면 |
| 업데이트 | 켤 때 확인 → 화면 위 안내 → '업데이트'(Tauri 업데이터, 서명 확인 후 설치·재시작) | 켤 때 확인 → 화면 위 안내 → '업데이트'(새 실행 파일을 받아 서명 확인 후 바꾸고 다시 켜기) |

- **도구함(다운로드 사이트)**: `https://tangbang-downloads.tangbang-api.workers.dev` — 숫자 비밀번호를 아는 사람만 들어온다. 코드는 이 저장소 `downloads/`(Cloudflare Worker), 파일은 R2 `tangbang-downloads`.
- **버전 올리는 법(두 저장소 같음)**: `CHANGELOG.md` 맨 위에 새 버전과 바뀐 점을 적고, 버전 숫자를 올린 뒤 `git tag vX.Y.Z && git push origin vX.Y.Z`. GitHub Actions가 윈도우·맥으로 빌드하고, 업데이트 서명을 붙여 도구함에 올린다. 올라가는 순간 쓰는 사람의 앱이 다음에 켤 때 새 버전을 알린다.
- **버전 규칙(SemVer)**: 고장 고침은 마지막 자리(0.2.0 → 0.2.1), 기능 추가는 가운데(0.2.1 → 0.3.0), 프로젝트 폴더·데이터 모양이 바뀌어 예전 버전과 같이 못 쓰면 첫 자리.

## 도구함 API (downloads/src/index.js)

| 누가 | 요청 | 인증 |
| --- | --- | --- |
| 사람 | `GET /` 화면, `POST /api/login {code}`, `POST /api/me {name}`, `GET /api/catalog`, `GET /api/file/{app}/{ver}/{name}` | 로그인 쿠키(30일) |
| 앱 | `GET /api/update/{app}/{target}/{arch}/{현재 버전}` → 새 버전이 없으면 204, 있으면 `{version, notes, pub_date, url, signature, sha256, size, page}` | 헤더 `X-Update-Key` |
| 앱 | `GET /api/file/{app}/{ver}/{name}` (위 응답의 `url`) | 헤더 `X-Update-Key` |
| CI | `PUT /api/release/{app}/{ver}/files/{name}` 본문 = 파일 그대로 → `{sha256, size}` | `Authorization: Bearer` RELEASE_TOKEN |
| CI | `PUT /api/release/{app}/{ver}/manifest` 본문 `{notes, files:[{platform, kind, name, signature?}]}` | 같음 |

- `target`/`arch`: Tauri가 쓰는 이름(`windows`·`darwin`, `x86_64`·`aarch64`). 버전 정보의 `platform`은 `windows-x86_64`, `darwin-universal`(맥 공용) 등. 맥 공용 파일 하나로 `darwin-aarch64`·`darwin-x86_64` 질문에 모두 답한다.
- `kind`: `installer`(사람이 도구함에서 받는 파일: .exe·.dmg·.zip) / `updater`(앱이 스스로 받는 파일, `signature` 필수).
- 파일 이름은 영문·숫자·`._-`만(`Tangbang-Collector_0.2.0_x64-setup.exe`처럼). 한 파일 90MB까지.
- 파일을 먼저 올리고 manifest를 마지막에 올린다. manifest의 버전이 지금 최신보다 높거나 같을 때만 최신(`latest`)이 바뀐다.

## 열쇠(값은 어디에도 적지 않는다)

| 이름 | 어디에 | 무엇 |
| --- | --- | --- |
| `DOWNLOAD_CODE` | 도구함 Worker | 측근에게 알려 줄 숫자 비밀번호. 주인이 `cd downloads && node put-secret.mjs DOWNLOAD_CODE`로 넣는다(입력이 화면에 안 보임). 바꾸면 모두 다시 로그인 |
| `COOKIE_KEY` | 도구함 Worker | 로그인 쿠키 서명 |
| `UPDATE_KEY` | 도구함 Worker + 두 저장소 GitHub 비밀 `TANGBANG_UPDATE_KEY` | 앱이 업데이트를 물을 때 보내는 열쇠. 빌드할 때 앱에 들어간다 |
| `RELEASE_TOKEN` | 도구함 Worker + GitHub 비밀 `TANGBANG_RELEASE_TOKEN` | CI가 파일을 올리는 열쇠 |
| 업데이트 서명 열쇠 | GitHub 비밀 `TAURI_SIGNING_PRIVATE_KEY`(+`_PASSWORD`). 공개 열쇠는 앱 안에 | 업데이트 파일이 우리 CI에서 나온 것인지 앱이 확인한다 |

- 원본은 주인 PC `%USERPROFILE%\.tangbang-release\`에만 있다. **이 폴더를 비밀번호 관리자 등에 따로 보관한다.** 서명 열쇠를 잃으면 이미 설치된 앱에 업데이트를 보낼 수 없다(새로 설치해야 함).
- 열쇠를 바꿀 때: 같은 이름으로 Worker와 GitHub 비밀을 함께 바꾸고 새 버전을 낸다(UPDATE_KEY를 바꾸면 그전 버전 앱은 업데이트 확인이 401이 되어, 도구함에서 직접 받아야 한다).
- 코드 서명(윈도우 인증서·애플 개발자 등록)은 하지 않는다(2026-11-20 결정). 처음 열 때 경고가 뜨고, 넘기는 법은 도구함 '설치 도움말'에 있다.

## 제보함 관리 열쇠는 사람마다

제보함은 운영 DB를 바꾸고 사이트에 내보낸다. 측근마다 다른 관리 열쇠를 준다(`worker` 관리 API가 `admins` 표로 확인, 주인 열쇠 `ADMIN_TOKEN`만 열쇠를 만들고 끌 수 있다).

```
node scripts/d1_publish.mjs admin-add 이름      # 새 열쇠를 한 번만 보여 준다 → 그 사람에게만 전하고, 그 사람 .env의 TANGBANG_ADMIN_TOKEN에 넣는다
node scripts/d1_publish.mjs admin-list
node scripts/d1_publish.mjs admin-revoke 이름   # 그 사람만 바로 막힌다
```

## 받은 기록

도구함에서 받거나 앱이 스스로 업데이트하면 D1 `dl_log`에 하루·이름·프로그램·버전·파일마다 횟수가 남는다(이름은 들어올 때 적은 프로필 이름, 앱 업데이트는 `update`).
