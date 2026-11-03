# publish-release.ps1을 가짜 gh로 돌려 흐름을 확인한다. 실제 경로는 비밀값이 있어야 돌기 때문에
# 여기서 먼저 잡는다(함수 이름 때문에 무한 호출하던 결함이 그런 예다).
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) ("vater-publish-" + [Guid]::NewGuid().ToString('N'))
$stub = Join-Path $root 'bin'
$bundle = Join-Path $root 'bundle'
New-Item -ItemType Directory -Path $stub, $bundle | Out-Null
"@python `"$here\fake-gh.py`" %*" | Set-Content (Join-Path $stub 'gh.cmd') -Encoding ascii
$env:PATH = "$stub;$env:PATH"
$env:TAG = 'v9.9.9'
$env:VERSION = '9.9.9'
$env:RELEASES_REPO = 'kjh082427/vater-releases'
$env:NOTES = ''
$exe = Join-Path $bundle 'Vater_9.9.9_x64-setup.exe'
'not really an installer' | Set-Content $exe
'c2lnbmF0dXJl' | Set-Content "$exe.sig"
python (Join-Path $here 'make-latest-json.py') --version 9.9.9 --sig "$exe.sig" `
    --base-url "https://github.com/$($env:RELEASES_REPO)/releases/download" --out (Join-Path $bundle 'latest.json')
if ($LASTEXITCODE) { throw 'make-latest-json failed' }

function Fresh {
    $env:FAKE_GH_DIR = Join-Path $root ("gh-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $env:FAKE_GH_DIR | Out-Null
    $env:FAKE_GH_CORRUPT = '0'
    $env:PRERELEASE = 'false'
}
function Publish {
    # 출력을 파이프라인으로 흘리면 함수의 반환값에 섞인다
    & pwsh -NoProfile -File (Join-Path $here 'publish-release.ps1') -Bundle $bundle | Out-Host
    return $LASTEXITCODE
}
function State { Get-Content (Join-Path $env:FAKE_GH_DIR 'state.json') -Raw | ConvertFrom-Json }
function Check($cond, $msg) { if (-not $cond) { throw "FAILED: $msg" }; "ok: $msg" }

"`n=== P1 정식 릴리스: 초안 → 검증 → 공개, latest"
Fresh
$code = Publish
Check ($code -eq 0) 'exit 0'
$s = State
Check (-not $s.draft) 'published'
Check ($s.latest -and -not $s.prerelease) 'marked latest'
Check ((Get-ChildItem (Join-Path $env:FAKE_GH_DIR 'assets')).Count -eq 3) 'exactly 3 assets'

"`n=== P2 프리릴리스는 latest가 되지 않는다"
Fresh
$env:PRERELEASE = 'true'
$code = Publish
Check ($code -eq 0) 'exit 0'
$s = State
Check ($s.prerelease -and -not $s.latest) 'prerelease, not latest'

"`n=== P3 남은 초안은 지우고 다시 올린다"
Fresh
@{ draft = $true; prerelease = $false; latest = $false } | ConvertTo-Json | Set-Content (Join-Path $env:FAKE_GH_DIR 'state.json')
$code = Publish
Check ($code -eq 0) 'exit 0'
Check (-not (State).draft) 'published after replacing the draft'
Check ((Get-Content (Join-Path $env:FAKE_GH_DIR 'calls.log')) -contains 'release delete v9.9.9') 'draft deleted'

"`n=== P4 이미 공개된 릴리스는 덮어쓰지 않는다"
Fresh
@{ draft = $false; prerelease = $false; latest = $true } | ConvertTo-Json | Set-Content (Join-Path $env:FAKE_GH_DIR 'state.json')
$code = Publish
Check ($code -ne 0) 'fails'
Check (-not ((Get-Content (Join-Path $env:FAKE_GH_DIR 'calls.log')) -match 'release (delete|create)')) 'nothing changed'

"`n=== P5 올린 파일이 다르면 공개하지 않는다"
Fresh
$env:FAKE_GH_CORRUPT = '1'
$code = Publish
Check ($code -ne 0) 'fails'
Check ((State).draft) 'stays a draft'

"`nP1~P5 passed"
