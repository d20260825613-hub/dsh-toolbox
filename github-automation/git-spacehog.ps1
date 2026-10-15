# git-spacehog.ps1 — run git against the real GitHub from this machine.
#
# Every piece of this invocation was needed, and each one was a failure before
# it was added:
#
#   * http.proxy          the Windows hosts file points every github.com name at
#                         127.0.0.1, and this machine has no direct external
#                         egress. Clash on 127.0.0.1:7897 is the only way out,
#                         and an HTTP proxy resolves the host itself, so the
#                         hosts-file entry is never consulted.
#   * http.sslBackend     openssl. The default schannel backend cannot complete
#                         the handshake through the proxy ("schannel: failed to
#                         receive handshake").
#   * http.version        HTTP/1.1. Roughly half of github.com's tunnel TLS
#                         handshakes are reset through this proxy, so a single
#                         attempt is a coin flip; retries are mandatory.
#   * credential.helper   a file-backed helper. The token in the gh keyring was
#                         revoked, and passing a token on the command line would
#                         expose it to any process that can read argv.
#
# Usage (run from the repository you want to operate on):
#   cd D:\dsh\spacehog
#   & D:\dsh\_tools\git-spacehog.ps1 push origin main
#   & D:\dsh\_tools\git-spacehog.ps1 ls-remote origin refs/heads/main
#
# GIT_RETRIES overrides the number of attempts (default 8).
#
# Note: arguments are forwarded to git verbatim, so this script cannot also take
# a -Repo option — see the parameter comment below for why.

param(
  # ValueFromRemainingArguments starts binding at position 0, so every word after
  # the script name lands here. That is what makes verbatim forwarding work — and
  # it means there can be no second parameter: PowerShell would bind the first
  # forwarded word ("push") to it as well as to this array. The repository is
  # therefore the current directory, so cd into it first.
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest = @()
)

if ($Rest.Count -eq 0) {
  Write-Error 'usage: git-spacehog.ps1 <git arguments...>   e.g. git-spacehog.ps1 push origin main'
  exit 2
}

$Repo = (Get-Location).Path

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
  if ($i -lt $attempts) {
    Write-Host "attempt $i failed (exit $code), retrying..." -ForegroundColor DarkYellow
    Start-Sleep -Seconds 2
  } else {
    $output | ForEach-Object { $_ }
    Write-Error "git $($Rest -join ' ') failed after $attempts attempts"
    exit $code
  }
}
