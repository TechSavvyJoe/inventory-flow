# Launches the dedicated Bob Maxey automation Chrome instance.
#
# This is a SEPARATE Chrome instance with its own --user-data-dir, so it has its
# own cookies, saved logins, sessions and extensions, completely isolated from
# the Chrome Joe works in all day. He can browse, close tabs, restart his normal
# Chrome, log out of things - none of it touches this one.
#
# Joe signs in to DealerMail / vAuto inside THIS window once. Chrome stores those
# credentials in this profile's own password store (his, on his machine). Nothing
# here ever handles, reads, or transmits a credential.
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

$ProfileDir = Join-Path $env:LOCALAPPDATA 'BobMaxeyAutomation\ChromeProfile'
$LogDir     = Join-Path $env:LOCALAPPDATA 'BobMaxeyAutomation'
$LogPath    = Join-Path $LogDir 'automation-browser.log'

function Write-Log {
  param([string]$Message)
  if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Get-AutomationChrome {
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ProfileDir*" }
}

$chromeExe = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chromeExe) { Write-Log 'ERROR chrome.exe not found'; exit 1 }

$existing = Get-AutomationChrome
if ($existing -and $Restart) {
  Write-Log "restarting: stopping $($existing.Count) existing automation chrome process(es)"
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

$chromeArgs = @(
  "--user-data-dir=`"$ProfileDir`""
  '--no-first-run'
  '--no-default-browser-check'
  '--restore-last-session'
  '--disable-session-crashed-bubble'
  '--window-size=1400,900'
) + $OpenUrls

Write-Log "launching automation chrome (minimized) with $($OpenUrls.Count) tab(s)"
Start-Process -FilePath $chromeExe -ArgumentList $chromeArgs -WindowStyle Minimized

Start-Sleep -Seconds 4
$now = Get-AutomationChrome
if ($now) { Write-Log "running (pid $($now.ProcessId -join ','))"; exit 0 }
Write-Log 'ERROR launch did not produce a running automation chrome process'
exit 1
