# 4단계 확인 테스트 W: 설치한 앱을 사람이 쓰는 순서대로 확인한다(Windows CI).
# 계획: docs/superpowers/plans/2026-11-03-stage-4-acceptance.md 의 W1~W9.
# 실패하면 그 단계 이름과 프로세스 목록을 출력하고 끝난다.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path

function Step($name) { "`n=== $name" }
function Procs {
    Get-CimInstance Win32_Process -Filter "Name = 'Vater.exe' OR Name = 'vater-core.exe'" |
        Select-Object ProcessId, ParentProcessId, Name | Format-Table -AutoSize | Out-String
}
function Fail($msg) { "FAILED: $msg"; Procs; throw $msg }
function Shells { @(Get-Process -Name 'Vater' -ErrorAction SilentlyContinue) }
function CoreOf($shellPid) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $shellPid AND Name = 'vater-core.exe'" | Select-Object -First 1
}
function ListenPort($procId) {
    $l = Get-NetTCPConnection -OwningProcess $procId -State Listen -ErrorAction SilentlyContinue |
        Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -First 1
    if ($l) { $l.LocalPort } else { $null }
}
# 셸의 자식 사이드카가 127.0.0.1에서 듣기 시작할 때까지 기다린다. $notPid가 주어지면 그와 다른 PID여야 한다.
function WaitCore($shellPid, $seconds, $notPid = 0) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt $seconds) {
        $c = CoreOf $shellPid
        if ($c -and $c.ProcessId -ne $notPid) {
            $p = ListenPort $c.ProcessId
            if ($p) { return [pscustomobject]@{ Pid = $c.ProcessId; Port = $p; Seconds = $clock.Elapsed.TotalSeconds } }
        }
        Start-Sleep -Milliseconds 300
    }
    return $null
}
function Expect401($port) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing | Out-Null
        Fail 'GET /health without a token should be rejected'
    }
    catch [Microsoft.PowerShell.Commands.HttpResponseException] {
        $s = [int]$_.Exception.Response.StatusCode
        if ($s -ne 401) { Fail "expected 401, got $s" }
    }
}
function KillTree($p) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $p" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- W1
Step 'W1 관리자 권한 없이 조용히 설치'
$installer = Get-ChildItem (Join-Path $repo 'apps/desktop/src-tauri/target/release/bundle/nsis') -Filter '*-setup.exe' | Select-Object -First 1
if (-not $installer) { Fail 'NSIS installer not found' }
$setup = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
if ($setup.ExitCode -ne 0) { Fail "installer exit code $($setup.ExitCode)" }
$app = Get-ChildItem $env:LOCALAPPDATA -Filter 'Vater.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $app) { Fail 'Vater.exe not under %LOCALAPPDATA% (currentUser install)' }
"installed: $($app.FullName)"
$startMenu = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
$lnk = Get-ChildItem $startMenu -Filter 'Vater*.lnk' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $lnk) { Fail "no Start Menu shortcut under $startMenu" }
"start menu: $($lnk.FullName)"

