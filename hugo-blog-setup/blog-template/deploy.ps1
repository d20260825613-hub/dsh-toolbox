<#
=======================================================================
 deploy.ps1 - one-click publish to Cloudflare Pages (Wrangler CLI)
-----------------------------------------------------------------------
 Usage: double-click run-deploy.cmd
        or: powershell -ExecutionPolicy Bypass -File .\deploy.ps1

 Prerequisite (once): wrangler login
 Exit code: 0 = success / 1 = failure
=======================================================================
#>
[CmdletBinding()]
param(
    # Build only, do not upload (local check)
    [switch]$NoDeploy,
    # Publish to a preview branch instead of production, e.g. -Branch dev
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Write-Step([string]$T)  { Write-Host ''; Write-Host ('--- ' + $T) -ForegroundColor Cyan }
function Write-Ok([string]$T)    { Write-Host ('  [OK]   ' + $T) -ForegroundColor Green }
function Write-Info([string]$T)  { Write-Host ('  [..]   ' + $T) -ForegroundColor Gray }
function Write-Warn2([string]$T) { Write-Host ('  [WARN] ' + $T) -ForegroundColor Yellow }
function Write-Err2([string]$T)  { Write-Host ('  [FAIL] ' + $T) -ForegroundColor Red }
function Stop-Deploy([string]$M) { Write-Host ''; Write-Err2 $M; Write-Host ''; exit 1 }
function Test-Cmd([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Always read text as UTF-8. Get-Content would decode a BOM-less file with the
# system code page (GBK on Chinese Windows), which mangles values.
function Read-TextUtf8([string]$Path) {
    try {
        return [System.IO.File]::ReadAllText($Path, (New-Object System.Text.UTF8Encoding($false)))
    } catch {
        return (Get-Content -Raw -LiteralPath $Path)
    }
}

# Drop non-ASCII characters from extracted values (mojibake guard).
function Get-AsciiValue([string]$Text) {
    if (-not $Text) { return '' }
    return ([regex]::Replace($Text, '[^\x20-\x7E]', '')).Trim()
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor White
Write-Host '  Publish blog to Cloudflare Pages (Hugo + Wrangler)'          -ForegroundColor White
Write-Host '==============================================================' -ForegroundColor White

$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
Set-Location -LiteralPath $root

# ---------------------------------------------------------------------
# 1. tools + login state
# ---------------------------------------------------------------------
Write-Step 'Check tools'
if (-not (Test-Cmd 'hugo'))     { Stop-Deploy 'hugo not found. Run bootstrap first, or add Hugo to PATH.' }
if (-not (Test-Cmd 'wrangler')) { Stop-Deploy 'wrangler not found. Run: npm install -g wrangler' }
Write-Ok ((& hugo version | Select-Object -First 1))
Write-Ok ('wrangler ' + (& wrangler --version))

Write-Step 'Check Cloudflare login state'
$whoamiText = ''
$whoamiExit = 0
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $whoamiText = (& wrangler whoami 2>&1 | Out-String)
    $whoamiExit = $LASTEXITCODE
} catch {
    $whoamiText = [string]$_
    $whoamiExit = 1
} finally {
    $ErrorActionPreference = $prevEap
}
if (($whoamiExit -ne 0) -or ($whoamiText -match 'not authenticated|not logged in|wrangler login|Please run')) {
    Write-Host ''
    Write-Err2 'wrangler is not logged in to Cloudflare.'
    Write-Host '  Run this once in this folder (a browser page opens, click Allow):' -ForegroundColor Yellow
    Write-Host '      wrangler login' -ForegroundColor White
    Write-Host '  Then run this script again.' -ForegroundColor Yellow
    if ($whoamiText.Trim()) {
        Write-Host ''
        Write-Host '  --- wrangler output ---' -ForegroundColor DarkGray
        Write-Host $whoamiText.Trim() -ForegroundColor DarkGray
    }
    Write-Host ''
    exit 1
}
foreach ($line in ($whoamiText -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 6)) {
    Write-Info $line.Trim()
}
Write-Ok 'Logged in'

# ---------------------------------------------------------------------
# 2. read wrangler.toml -> project name / base URL
# ---------------------------------------------------------------------
$wranglerFile = Join-Path $root 'wrangler.toml'
if (-not (Test-Path -LiteralPath $wranglerFile)) {
    Stop-Deploy 'wrangler.toml not found (it defines the Pages project name and domain prefix).'
}
$wranglerText = Read-TextUtf8 $wranglerFile
$mName = [regex]::Match($wranglerText, '(?m)^\s*name\s*=\s*"([^"]+)"')
if (-not $mName.Success) { Stop-Deploy 'No "name" field found in wrangler.toml.' }
$projectName = Get-AsciiValue $mName.Groups[1].Value
if (-not $projectName) { Stop-Deploy 'The "name" field in wrangler.toml is empty.' }
if ($projectName -eq 'my-hugo-blog') {
    Write-Warn2 'Project name is still the default "my-hugo-blog"; edit "name" in wrangler.toml to change the URL prefix.'
}

$mBase = [regex]::Match($wranglerText, '(?m)^\s*PUBLIC_BASE_URL\s*=\s*"([^"]*)"')
$baseUrl = ''
if ($mBase.Success) { $baseUrl = Get-AsciiValue $mBase.Groups[1].Value }
if (-not $baseUrl) { $baseUrl = "https://$projectName.pages.dev/" }
if (-not $baseUrl.EndsWith('/')) { $baseUrl = $baseUrl + '/' }

Write-Info ('Pages project : ' + $projectName)
Write-Info ('Site base URL : ' + $baseUrl)

# ---------------------------------------------------------------------
# 3. build
# ---------------------------------------------------------------------
Write-Step 'Hugo build (hugo --minify --gc)'
$publicDir = Join-Path $root 'public'
if (Test-Path -LiteralPath $publicDir) {
    Remove-Item -LiteralPath $publicDir -Recurse -Force
    Write-Info 'Removed old public/'
}
& hugo --minify --gc --baseURL $baseUrl
if ($LASTEXITCODE -ne 0) { Stop-Deploy ("Hugo build failed (exit code $LASTEXITCODE). Nothing was uploaded.") }

$indexFile = Join-Path $publicDir 'index.html'
if (-not (Test-Path -LiteralPath $indexFile)) { Stop-Deploy 'public\index.html not found after build.' }
$fileCount = @(Get-ChildItem -LiteralPath $publicDir -Recurse -File).Count
Write-Ok ("Build OK: $fileCount files -> public\")

# optional Cloudflare files, merged into the output folder when present
foreach ($extra in @('_headers', '_redirects')) {
    $src = Join-Path $root $extra
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $publicDir $extra) -Force
        Write-Info ('Merged ' + $extra)
    }
}

if ($NoDeploy) {
    Write-Host ''
    Write-Ok 'Skipped upload (-NoDeploy). Local preview: hugo server -D'
    Write-Host ''
    exit 0
}

# ---------------------------------------------------------------------
# 4. upload
# ---------------------------------------------------------------------
Write-Step 'Upload to Cloudflare Pages'
$deployArgs = @(
    'pages', 'deploy', 'public',
    '--project-name', $projectName,
    '--branch', $Branch,
    '--commit-dirty=true'
)
Write-Info ('wrangler ' + ($deployArgs -join ' '))
$outFile = Join-Path $env:TEMP ('wrangler-deploy-' + [Guid]::NewGuid().ToString('N') + '.txt')

$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & wrangler @deployArgs 2>&1 | Tee-Object -FilePath $outFile
    $deployExit = $LASTEXITCODE
} catch {
    Write-Warn2 ([string]$_)
    $deployExit = 1
} finally {
    $ErrorActionPreference = $prevEap
}

$deployLog = ''
if (Test-Path -LiteralPath $outFile) { $deployLog = (Get-Content -Raw -LiteralPath $outFile) }

if ($deployExit -ne 0) {
    # The temp file is only a place to read wrangler's output back from; deleting
    # it on every exit keeps %TEMP% from filling up one file per deploy.
    try {
        Write-Host ''
        Write-Err2 ("Upload failed (wrangler exit code $deployExit).")
        if ($deployLog -match 'not authenticated|wrangler login') {
            Write-Host '  -> Run once: wrangler login' -ForegroundColor Yellow
        }
        if ($deployLog -match 'already exists|duplicate|taken|not available') {
            Write-Host '  -> Project name may be taken or invalid. Edit "name" in wrangler.toml and retry.' -ForegroundColor Yellow
        }
        if ($deployLog -match 'A project with this name does not exist') {
            Write-Host ('  -> Create it first: wrangler pages project create ' + $projectName) -ForegroundColor Yellow
        }
        Write-Host ''
    } finally {
        Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------
# 5. result
# ---------------------------------------------------------------------
$urls = @()
foreach ($m in [regex]::Matches($deployLog, 'https://[A-Za-z0-9][A-Za-z0-9\.\-]*\.pages\.dev')) {
    if ($urls -notcontains $m.Value) { $urls += $m.Value }
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host '  Deployed successfully'                                       -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Production URL (public HTTP/HTTPS):' -ForegroundColor White
Write-Host ('      https://' + $projectName + '.pages.dev') -ForegroundColor Cyan
if ($urls.Count -gt 0) {
    Write-Host ''
    Write-Host '  URLs reported by wrangler:' -ForegroundColor Gray
    foreach ($u in $urls) { Write-Host ('      ' + $u) -ForegroundColor Gray }
}
Write-Host ''
Write-Host '  Tip: the CDN may need a few seconds; press Ctrl+F5 to hard refresh.' -ForegroundColor DarkGray
Write-Host ''
exit 0
