# gitnet.ps1 — run any git command against GitHub from this machine.
#
# Supersedes git-spacehog.ps1: the repository is a parameter instead of being
# hardcoded to spacehog, so the same script serves every project in D:\dsh.
#
# Every piece below was required, and each was a separate failure:
#
#   http.proxy          The Windows hosts file points every github.com name at
#                       127.0.0.1 and this machine has no direct external egress
#                       (1.1.1.1:443 times out too). Clash on 127.0.0.1:7897 is
#                       the only way out, and an HTTP proxy resolves the target
#                       host itself, so the hosts-file entry never applies.
#   sslBackend=openssl  schannel cannot complete the handshake through the proxy.
#   http.version=1.1    Roughly half of github.com's tunnel TLS handshakes are
#                       reset, so retries are mandatory and HTTP/2 makes the
#                       failures burstier.
#   credential.helper   A file-backed helper; the gh keyring token was revoked.
#                       The empty `credential.helper=` first is not redundant:
#                       helpers are a list, and clearing it prevents the global
#                       `gh auth git-credential` (dead token -> 401) from being
#                       consulted first.
#
# Usage:
#   & D:\dsh\_tools\gitnet.ps1 -Repo D:\dsh\d20260825613-hub.github.io push -u origin main
#   & D:\dsh\_tools\gitnet.ps1 -Repo D:\dsh\netpeek status --short
#
# Defaults to the current directory when -Repo is omitted. GIT_RETRIES overrides
# the attempt count (default 8).

param(
  [string]$Repo = '',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest = @()
)

if (-not $Repo) { $Repo = (Get-Location).Path }
if (-not (Test-Path $Repo)) {
  Write-Error "not a directory: $Repo"
  exit 2
}
if ($Rest.Count -eq 0) {
  Write-Error 'usage: gitnet.ps1 [-Repo <dir>] <git arguments...>   e.g. gitnet.ps1 -Repo D:\dsh\netpeek push -u origin main'
  exit 2
}

$ErrorActionPreference = 'Continue'
$git = 'D:\dsh\_tools\git\cmd\git.exe'
$helper = '!node D:/dsh/_tools/git-token-helper.js'
$attempts = if ($env:GIT_RETRIES) { [int]$env:GIT_RETRIES } else { 8 }

$common = @(
  '-c', 'http.proxy=http://127.0.0.1:7897',
  '-c', 'http.sslBackend=openssl',
  '-c', 'http.version=HTTP/1.1',
  '-c', 'credential.helper=',
  '-c', "credential.helper=$helper"
)

if (-not (Test-Path 'D:\dsh\_tools\gh-token.txt')) {
  Write-Error 'no token at D:\dsh\_tools\gh-token.txt — run gh-device-code.js then gh-device-poll.js'
  exit 1
}

for ($i = 1; $i -le $attempts; $i++) {
  $output = & $git -C $Repo @common @Rest 2>&1
  $code = $LASTEXITCODE
  if ($code -eq 0) {
    $output | ForEach-Object { $_ }
    exit 0
  }
  # stderr noise is normal for git; only a non-zero exit means failure
  if ($i -lt $attempts) {
    Write-Host "attempt $i failed (exit $code), retrying..." -ForegroundColor DarkYellow
    Start-Sleep -Seconds 2
  } else {
    $output | ForEach-Object { $_ }
    Write-Error "git $($Rest -join ' ') failed after $attempts attempts"
    exit $code
  }
}
