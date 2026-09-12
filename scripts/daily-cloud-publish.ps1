# Daily Inventory Flow photo sync + Cloudflare publish.
#
# Runs unattended under Windows Task Scheduler as JoeGallant on dt-4094, so the
# DPAPI (current-user scoped) secret bundle decrypts without a prompt and without
# an AI session in the loop. Deterministic: no classifier, no approval gate.
#
# Secret VALUES are never written to the log, stdout, or any file. Only key NAMES
# and structural counts are logged.

[CmdletBinding()]
param(
  [string]$ReportDate,
  [switch]$SkipPhotoCache,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$AppRoot       = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent (Split-Path -Parent $AppRoot)
$LogDir        = Join-Path $WorkspaceRoot 'work\app-feed-status'
$SecretPath    = Join-Path $AppRoot 'runtime\cloud-secrets\publisher.dpapi'

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogPath = Join-Path $LogDir ("auto-publish-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Level, $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Resolve-ReportDate {
  if ($ReportDate) { return $ReportDate }
  $snapshotDir = Join-Path $WorkspaceRoot 'work\inventory-history\snapshots'
  if (-not (Test-Path $snapshotDir)) { throw 'SNAPSHOT_DIR_MISSING' }
  $newest = Get-ChildItem -Path $snapshotDir -Filter '*-public.json' -File |
    Where-Object { $_.Name -match '^(\d{4}-\d{2}-\d{2})-public\.json$' } |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $newest) { throw 'NO_PUBLIC_SNAPSHOT' }
  return [regex]::Match($newest.Name, '^(\d{4}-\d{2}-\d{2})').Groups[1].Value
}

$exitCode = 0
$originalEnv = @{}
$secretNames = @()