# ---------------------------------------------------------------- W2
Step 'W2 실행: 셸 1개, 사이드카 1개, 토큰 없이 401'
$vater = Start-Process -FilePath $app.FullName -PassThru
try {
    $core = WaitCore $vater.Id 120
    if (-not $core) { Fail 'sidecar did not listen within 120 s' }
    'sidecar pid {0} port {1} after {2:N1} s' -f $core.Pid, $core.Port, $core.Seconds
    if ((Shells).Count -ne 1) { Fail "expected 1 Vater.exe, got $((Shells).Count)" }
    Expect401 $core.Port

    # ------------------------------------------------------------ W3
    Step 'W3 창 닫기(WM_CLOSE) → 트레이로 숨김, 둘 다 살아 있음'
    taskkill /PID $vater.Id 2>&1 | Out-String | Write-Output
    Start-Sleep -Seconds 3
    if ($vater.HasExited) { Fail 'Vater.exe exited on window close (should hide to tray)' }
    if (-not (Get-Process -Id $core.Pid -ErrorAction SilentlyContinue)) { Fail 'sidecar died on window close' }
    'still running after close: Vater.exe and sidecar'

    # ------------------------------------------------------------ W4
    Step 'W4 다시 실행 → 단일 인스턴스, 사이드카 그대로'
    $second = Start-Process -FilePath $app.FullName -PassThru
    Start-Sleep -Seconds 5
    $shells = Shells
    if ($shells.Count -ne 1) { Fail "expected 1 Vater.exe after second launch, got $($shells.Count)" }
    if ($shells[0].Id -ne $vater.Id) { Fail 'the surviving Vater.exe is not the first one' }
    $again = CoreOf $vater.Id
    if (-not $again -or $again.ProcessId -ne $core.Pid) { Fail 'sidecar changed after second launch' }
    "second launch exited: $($second.HasExited) (code $($second.ExitCode))"

    # ------------------------------------------------------------ W5
    Step 'W5 사이드카 강제 종료 1번 → 자동 재실행(새 PID)'
    $restarts = 0
    $current = $core
    taskkill /F /PID $current.Pid | Out-Null
    $next = WaitCore $vater.Id 30 $current.Pid
    if (-not $next) { Fail 'sidecar was not restarted within 30 s' }
    $restarts++
    'restarted: pid {0} port {1} after {2:N1} s' -f $next.Pid, $next.Port, $next.Seconds
    Expect401 $next.Port
    $current = $next

    # ------------------------------------------------------------ W6
    Step 'W6 연달아 강제 종료 → 10분에 3번까지만 재실행, 셸은 살아 있음'
    while ($restarts -lt 3) {
        taskkill /F /PID $current.Pid | Out-Null
        $next = WaitCore $vater.Id 30 $current.Pid
        if (-not $next) { Fail "restart #$($restarts + 1) did not happen within 30 s" }
        $restarts++
        'restart #{0}: pid {1} after {2:N1} s' -f $restarts, $next.Pid, $next.Seconds
        $current = $next
    }
    taskkill /F /PID $current.Pid | Out-Null
    $extra = WaitCore $vater.Id 25 $current.Pid
    if ($extra) { Fail "4th exit was restarted (pid $($extra.Pid)); policy allows 3 per 10 min" }
    if ($vater.HasExited) { Fail 'Vater.exe exited after giving up on the sidecar' }
    'after the 4th exit: no restart, Vater.exe alive'
}
finally {
    KillTree $vater.Id
}

# ---------------------------------------------------------------- W7
Step 'W7 셸 강제 종료 → 사이드카도 종료(작업 개체)'
$vater = Start-Process -FilePath $app.FullName -PassThru
try {
    $core = WaitCore $vater.Id 120
    if (-not $core) { Fail 'sidecar did not listen within 120 s (W7)' }
    taskkill /F /PID $vater.Id | Out-Null
    $gone = [Diagnostics.Stopwatch]::StartNew()
    while (Get-Process -Id $core.Pid -ErrorAction SilentlyContinue) {
        if ($gone.Elapsed.TotalSeconds -gt 5) { Fail 'sidecar survived taskkill /F of Vater.exe' }
        Start-Sleep -Milliseconds 100
    }
    'sidecar ended {0:N1} s after taskkill /F' -f $gone.Elapsed.TotalSeconds
}
finally {
    KillTree $vater.Id
}

# ---------------------------------------------------------------- W8
Step 'W8 로그 폴더: 파일이 있고 토큰(64자 16진수)이 없음'
$logs = Join-Path $env:APPDATA 'Vater/logs'
$files = @(Get-ChildItem $logs -File -ErrorAction SilentlyContinue)
if ($files.Count -eq 0) { Fail "no log files in $logs" }
"log files: $($files.Count)"
$hits = $files | Select-String -Pattern '(?<![0-9a-fA-F])[0-9a-f]{64}(?![0-9a-fA-F])' -List
if ($hits) { Fail "64-hex token-like string in logs: $($hits | ForEach-Object { $_.Path } | Select-Object -Unique)" }
'no token-like strings in logs'

# ---------------------------------------------------------------- W9
Step 'W9 조용히 제거 → 설치 폴더 사라짐, 남은 프로세스 0'
$uninst = Get-ChildItem $app.DirectoryName -Filter 'uninstall*.exe' | Select-Object -First 1
if (-not $uninst) { Fail "uninstaller not found in $($app.DirectoryName)" }
Start-Process -FilePath $uninst.FullName -ArgumentList '/S' -Wait | Out-Null
$clock = [Diagnostics.Stopwatch]::StartNew()
while ((Test-Path $app.FullName) -and $clock.Elapsed.TotalSeconds -lt 60) { Start-Sleep -Milliseconds 500 }
if (Test-Path $app.FullName) { Fail "Vater.exe still present after uninstall: $($app.FullName)" }
$left = Get-CimInstance Win32_Process -Filter "Name = 'Vater.exe' OR Name = 'vater-core.exe'"
if ($left) { Fail 'processes left after uninstall' }
'uninstalled, no processes left'
"`nW1~W9 passed"
