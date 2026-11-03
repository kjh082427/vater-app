# NSIS 설치 파일을 조용히 설치하고 Vater.exe를 띄워, 함께 설치된 vater-core.exe가
# Vater의 자식으로 실행되어 127.0.0.1에서 요청을 받는지 확인한다(토큰 없이 /health → 401).
# 운영 실행 경로(Mode::Bundled, resources 배치, PyInstaller로 묶은 keyring 백엔드)를 본다.
# 마지막으로 Vater.exe를 taskkill /F로 끝내 vater-core.exe도 5초 안에 끝나는지 본다(작업 개체).
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$installer = Get-ChildItem (Join-Path $repo 'apps/desktop/src-tauri/target/release/bundle/nsis') -Filter '*-setup.exe' | Select-Object -First 1
if (-not $installer) { throw 'NSIS installer not found' }

$setup = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
"installer exit code: $($setup.ExitCode)"
$app = Get-ChildItem $env:LOCALAPPDATA -Filter 'Vater.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $app) { throw 'Vater.exe was not installed under %LOCALAPPDATA%' }
"installed: $($app.FullName)"
$core = Join-Path $app.DirectoryName 'vater-core/vater-core.exe'
if (-not (Test-Path $core)) { throw "bundled sidecar missing: $core" }

$vater = Start-Process -FilePath $app.FullName -PassThru
$clock = [Diagnostics.Stopwatch]::StartNew()
try {
    $port = $null
    while (-not $port -and $clock.Elapsed.TotalSeconds -lt 120) {
        if ($vater.HasExited) { throw "Vater.exe exited with code $($vater.ExitCode)" }
        $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($vater.Id) AND Name = 'vater-core.exe'" | Select-Object -First 1
        if ($child) {
            $listen = Get-NetTCPConnection -OwningProcess $child.ProcessId -State Listen -ErrorAction SilentlyContinue |
                Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -First 1
            if ($listen) { $port = $listen.LocalPort }
        }
        if (-not $port) { Start-Sleep -Milliseconds 500 }
    }
    if (-not $port) { throw 'bundled vater-core.exe did not start listening within 120 s' }
    'vater-core.exe (child of Vater.exe) listening on 127.0.0.1:{0} after {1:N1} s' -f $port, $clock.Elapsed.TotalSeconds
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing | Out-Null
        throw 'GET /health without a token should be rejected'
    }
    catch [Microsoft.PowerShell.Commands.HttpResponseException] {
        $status = [int]$_.Exception.Response.StatusCode
        "GET /health without token -> $status"
        if ($status -ne 401) { throw "expected 401, got $status" }
    }

    # 셸이 강제로 끝나도(비정상 종료와 같다) 사이드카가 남지 않아야 한다: Windows 작업 개체
    $corePid = $child.ProcessId
    taskkill /F /PID $vater.Id | Out-Null
    $gone = [Diagnostics.Stopwatch]::StartNew()
    while (Get-Process -Id $corePid -ErrorAction SilentlyContinue) {
        if ($gone.Elapsed.TotalSeconds -gt 5) { throw "vater-core.exe ($corePid) survived taskkill /F of Vater.exe" }
        Start-Sleep -Milliseconds 100
    }
    'vater-core.exe ended {0:N1} s after taskkill /F of Vater.exe' -f $gone.Elapsed.TotalSeconds
}
finally {
    # 러너 정리: 트레이 앱은 창 닫기로 끝나지 않으므로 강제로 끝낸다(사이드카 포함)
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $($vater.Id)" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if (-not $vater.HasExited) { Stop-Process -Id $vater.Id -Force }
}