try {
  Write-Log "=== daily-cloud-publish start (host=$env:COMPUTERNAME user=$env:USERNAME) ==="

  $date = Resolve-ReportDate
  Write-Log "report date: $date"

  # Idempotency guard: if this report date already published and verified, exit
  # clean without re-scraping VDPs. Lets the task retry hourly for cheap until
  # the day's snapshot is actually ready, without hammering the dealer sites.
  $receiptPath = Join-Path $LogDir ("{0}.json" -f $date)
  if (-not $Force -and (Test-Path $receiptPath)) {
    try {
      $receipt = Get-Content $receiptPath -Raw | ConvertFrom-Json
      if ($receipt.status -eq 'published_and_verified' -and $receipt.reportDate -eq $date) {
        Write-Log "already published and verified for $date - nothing to do (use -Force to republish)"
        Write-Log '=== daily-cloud-publish SKIPPED (already current) ==='
        exit 0
      }
    } catch {
      Write-Log "existing receipt unreadable, continuing with publish" 'WARN'
    }
  }

  if (-not (Test-Path $SecretPath)) { throw 'SECRET_STORE_MISSING' }

  # Decrypt the DPAPI bundle and stage each secret as a process env var.
  # Windows PowerShell 5.1: ConvertFrom-Json -AsHashtable is unavailable, so
  # enumerate PSObject properties instead.
  $raw     = Get-Content $SecretPath -Raw
  $plain   = [System.Net.NetworkCredential]::new('', (ConvertTo-SecureString $raw)).Password
  $secrets = $plain | ConvertFrom-Json
  $plain   = $null

  foreach ($property in $secrets.PSObject.Properties) {
    $secretNames += $property.Name
    $originalEnv[$property.Name] = [System.Environment]::GetEnvironmentVariable($property.Name)
    [System.Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value)
  }
  Write-Log ("secrets loaded: {0} ({1})" -f $secretNames.Count, ($secretNames -join ', '))

  Push-Location $AppRoot
  try {
    if (-not $SkipPhotoCache) {
      # Step 1 - vehicle resource cache (photos / AutoCheck / window stickers).
      # Prefer reusing resources already embedded in the hash-bound snapshot;
      # fall back to a fresh VDP extraction when that yields nothing.
      Write-Log 'photo cache: building (--reuse-snapshot-resources)'
      $cacheOut = & python 'scripts\build_photo_cache.py' '--report-date' $date '--reuse-snapshot-resources' 2>&1 | Out-String
      $reuseExit = $LASTEXITCODE
      $reuseEmpty = ($cacheOut -match '"vehicles_with_resources"\s*:\s*0')
      if ($reuseExit -ne 0) {
        # Runbook: never let a fresh extraction overwrite manually recovered
        # current-day resources. A non-zero exit means embedded resources may
        # exist but did not validate - that is operator territory, not a retry.
        Write-Log "photo cache: reuse path FAILED (exit $reuseExit) - refusing fresh-extraction fallback so nothing embedded is overwritten: $($cacheOut.Trim())" 'ERROR'
        throw 'PHOTO_CACHE_REUSE_FAILED'
      }
      if ($reuseEmpty) {
        # Clean run, zero embedded resources -> nothing to preserve, safe to extract fresh.
        Write-Log 'photo cache: snapshot has no embedded resources (clean zero) - falling back to fresh VDP extraction' 'WARN'
        $cacheOut = & python 'scripts\build_photo_cache.py' '--report-date' $date 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { Write-Log "photo cache FAILED: $($cacheOut.Trim())" 'ERROR'; throw 'PHOTO_CACHE_FAILED' }
      }
      Write-Log "photo cache: $($cacheOut.Trim())"
    } else {
      Write-Log 'photo cache: skipped by flag'
    }

    # Step 1.5 - per-VIN resource enrichment (window sticker / invoice / vAuto CAI label)
    # Rebuilds data\vin-document-enrichment.json from whatever the morning captured,
    # values copied as printed, then proves it against the REAL validators before
    # anything is published. A failure here stops the publish - never ships a bad file.
    Write-Log 'resources: building vin-document-enrichment.json'
    $enrichOut = & python '..\..\work\build_vin_document_enrichment.py' '--report-date' $date 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Log "resources: build FAILED: $($enrichOut.Trim())" 'ERROR'; throw 'RESOURCE_ENRICHMENT_BUILD_FAILED' }
    Write-Log "resources: $($enrichOut.Trim())"
    Write-Log 'resources: validating against release validators'
    $enrichCheck = & node 'scripts\dryrun_resource_enrichment_check.mjs' $date 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Log "resources: validation FAILED: $($enrichCheck.Trim())" 'ERROR'; throw 'RESOURCE_ENRICHMENT_INVALID' }
    Write-Log "resources: $($enrichCheck.Trim())"

    # Step 2 - build, validate, encrypt, publish, and independently re-verify
    # against /internal/status and /internal/readiness. Emits an uppercase error
    # CODE on failure, never raw detail.
    Write-Log 'cloud publish: running sync-cloud-release.mjs'
    $syncOut = & node 'scripts\sync-cloud-release.mjs' 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Log "cloud publish FAILED: $($syncOut.Trim())" 'ERROR'; throw 'CLOUD_PUBLISH_FAILED' }
    Write-Log "cloud publish: $($syncOut.Trim())"

    if ($syncOut -notmatch '"status"\s*:\s*"published_and_verified"') {
      Write-Log 'cloud publish did not report published_and_verified' 'ERROR'
      throw 'PUBLISH_NOT_VERIFIED'
    }
    Write-Log '=== daily-cloud-publish SUCCESS ==='
  } finally {
    Pop-Location
  }
} catch {
  $exitCode = 1
  Write-Log ("=== daily-cloud-publish FAILED: {0} ===" -f $_.Exception.Message) 'ERROR'
} finally {
  foreach ($key in $originalEnv.Keys) {
    [System.Environment]::SetEnvironmentVariable($key, $originalEnv[$key])
  }
  $originalEnv = @{}
  $secrets = $null
}

exit $exitCode
