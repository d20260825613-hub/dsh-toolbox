<#
=======================================================================
 bootstrap.ps1 - Hugo + PaperMod + Cloudflare Pages (Wrangler) bootstrap
-----------------------------------------------------------------------
 HOW TO RUN (this file lives next to run-bootstrap.cmd):
     1) double-click  run-bootstrap.cmd
     2) or in PowerShell:  powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1

 WHAT IT DOES (idempotent - safe to run again, nothing is re-downloaded):
   [1] check Git            (never auto-installed; prints manual steps if missing)
   [2] check/install Hugo Extended via winget   (skipped when version is OK)
   [3] check/install Node.js LTS via winget     (skipped when version is OK)
   [4] check/install wrangler via npm -g        (skipped when version is OK)
   [5] create the ./blog site folder
   [6] git init + git submodule add PaperMod theme
   [7] generate config.toml / archetypes / sample posts / wrangler.toml /
       deploy.ps1 / run-deploy.cmd / README.md  (from .\blog-template; files
       ending in .tpl get the __PROJECT__ / __TODAY__ placeholders resolved)
   [8] first build: hugo --minify
   [9] print next steps: only "wrangler login" is manual, then run-deploy.cmd

 CONSTRAINTS
   - No GitHub Actions, no dashboard Git integration: Cloudflare Pages receives
     the files only through "wrangler pages deploy".
   - This script never deploys and never deletes your files.
   - Needs internet access (winget / npm / git submodule).

 NOTE ON ENCODING
   This .ps1 is intentionally pure ASCII so it behaves identically no matter
   which PowerShell edition or code page reads it. All Chinese content lives in
   .\blog-template as UTF-8 files and is copied byte-for-byte (only the
   __PROJECT__ / __TODAY__ placeholders are substituted).
