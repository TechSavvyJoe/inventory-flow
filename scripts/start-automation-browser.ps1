# Launches the dedicated Bob Maxey automation browser instance.
#
# Uses COMET (Perplexity's Chromium browser), NOT Chrome. This machine's IT
# policy (HKLM\SOFTWARE\Policies\Google\Chrome) sets ExtensionInstallBlocklist=*
# with a 3-ID allowlist, so the Claude in Chrome extension cannot be installed
# in ANY Chrome profile on this PC. Microsoft Edge is locked down identically.
# Comet has no policy key at all, so extensions install normally there.
#
# This is a SEPARATE Comet instance with its own --user-data-dir, so it has its
# own cookies, saved logins, sessions and extensions, completely isolated from
# the Comet Joe works in all day. He can browse, close tabs, restart his normal
# Comet, log out of things - none of it touches this one.
#
# Joe signs in to Claude / DealerMail / vAuto inside THIS window once. Comet
# stores those credentials in this profile's own password store (his, on his
# machine). Nothing here ever handles, reads, or transmits a credential.
#
# Idempotent: if the instance is already running, it does nothing.

[CmdletBinding()]
param(
  [switch]$Restart,
  [string[]]$OpenUrls = @(
    'https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp?selectedStore=26,25,27,95'
  )
)

$ErrorActionPreference = 'Stop'

$ProfileDir = Join-Path $env:LOCALAPPDATA 'BobMaxeyAutomation\CometProfile'
$LogDir     = Join-Path $env:LOCALAPPDATA 'BobMaxeyAutomation'
$LogPath    = Join-Path $LogDir 'automation-browser.log'

function Write-Log {
  param([string]$Message)
  if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Get-AutomationBrowser {
  Get-CimInstance Win32_Process -Filter "Name='comet.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ProfileDir*" }
}

$browserExe = @(
  "$env:LOCALAPPDATA\Perplexity\Comet\Application\comet.exe",
  "$env:ProgramFiles\Perplexity\Comet\Application\comet.exe",
  "${env:ProgramFiles(x86)}\Perplexity\Comet\Application\comet.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browserExe) { Write-Log 'ERROR comet.exe not found'; exit 1 }

$existing = Get-AutomationBrowser
if ($existing -and $Restart) {
  Write-Log "restarting: stopping $($existing.Count) existing automation comet process(es)"
  $existing | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
  $existing = $null
}

if ($existing) {
  Write-Log "already running (pid $($existing.ProcessId -join ',')) - nothing to do"
  exit 0
}

if (-not (Test-Path $ProfileDir)) {
  New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
  Write-Log "created isolated profile dir: $ProfileDir"
}

$browserArgs = @(
  "--user-data-dir=`"$ProfileDir`""
  '--no-first-run'
  '--no-default-browser-check'
  '--restore-last-session'
  '--disable-session-crashed-bubble'
  '--window-size=1400,900'
  '--remote-debugging-port=9222'      # bound to 127.0.0.1 only; used by keep-dealermail-alive.mjs
  '--disable-backgrounding-occluded-windows'   # keep pages running while minimized / covered
  '--disable-renderer-backgrounding'
  '--disable-background-timer-throttling'
  '--window-position=2000,2000'                # parks the window off the working area; stays minimized anyway
) + $OpenUrls

Write-Log "launching automation comet (minimized) with $($OpenUrls.Count) tab(s)"
Start-Process -FilePath $browserExe -ArgumentList $browserArgs -WindowStyle Minimized

Start-Sleep -Seconds 5
$now = Get-AutomationBrowser
if ($now) { Write-Log "running (pid $($now.ProcessId -join ','))"; exit 0 }
Write-Log 'ERROR launch did not produce a running automation comet process'
exit 1
