# 설치 파일·서명·latest.json을 vater-releases에 초안으로 올리고, 받아서 검증한 뒤 공개한다.
# 올리는 것은 이 세 파일뿐이다(소스 없음). 토큰은 GH_TOKEN 환경변수로만 받고 출력하지 않는다.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$bundle = Join-Path $repo 'apps/desktop/src-tauri/target/release/bundle/nsis'
$name = "Vater_$($env:VERSION)_x64-setup.exe"
$files = @($name, "$name.sig", 'latest.json') | ForEach-Object { Join-Path $bundle $_ }
foreach ($f in $files) { if (-not (Test-Path $f)) { throw "missing: $f" } }

function Gh {
    & gh @args
    if ($LASTEXITCODE) { throw "gh $($args[0]) $($args[1]) failed ($LASTEXITCODE)" }
}

$notes = if ($env:NOTES) { $env:NOTES } else { "Vater $($env:VERSION)" }
Gh release create $env:TAG --repo $env:RELEASES_REPO --draft --title "Vater $($env:VERSION)" --notes $notes @files

$check = Join-Path ([IO.Path]::GetTempPath()) ("vater-release-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $check | Out-Null
Gh release download $env:TAG --repo $env:RELEASES_REPO --dir $check
$got = @(Get-ChildItem $check | ForEach-Object Name | Sort-Object)
$want = @('latest.json', $name, "$name.sig" | Sort-Object)
if (($got -join ',') -ne ($want -join ',')) { throw "unexpected assets: $($got -join ', ')" }
foreach ($f in $files) {
    $a = (Get-FileHash $f).Hash
    $b = (Get-FileHash (Join-Path $check (Split-Path $f -Leaf))).Hash
    if ($a -ne $b) { throw "hash mismatch: $(Split-Path $f -Leaf)" }
}
$doc = Get-Content (Join-Path $check 'latest.json') -Raw | ConvertFrom-Json
if ($doc.version -ne $env:VERSION) { throw "latest.json version $($doc.version) != $($env:VERSION)" }
$win = $doc.platforms.'windows-x86_64'
$sig = (Get-Content (Join-Path $check "$name.sig") -Raw).Trim()
if ($win.signature -ne $sig) { throw 'latest.json signature does not match the .sig file' }
if ($win.url -ne "https://github.com/$($env:RELEASES_REPO)/releases/download/$($env:TAG)/$name") { throw "bad url: $($win.url)" }
'draft verified'

if ($env:PRERELEASE -eq 'true') {
    Gh release edit $env:TAG --repo $env:RELEASES_REPO --draft=false --prerelease
}
else {
    Gh release edit $env:TAG --repo $env:RELEASES_REPO --draft=false --latest
}
"published $($env:TAG)"