=======================================================================
#>
[CmdletBinding()]
param(
    # Blog folder. Default: <folder of this script>\blog
    [string]$WorkDir,
    # Cloudflare Pages project name = free subdomain prefix -> https://<name>.pages.dev
    [string]$ProjectName = 'my-hugo-blog',
    # Minimum Hugo version accepted without reinstalling
    [string]$HugoMinVersion = '0.128.0',
    # Overwrite generated files even if they already exist
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$script:StepNo = 0
$script:TotalSteps = 9

# ---------------------------------------------------------------------
# console helpers
# ---------------------------------------------------------------------
function Write-Head([string]$Text) {
    $script:StepNo++
    Write-Host ''
    Write-Host ('=' * 66) -ForegroundColor DarkCyan
    Write-Host (" [{0}/{1}] {2}" -f $script:StepNo, $script:TotalSteps, $Text) -ForegroundColor Cyan
    Write-Host ('=' * 66) -ForegroundColor DarkCyan
}
function Write-Ok([string]$Text)    { Write-Host ('  [OK]   ' + $Text) -ForegroundColor Green }
function Write-Skip([string]$Text)  { Write-Host ('  [SKIP] ' + $Text) -ForegroundColor DarkGray }
function Write-Info([string]$Text)  { Write-Host ('  [..]   ' + $Text) -ForegroundColor Gray }
function Write-Warn2([string]$Text) { Write-Host ('  [WARN] ' + $Text) -ForegroundColor Yellow }
function Write-Err2([string]$Text)  { Write-Host ('  [FAIL] ' + $Text) -ForegroundColor Red }

function Stop-Script([string]$Message) {
    Write-Host ''
    Write-Err2 $Message
    Write-Host ''
    Write-Host ' Script stopped. Fix the problem above and run it again (finished steps are skipped).' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

function Test-Cmd([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-SessionPath {
    # Programs installed by winget do not appear in this process PATH; merge once.
    try {
        $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
        $merged  = @($machine, $user) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd(';') }
        $env:Path = ($merged -join ';')
    } catch {
        Write-Warn2 'Could not refresh PATH; reopen PowerShell if a command is still not found.'
    }
    if (Test-Cmd 'npm') {
        try {
            $prefix = (& npm prefix -g 2>$null | Select-Object -First 1)
            if ($prefix) {
                $npmBin = $prefix.Trim()
                if ($npmBin -and (Test-Path $npmBin) -and ($env:Path -notlike "*$npmBin*")) {
                    $env:Path = $env:Path + ';' + $npmBin
                }
            }
        } catch { }
    }
}

function ConvertTo-Version([string]$Text) {
    if (-not $Text) { return $null }
    $m = [regex]::Match($Text, '(\d+)\.(\d+)(?:\.(\d+))?')
    if (-not $m.Success) { return $null }
    $patch = 0
    if ($m.Groups[3].Success) { $patch = [int]$m.Groups[3].Value }
    return (New-Object System.Version([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, $patch))
}

function Invoke-Checked([string]$Exe, [string[]]$Arguments, [string]$What) {
    Write-Info ($What + ' -> ' + $Exe + ' ' + ($Arguments -join ' '))
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        Stop-Script ("$What failed (exit code $LASTEXITCODE).")
    }
}

# ---------------------------------------------------------------------
# locate folders
# ---------------------------------------------------------------------
$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    if ($MyInvocation.MyCommand.Path) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
    else { $scriptDir = (Get-Location).Path }
}
$templateRoot = Join-Path $scriptDir 'blog-template'
# The template folder must exist and carry the site config. It is stored as
# config.toml.tpl (placeholder files keep the .tpl suffix), so accept either
# spelling instead of pinning one exact filename.
$tplConfig = Get-ChildItem -LiteralPath $templateRoot -Filter 'config.toml*' -File -ErrorAction SilentlyContinue
if (-not $tplConfig) {
    if (-not (Test-Path -LiteralPath $templateRoot)) {
        Stop-Script "Content template folder not found: $templateRoot  (keep 'blog-template' next to bootstrap.ps1, and do not run this script from inside the blog folder)."
    }
    Stop-Script "Template folder exists but contains no config.toml / config.toml.tpl: $templateRoot"
}
if (-not $WorkDir) { $WorkDir = Join-Path $scriptDir 'blog' }
if (-not (Test-Path -LiteralPath $WorkDir)) {
    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
}
$WorkDir = (Resolve-Path -LiteralPath $WorkDir).Path
$blogDir = $WorkDir

Write-Host ''
Write-Host '==============================================================' -ForegroundColor White
Write-Host '  Hugo + PaperMod + Cloudflare Pages (Wrangler) bootstrap'      -ForegroundColor White
Write-Host '==============================================================' -ForegroundColor White
Write-Host ('  Blog folder : ' + $blogDir)
Write-Host ('  Project name: ' + $ProjectName)
Write-Host ('  Public URL  : https://' + $ProjectName + '.pages.dev   (after deploy)')
Write-Host ('  PowerShell  : ' + $PSVersionTable.PSVersion.ToString())
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Stop-Script 'PowerShell 5.1 or newer is required.'
}

# ---------------------------------------------------------------------
# [1] git
# ---------------------------------------------------------------------
Write-Head 'Check Git'
if (Test-Cmd 'git') {
    $gitVer = (& git --version 2>$null | Select-Object -First 1)
    Write-Ok ('Installed: ' + $gitVer)
} else {
    Write-Warn2 'git not found.'
    Write-Host @'
  Install Git manually (either way), then reopen PowerShell and run this script again:
    1) winget install --id Git.Git -e
    2) installer: https://git-scm.com/download/win
  (This script deliberately does not install git for you: it would silently
   change system-level settings such as the default branch and line endings.)
'@ -ForegroundColor Yellow
    Stop-Script 'Git is required.'
}

# ---------------------------------------------------------------------
# [2] Hugo Extended
# ---------------------------------------------------------------------
Write-Head 'Check Hugo Extended'
$hugoNeedInstall = $true
if (Test-Cmd 'hugo') {
    $hugoRaw = (& hugo version 2>$null | Select-Object -First 1)
    $hugoCurrent = ConvertTo-Version $hugoRaw
    $hugoMin = ConvertTo-Version $HugoMinVersion
    if ($hugoCurrent -and ($hugoCurrent.CompareTo($hugoMin) -ge 0)) {
        Write-Ok ('Installed and new enough: ' + $hugoRaw)
        $hugoNeedInstall = $false
        if ($hugoRaw -notmatch 'extended') {
            Write-Warn2 'This looks like standard Hugo, not extended. PaperMod builds fine with it; only switch to extended if you hit SCSS errors.'
        }
    } else {
        Write-Warn2 ('Version too old: ' + $hugoRaw + ' (need >= ' + $HugoMinVersion + ')')
    }
} else {
    Write-Info 'hugo not found.'
}

