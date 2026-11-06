# 탕방 데이터 DB(Cloudflare D1 + Worker)를 처음 한 번 만들고 배포한다. 여러 번 돌려도 된다(이미 된 단계는 건너뜀).
#   실행(프로젝트 폴더에서): powershell -ExecutionPolicy Bypass -File worker\setup.ps1
# 하는 일: wrangler 설치 → Cloudflare 로그인(처음 한 번 브라우저) → D1 만들기 → 표 만들기 → 비밀 값 넣기 → 배포
#          → 지금 onsen.json을 올리고 공개 → 사용자 주소로 확인 → 화면(web/src/lib/api.ts)에 Worker 주소 적기
# 비밀 값(관리 토큰·제보 해시용 값)은 이 스크립트가 만들어 Worker와 프로젝트 .env에만 넣고, 화면에 출력하지 않는다.
# Windows PowerShell 5.1은 wrangler가 경고를 stderr로 내기만 해도 Stop이면 멈춰서 Continue로 두고, 단계마다 결과를 직접 확인한다(throw는 그대로 멈춤)
$ErrorActionPreference = "Continue"
$worker = $PSScriptRoot
$root = Split-Path -Parent $worker
$envFile = Join-Path $root ".env"
Set-Location $worker

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function EnvHas($name) { (Test-Path $envFile) -and (Select-String -Path $envFile -Pattern "^\s*$name=" -Quiet) }
# .env 마지막 줄에 줄바꿈이 없으면 새 값이 앞 줄에 붙어 버린다(2026-11-06에 실제로 일어남) → 줄바꿈부터 확인한다
function EnvAdd($name, $value) {
  $pre = ""
  if ((Test-Path $envFile) -and (Get-Item $envFile).Length -gt 0) { $b = [IO.File]::ReadAllBytes($envFile); if ($b[-1] -ne 10) { $pre = "`r`n" } }
  [IO.File]::AppendAllText($envFile, "$pre$name=$value`r`n", (New-Object Text.UTF8Encoding $false))
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function NewSecret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString("x2") }) -join "" }

Step "1/8 wrangler 설치"
if (-not (Test-Path (Join-Path $worker "node_modules\wrangler"))) { npm install --no-audit --no-fund | Out-Host }

Step "2/8 Cloudflare 로그인 확인"
$who = (npx wrangler whoami 2>&1 | Out-String)
if ($who -match "not authenticated|You are not logged in") {
  Write-Host "브라우저가 열리면 Cloudflare에 로그인하고 '허용'을 눌러 주세요."
  npx wrangler login | Out-Host
}

Step "3/8 D1 데이터베이스(tangbang)"
$toml = Get-Content (Join-Path $worker "wrangler.toml") -Raw -Encoding UTF8
if ($toml -match 'database_id = "00000000-0000-0000-0000-000000000000"') {
  $list = (npx wrangler d1 list --json 2>$null | Out-String)
  $id = $null
  try { $id = (($list | ConvertFrom-Json) | Where-Object { $_.name -eq "tangbang" } | Select-Object -First 1).uuid } catch { }
  if (-not $id) {
    $out = (npx wrangler d1 create tangbang 2>&1 | Out-String)
    Write-Host $out
    $m = [regex]::Match($out, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
    if (-not $m.Success) { throw "D1을 만들었지만 id를 찾지 못했어요. 위 출력의 database_id를 wrangler.toml에 직접 넣고 다시 실행해 주세요." }
    $id = $m.Value
  }
  $toml = $toml -replace 'database_id = "00000000-0000-0000-0000-000000000000"', "database_id = `"$id`""
  [IO.File]::WriteAllText((Join-Path $worker "wrangler.toml"), $toml, (New-Object Text.UTF8Encoding $false))
  Write-Host "wrangler.toml에 database_id를 적었어요."
} else { Write-Host "이미 연결돼 있어요." }

Step "4/8 표 만들기(schema.sql, 이미 있으면 그대로)"
npx wrangler d1 execute tangbang --remote --file schema.sql | Out-Host

Step "5/8 배포(비밀 값을 넣으려면 Worker가 먼저 있어야 해요)"
$dep = (npx wrangler deploy 2>&1 | Out-String)
Write-Host $dep
$url = [regex]::Match($dep, 'https://[a-z0-9.-]+\.workers\.dev').Value
if (-not $url) { throw "배포 주소(https://...workers.dev)를 찾지 못했어요. 위 출력을 확인해 주세요." }
if (-not (EnvHas "TANGBANG_API")) { EnvAdd "TANGBANG_API" $url }

Step "6/8 비밀 값"
$ErrorActionPreference = "Continue"
$secrets = (cmd /c "npx wrangler secret list 2>nul" | Out-String)
$ErrorActionPreference = "Stop"
if (-not (EnvHas "TANGBANG_ADMIN_TOKEN") -or $secrets -notmatch "ADMIN_TOKEN") {
  if (EnvHas "TANGBANG_ADMIN_TOKEN") { throw ".env에는 TANGBANG_ADMIN_TOKEN이 있는데 Worker에는 없어요. .env의 그 줄을 지우고 다시 실행해 주세요(새로 만들어 둘 다 넣어요)." }
  $admin = NewSecret
  $env:SECRET_VALUE = $admin; node put-secret.mjs ADMIN_TOKEN; Remove-Item Env:SECRET_VALUE
  EnvAdd "TANGBANG_ADMIN_TOKEN" $admin
  Write-Host "관리 토큰을 만들어 Worker와 .env에 넣었어요(값은 표시하지 않아요)."
} else { Write-Host "관리 토큰: 이미 있어요." }
if ($secrets -notmatch "REPORT_SALT") {
  $env:SECRET_VALUE = (NewSecret); node put-secret.mjs REPORT_SALT; Remove-Item Env:SECRET_VALUE
  Write-Host "제보 해시용 값을 Worker에 넣었어요."
} else { Write-Host "제보 해시용 값: 이미 있어요." }


Step "7/8 지금 데이터 올리고 공개"
Set-Location $root
node --env-file=.env scripts/d1_publish.mjs ingest
node --env-file=.env scripts/d1_publish.mjs publish --note "첫 공개(setup.ps1)"
$check = Invoke-RestMethod "$url/api/places"
$local = (Get-Content "web/public/data/onsen.json" -Raw -Encoding UTF8 | ConvertFrom-Json).places.Count
Write-Host ("확인: Worker가 내주는 곳 {0}곳 / onsen.json {1}곳" -f $check.places.Count, $local)
if ($check.places.Count -ne $local) { throw "곳 수가 달라요. 화면 주소는 바꾸지 않았어요." }

Step "8/8 화면이 Worker를 읽게 하기(web/src/lib/api.ts)"
$api = Join-Path $root "web/src/lib/api.ts"
$t = Get-Content $api -Raw -Encoding UTF8
$t = $t -replace "export const API_BASE = '[^']*'", "export const API_BASE = '$url'"
[IO.File]::WriteAllText($api, $t, (New-Object Text.UTF8Encoding $false))
Write-Host "API_BASE = $url"

Write-Host "`n끝났어요. 서비스(Vercel)에 반영하려면 Claude Code에 '탕방 DB 작업 커밋하고 푸시해줘'라고 말해 주세요." -ForegroundColor Green
Write-Host "이후 수집 결과 공개: node --env-file=.env scripts/d1_publish.mjs ingest → diff → publish"
