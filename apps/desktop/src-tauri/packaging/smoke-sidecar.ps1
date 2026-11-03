# PyInstaller로 만든 vater-core.exe를 실제로 띄워 확인한다:
# ready 줄 → GET /health 200 → POST /shutdown 202 → 종료 코드 0.
# 토큰은 화면·로그에 쓰지 않는다.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$exe = Join-Path $repo 'sidecar/dist/vater-core/vater-core.exe'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("vater-smoke-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

$token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
if ($env:GITHUB_ACTIONS) { Write-Output "::add-mask::$token" }
$env:VATER_TOKEN = $token
$env:VATER_BACKGROUND_JOBS = '0'
$env:VATER_DATA_DIR = Join-Path $tmp 'data'
$env:VATER_SECRET_BACKEND = 'envfile'
$env:VATER_ENV_FILE = Join-Path $tmp 'empty.env'
New-Item -ItemType File -Path $env:VATER_ENV_FILE | Out-Null

$stdout = Join-Path $tmp 'stdout.txt'
$stderr = Join-Path $tmp 'stderr.txt'
$clock = [Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $exe -NoNewWindow -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$null = $proc.Handle  # 종료 코드를 읽으려면 핸들을 먼저 잡아 둔다

try {
    $port = $null
    while (-not $port -and $clock.Elapsed.TotalSeconds -lt 120) {
        if ($proc.HasExited) { throw "vater-core exited early with code $($proc.ExitCode)" }
        if (Test-Path $stdout) {
            foreach ($line in Get-Content $stdout -Encoding utf8) {
                try { $event = $line | ConvertFrom-Json } catch { continue }
                if ($event.type -eq 'ready') { $port = [int]$event.port }
            }
        }
        if (-not $port) { Start-Sleep -Milliseconds 200 }
    }
    if (-not $port) { throw 'no ready line within 120 s' }
    'ready on 127.0.0.1:{0} after {1:N1} s' -f $port, $clock.Elapsed.TotalSeconds

    $headers = @{ Authorization = "Bearer $token" }
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -Headers $headers -UseBasicParsing
    "GET /health -> $($health.StatusCode) $($health.Content)"
    if ($health.StatusCode -ne 200) { throw 'health check failed' }
    # 포장본의 버전이 pyproject와 같아야 한다(메타데이터를 빠뜨리면 0.0.0-dev가 된다)
    $expected = (Select-String -Path (Join-Path $repo 'sidecar/pyproject.toml') -Pattern '^version = "(.+)"$').Matches[0].Groups[1].Value
    $actual = ($health.Content | ConvertFrom-Json).version
    if ($actual -ne $expected) { throw "/health version '$actual' != pyproject '$expected'" }

    $shutdown = Invoke-WebRequest -Uri "http://127.0.0.1:$port/shutdown" -Method Post -Headers $headers -UseBasicParsing
    "POST /shutdown -> $($shutdown.StatusCode)"
    if ($shutdown.StatusCode -ne 202) { throw 'shutdown request failed' }

    if (-not $proc.WaitForExit(15000)) { throw 'vater-core did not exit within 15 s after /shutdown' }
    "exit code: $($proc.ExitCode)"
    if ($proc.ExitCode -ne 0) { throw "unexpected exit code $($proc.ExitCode)" }
}
finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    if (Test-Path $stderr) {
        $err = Get-Content $stderr -Raw
        if ($err) { "--- stderr ---"; $err }
    }
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