if ($hugoNeedInstall) {
    if (-not (Test-Cmd 'winget')) {
        Stop-Script 'winget not available. Download hugo_extended_*_windows-amd64.zip from https://github.com/gohugoio/hugo/releases, put hugo.exe into a PATH folder, then run this script again.'
    }
    Invoke-Checked 'winget' @('install', '--id', 'Hugo.Hugo.Extended', '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity') 'winget install Hugo Extended'
    Update-SessionPath
    if (-not (Test-Cmd 'hugo')) {
        $guess = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter 'hugo.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($guess) {
            $env:Path = $env:Path + ';' + (Split-Path $guess.FullName -Parent)
            Write-Info ('Added to session PATH: ' + (Split-Path $guess.FullName -Parent))
        }
    }
    if (-not (Test-Cmd 'hugo')) {
        Stop-Script 'hugo is still not on PATH. Close this window, open a new PowerShell, and run the script again (PATH needs a new process).'
    }
    $hugoRaw = (& hugo version 2>$null | Select-Object -First 1)
    Write-Ok ('Installed: ' + $hugoRaw)
}

# ---------------------------------------------------------------------
# [3] Node.js
# ---------------------------------------------------------------------
Write-Head 'Check Node.js (needed by wrangler)'
$nodeNeedInstall = $true
if (Test-Cmd 'node') {
    $nodeVer = ConvertTo-Version (& node --version 2>$null)
    if ($nodeVer -and ($nodeVer.Major -ge 18)) {
        Write-Ok ('Installed: ' + (& node --version) + ' / npm ' + (& npm --version 2>$null))
        $nodeNeedInstall = $false
    } else {
        Write-Warn2 ('Node.js too old: ' + (& node --version) + ' (need >= 18)')
    }
} else {
    Write-Info 'node not found.'
}

if ($nodeNeedInstall) {
    if (-not (Test-Cmd 'winget')) {
        Stop-Script 'winget not available. Install the Node.js LTS installer from https://nodejs.org (keep "Add to PATH" checked), reopen PowerShell, then run this script again.'
    }
    Invoke-Checked 'winget' @('install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity') 'winget install Node.js LTS'
    Update-SessionPath
    if (-not (Test-Cmd 'node')) {
        Stop-Script 'node is still not on PATH. Close this window, open a new PowerShell, and run the script again.'
    }
    Write-Ok ('Installed: node ' + (& node --version))
}

if (-not (Test-Cmd 'npm')) {
    Stop-Script 'npm not found. Reinstall Node.js (it ships with npm) and try again.'
}

# ---------------------------------------------------------------------
# [4] wrangler
# ---------------------------------------------------------------------
Write-Head 'Check wrangler (Cloudflare Pages CLI)'
if (Test-Cmd 'wrangler') {
    $wrVer = ConvertTo-Version (& wrangler --version 2>$null)
    $wrMin = New-Object System.Version(3, 45, 0)
    if ($wrVer -and ($wrVer.CompareTo($wrMin) -ge 0)) {
        Write-Ok ('Installed and new enough: ' + (& wrangler --version))
    } else {
        Write-Warn2 ('wrangler too old: ' + (& wrangler --version) + ' -> upgrading')
        Invoke-Checked 'npm' @('install', '-g', 'wrangler@latest') 'npm upgrade wrangler'
        Update-SessionPath
    }
} else {
    Invoke-Checked 'npm' @('install', '-g', 'wrangler@latest') 'npm install wrangler'
    Update-SessionPath
    if (-not (Test-Cmd 'wrangler')) {
        Stop-Script 'wrangler is still not on PATH. Reopen PowerShell and run this script again, or run "npm install -g wrangler" manually to see the error.'
    }
    Write-Ok ('Installed: wrangler ' + (& wrangler --version))
}

