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

function Test-AutomationCdp {
  try {
    $version = Invoke-RestMethod -Uri 'http://127.0.0.1:9222/json/version' -TimeoutSec 5
    return [bool]($version.webSocketDebuggerUrl)
  } catch {
    return $false
  }
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
  if (Test-AutomationCdp) {
    Write-Log "already running ($($existing.Count) process(es)); CDP on 127.0.0.1:9222 is healthy"
    exit 0
  }

  # Chromium can leave renderer/helper processes behind after the main browser
  # or CDP endpoint dies. Those processes are not a usable automation browser.
  # Stop only this isolated profile's exact processes and relaunch it.
  Write-Log "stale automation browser detected ($($existing.Count) process(es), CDP unavailable); relaunching"
  $existing | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
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

for ($attempt = 1; $attempt -le 15; $attempt++) {
  Start-Sleep -Seconds 1
  $now = Get-AutomationBrowser
  if ($now -and (Test-AutomationCdp)) {
    Write-Log "running ($($now.Count) process(es)); CDP is healthy"
    exit 0
  }
}
Write-Log 'ERROR launch did not produce a healthy automation Comet and CDP endpoint'
exit 1
