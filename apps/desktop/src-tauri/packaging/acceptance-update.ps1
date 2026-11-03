# 5단계 확인 R3~R5: 설치한 구버전이 업데이트를 어떻게 받는지 실제 프로세스로 확인한다.
# 쓰는 곳: .github/workflows/release-acceptance.yml. 임시 서명 키로 만든 `e2e-auto-update` 빌드만 쓴다.
#   R5 서버에 연결 못함 → 구버전 그대로, 앱·사이드카 정상
#   R4 서명이 틀림      → 설치하지 않음, 구버전 그대로, 앱·사이드카 정상
#   R3 올바른 업데이트  → 새 버전으로 바뀌고 앱과 사이드카가 다시 뜸
# -RealRelease: R8. 실제 공개 릴리스에서 HTTPS로 받는다(R5·R4와 로컬 서버는 건너뜀).
param(
    [Parameter(Mandatory)] [string] $OldDir,
    [string] $NewDir,
    [Parameter(Mandatory)] [string] $OldVersion,
    [Parameter(Mandatory)] [string] $NewVersion,
    [switch] $RealRelease
)
$ErrorActionPreference = 'Stop'
$port = 8765
# 앱은 시작 15초 뒤에 확인한다. 내려받기와 서명 확인까지 넉넉히 기다린다.
$settleSeconds = 45

function Step($name) { "`n=== $name" }
function Procs {
    Get-CimInstance Win32_Process -Filter "Name = 'Vater.exe' OR Name = 'vater-core.exe'" |
        Select-Object ProcessId, ParentProcessId, Name | Format-Table -AutoSize | Out-String
}
function Fail($msg) { "FAILED: $msg"; Procs; throw $msg }
function Installed {
    Get-ChildItem $env:LOCALAPPDATA -Filter 'Vater.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
}
function VersionOf($file) { (Get-Item $file).VersionInfo.ProductVersion }
function StopAll {
    Get-Process -Name 'Vater', 'vater-core' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}
function WaitCore($seconds) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt $seconds) {
        foreach ($p in @(Get-Process -Name 'vater-core' -ErrorAction SilentlyContinue)) {
            if (Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq '127.0.0.1') {
                return $p.Id
            }
        }
        Start-Sleep -Milliseconds 300
    }
    return $null
}
# 구버전을 띄우고, 업데이트를 시도할 시간만큼 기다린 뒤 그대로인지 본다.
function ExpectNoChange($label) {
    $app = Installed
    Start-Process -FilePath $app.FullName | Out-Null
    $core = WaitCore 120
    if (-not $core) { Fail "$label`: sidecar did not start" }
    Start-Sleep -Seconds $settleSeconds
    $now = Installed
    $v = VersionOf $now.FullName
    if ($v -ne $OldVersion) { Fail "$label`: version changed to $v" }
    if (-not (Get-Process -Name 'Vater' -ErrorAction SilentlyContinue)) { Fail "$label`: Vater.exe is gone" }
    if (-not (Get-Process -Id $core -ErrorAction SilentlyContinue)) { Fail "$label`: sidecar was stopped" }
    "$label`: stayed on $v, Vater.exe and sidecar alive"
    StopAll
}

$serve = Join-Path ([IO.Path]::GetTempPath()) ("vater-update-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $serve | Out-Null
$oldExe = Get-ChildItem $OldDir -Filter '*-setup.exe' | Select-Object -First 1
if (-not $RealRelease) {
    $newExe = Get-ChildItem $NewDir -Filter '*-setup.exe' | Select-Object -First 1
    $newSig = (Get-Content "$($newExe.FullName).sig" -Raw).Trim()
    $oldSig = (Get-Content "$($oldExe.FullName).sig" -Raw).Trim()
    Copy-Item $newExe.FullName $serve
}
function WriteLatest($signature) {
    @{
        version   = $NewVersion
        notes     = 'acceptance'
        pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        platforms = @{ 'windows-x86_64' = @{ signature = $signature; url = "http://127.0.0.1:$port/$($newExe.Name)" } }
    } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $serve 'latest.json') -Encoding utf8NoBOM
}

$server = $null
try {
    Step "구버전 $OldVersion 설치"
    $setup = Start-Process -FilePath $oldExe.FullName -ArgumentList '/S' -Wait -PassThru
    if ($setup.ExitCode -ne 0) { Fail "installer exit code $($setup.ExitCode)" }
    $app = Installed
    if (-not $app) { Fail 'Vater.exe not installed' }
    $v = VersionOf $app.FullName
    "installed $v at $($app.FullName)"
    if ($v -ne $OldVersion) { Fail "expected $OldVersion, got $v" }

    if (-not $RealRelease) {
        Step 'R5 업데이트 서버에 연결 못함'
        ExpectNoChange 'R5'

        $server = Start-Process -FilePath 'python' -ArgumentList '-m', 'http.server', $port, '--bind', '127.0.0.1', '--directory', $serve -PassThru -WindowStyle Hidden
        Start-Sleep -Seconds 2

        Step 'R4 서명이 틀린 latest.json (다른 파일의 서명)'
        WriteLatest $oldSig
        ExpectNoChange 'R4'

        Step 'R3 올바른 업데이트'
        WriteLatest $newSig
    }
    else {
        Step 'R8 실제 공개 릴리스에서 HTTPS로 업데이트'
    }
    Start-Process -FilePath (Installed).FullName | Out-Null
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $done = $false
    while ($clock.Elapsed.TotalSeconds -lt 240) {
        $file = Installed
        if ($file -and ((VersionOf $file.FullName) -eq $NewVersion)) { $done = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $done) { Fail "not updated to $NewVersion within 240 s" }
    'updated to {0} after {1:N0} s' -f $NewVersion, $clock.Elapsed.TotalSeconds
    # 설치 프로그램이 새 버전을 다시 띄운다
    $core = WaitCore 120
    if (-not $core) { Fail 'sidecar did not come back after the update' }
    if (-not (Get-Process -Name 'Vater' -ErrorAction SilentlyContinue)) { Fail 'Vater.exe did not come back' }
    "new version running: sidecar pid $core"
    "`n$(if ($RealRelease) { 'R8' } else { 'R3 R4 R5' }) passed"
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    StopAll
}