# ---------------------------------------------------------------------
# [5] site folder skeleton
# ---------------------------------------------------------------------
Write-Head ('Create Hugo site skeleton in ' + $blogDir)
Set-Location -LiteralPath $blogDir

$configPath = Join-Path $blogDir 'config.toml'
if (Test-Path -LiteralPath $configPath) {
    Write-Skip 'config.toml already exists -> site already initialized (hugo new site is skipped)'
} else {
    $existing = @(Get-ChildItem -LiteralPath $blogDir -Force | Where-Object { ($_.Name -ne '.git') -and ($_.Name -ne 'themes') })
    if ($existing.Count -gt 0) {
        Write-Warn2 'Folder is not empty and has no config.toml; continuing anyway (no existing file is deleted).'
    }
    foreach ($d in @('archetypes', 'content', 'content\posts', 'static', 'static\images', 'themes', 'data', 'layouts')) {
        $p = Join-Path $blogDir $d
        if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
    }
    Write-Ok 'Created Hugo folder skeleton (archetypes / content / static / themes / layouts / data)'
}

# ---------------------------------------------------------------------
# [6] git repo + theme submodule
# ---------------------------------------------------------------------
Write-Head 'Initialize git repo and fetch the PaperMod theme'
if (Test-Path -LiteralPath (Join-Path $blogDir '.git')) {
    Write-Skip 'git repository already initialized'
} else {
    Invoke-Checked 'git' @('init') 'git init'
    Invoke-Checked 'git' @('branch', '-M', 'main') 'git set default branch to main'
}

$themeDir = Join-Path $blogDir 'themes\PaperMod'
$themeReady = (Test-Path -LiteralPath (Join-Path $themeDir 'layouts')) -or (Test-Path -LiteralPath (Join-Path $themeDir 'theme.toml'))
if ($themeReady) {
    Write-Skip 'themes\PaperMod already present and complete'
} else {
    $inSubmodules = $false
    $gitmodules = Join-Path $blogDir '.gitmodules'
    if (Test-Path -LiteralPath $gitmodules) {
        if (([System.IO.File]::ReadAllText($gitmodules, (New-Object System.Text.UTF8Encoding($false))) -match 'PaperMod')) { $inSubmodules = $true }
    }
    if ($inSubmodules) {
        Invoke-Checked 'git' @('submodule', 'update', '--init', '--recursive') 'fetch registered theme submodule'
    } else {
        Invoke-Checked 'git' @('submodule', 'add', 'https://github.com/adityatelange/hugo-PaperMod.git', 'themes/PaperMod') 'add PaperMod theme submodule'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $themeDir 'layouts'))) {
        Stop-Script 'Theme folder is still incomplete (GitHub may be unreachable). Manual fix: git submodule add https://github.com/adityatelange/hugo-PaperMod.git themes/PaperMod'
    }
    Write-Ok 'PaperMod theme ready'
}

# ---------------------------------------------------------------------
# [7] generate config / templates / sample posts (verbatim copy)
# ---------------------------------------------------------------------
Write-Head 'Generate config, templates and sample posts'

$today = Get-Date -Format 'yyyy-MM-dd'
$tplFiles = @(Get-ChildItem -LiteralPath $templateRoot -Recurse -File)
$writtenFiles = 0
$skippedFiles = 0

