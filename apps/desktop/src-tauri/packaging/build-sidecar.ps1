# 사이드카를 PyInstaller onedir로 만든다: sidecar/dist/vater-core/vater-core.exe
# Tauri가 이 폴더를 설치 파일의 vater-core/로 넣는다(tauri.windows.conf.json).
# 쓰는 곳: .github/workflows/desktop.yml, Windows에서 직접 빌드할 때.
# sidecar/pyproject.toml과 uv.lock은 바꾸지 않는다: PyInstaller는 `uv run --with`로 잠깐 얹는다.
$ErrorActionPreference = 'Stop'
$PyInstallerVersion = '6.22.3'  # 2026-09-12 배포 (2주 이상 지난 버전으로 고정)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$sidecar = Join-Path $repo 'sidecar'
$work = Join-Path ([IO.Path]::GetTempPath()) 'vater-pyinstaller'

Push-Location $sidecar
try {
    # 커밋된 uv.lock 그대로, 개발용 의존성은 빼고 설치한다
    uv sync --locked --no-dev
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    # --console: stdout이 Tauri와의 이벤트 통로라서 콘솔 앱으로 만든다(창은 Tauri가 CREATE_NO_WINDOW로 숨긴다)
    # --collect-data vater_core: SQL 마이그레이션과 llm/catalog.json(importlib.resources로 읽는다)
    # --collect-submodules uvicorn: uvicorn이 문자열로 import하는 loop·protocol 모듈
    # --collect-submodules keyring.backends, --copy-metadata keyring: Windows 자격 증명 관리자 백엔드(entry point로 찾는다)
    # --copy-metadata vater-core: /health의 버전(importlib.metadata). 없으면 0.0.0-dev로 보인다
    uv run --locked --no-dev --with "pyinstaller==$PyInstallerVersion" pyinstaller `
        --noconfirm --clean --onedir --console `
        --name vater-core `
        --collect-data vater_core `
        --collect-submodules uvicorn `
        --collect-submodules keyring.backends `
        --copy-metadata keyring `
        --copy-metadata vater-core `
        --distpath (Join-Path $sidecar 'dist') `
        --workpath (Join-Path $work 'build') `
        --specpath $work `
        (Join-Path $PSScriptRoot 'vater_core_entry.py')
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}

$exe = Join-Path $sidecar 'dist/vater-core/vater-core.exe'
if (-not (Test-Path $exe)) { throw "PyInstaller did not produce $exe" }
$size = (Get-ChildItem (Split-Path $exe) -Recurse | Measure-Object Length -Sum).Sum / 1MB
'vater-core onedir: {0:N1} MB' -f $size