foreach ($tplFile in $tplFiles) {
    $rel = $tplFile.FullName.Substring($templateRoot.Length).TrimStart('\', '/')

    # ".tpl" is used only for files that need __PROJECT__ / __TODAY__ substitution
    # (a literal placeholder would be invalid TOML). The suffix is stripped on copy,
    # and substitution is attempted for every file.
    if ($rel.ToLower().EndsWith('.tpl')) { $rel = $rel.Substring(0, $rel.Length - 4) }

    switch -Regex ($rel) {
        '^wrangler\.toml$' { $destRel = 'wrangler.toml' }
        '^deploy\.ps1$'    { $destRel = 'deploy.ps1' }
        '^README\.md$'     { $destRel = 'README.md' }
        '^gitignore$'      { $destRel = '.gitignore' }
        '^gitattributes$'  { $destRel = '.gitattributes' }
        default            { $destRel = $rel }
    }

    $destPath = Join-Path $blogDir $destRel
    if ((Test-Path -LiteralPath $destPath) -and (-not $Force)) {
        Write-Skip ('exists, kept: ' + $destRel)
        $skippedFiles++
        continue
    }

    $destDir = Split-Path -Parent $destPath
    if ($destDir -and (-not (Test-Path -LiteralPath $destDir))) {
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    }

    # read as UTF-8 (no BOM), substitute placeholders, write back as UTF-8 (no BOM)
    $content = [System.IO.File]::ReadAllText($tplFile.FullName, (New-Object System.Text.UTF8Encoding($false)))
    if ($content.Contains('__PROJECT__')) { $content = $content.Replace('__PROJECT__', $ProjectName) }
    if ($content.Contains('__TODAY__'))   { $content = $content.Replace('__TODAY__', $today) }
    [System.IO.File]::WriteAllText($destPath, $content, (New-Object System.Text.UTF8Encoding($false)))

    Write-Ok ('wrote ' + $destRel)
    $writtenFiles++
}

foreach ($d in @('static\images')) {
    $p = Join-Path $blogDir $d
    if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

Write-Host ''
Write-Ok ("generated $writtenFiles file(s), kept $skippedFiles existing file(s)")

# ---------------------------------------------------------------------
# [8] first build
# ---------------------------------------------------------------------
Write-Head 'First build check (hugo --minify)'
Push-Location -LiteralPath $blogDir
try {
    & hugo --minify
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Err2 ("Hugo build failed (exit code $LASTEXITCODE).")
        Write-Host '  Common causes:' -ForegroundColor Yellow
        Write-Host '   1) themes\PaperMod incomplete -> git submodule update --init --recursive' -ForegroundColor Yellow
        Write-Host '   2) Hugo older than 0.128.0       -> upgrade Hugo' -ForegroundColor Yellow
        Stop-Script 'Fix the cause above and run this script again.'
    }
    $indexPath = Join-Path $blogDir 'public\index.html'
    if (-not (Test-Path -LiteralPath $indexPath)) {
        Stop-Script 'Build finished but public\index.html does not exist.'
    }
    $pageCount = @(Get-ChildItem -LiteralPath (Join-Path $blogDir 'public') -Recurse -File).Count
    Write-Ok ("Build OK: $pageCount files in public\")
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------
# [9] done
# ---------------------------------------------------------------------
Write-Head 'Bootstrap finished - one manual login is left'
Write-Host ''
Write-Host ' Done:' -ForegroundColor White
Write-Host ('   site folder        ' + $blogDir)
Write-Host ('   public URL (later) https://' + $ProjectName + '.pages.dev')
Write-Host '   toolchain, theme, config, sample posts, first build'
Write-Host ''
Write-Host ' +----------------------------------------------------------------+' -ForegroundColor Yellow
Write-Host ' |  Only two things are left for you:                            |' -ForegroundColor Yellow
Write-Host ' |                                                                |' -ForegroundColor Yellow
Write-Host ' |  1) Once, in this folder (browser opens, click Allow):         |' -ForegroundColor Yellow
Write-Host ' |                                                                |' -ForegroundColor Yellow
Write-Host ' |        wrangler login                                          |' -ForegroundColor White
Write-Host ' |                                                                |' -ForegroundColor Yellow
Write-Host ' |  2) After that, every new post: double-click                   |' -ForegroundColor Yellow
Write-Host ' |                                                                |' -ForegroundColor Yellow
Write-Host ' |        run-deploy.cmd                                          |' -ForegroundColor White
Write-Host ' |                                                                |' -ForegroundColor Yellow
Write-Host (' |     -> publishes to https://' + $ProjectName + '.pages.dev') -ForegroundColor Yellow
Write-Host ' +----------------------------------------------------------------+' -ForegroundColor Yellow
Write-Host ''
Write-Host ' Local preview : hugo server -D   ->  http://localhost:1313' -ForegroundColor Gray
Write-Host ' Change prefix : edit "name" in wrangler.toml, then deploy again' -ForegroundColor Gray
Write-Host ' Full guide    : README.md inside the blog folder' -ForegroundColor Gray
Write-Host ''
exit 0
