# Daily Inventory Flow photo sync + Cloudflare publish.
#
# Runs unattended under Windows Task Scheduler as the automation account on the
# automation PC, so the DPAPI (current-user scoped) secret bundle decrypts
# without a prompt and without an AI session in the loop. Deterministic: no
# classifier, no approval gate.
#
# Secret VALUES are never written to the log, stdout, or any file. Only key NAMES
# and structural counts are logged.

[CmdletBinding()]
param(
  [string]$ReportDate,
  [switch]$SkipPhotoCache,
  [switch]$HoldRefresh,
  [switch]$ReconcilePending,
  [switch]$Force,
  [string]$WorkspaceRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$AppRoot       = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $WorkspaceRoot = $env:BOB_MAXEY_WORKSPACE_ROOT
}
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $WorkspaceRoot = Split-Path -Parent (Split-Path -Parent $AppRoot)
}
$WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
foreach ($requiredPath in @('work\run-status', 'outputs', 'apps\inventory-ops')) {
  if (-not (Test-Path -LiteralPath (Join-Path $WorkspaceRoot $requiredPath))) {
    throw "WORKSPACE_ROOT_INVALID: missing $requiredPath under $WorkspaceRoot"
  }
}
# Child Node helpers inherit this so Windows junction resolution cannot redirect
# their snapshots and status files into the physical repository parent.
$env:BOB_MAXEY_WORKSPACE_ROOT = $WorkspaceRoot
$env:INVENTORY_WORKSPACE_ROOT = $WorkspaceRoot
$BundledDependencies = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$NodeExecutable = Join-Path $BundledDependencies 'node\bin\node.exe'
$PythonExecutable = Join-Path $BundledDependencies 'python\python.exe'
if (-not (Test-Path -LiteralPath $NodeExecutable)) {
  $NodeExecutable = (Get-Command node -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $PythonExecutable)) {
  $PythonExecutable = (Get-Command python -ErrorAction Stop).Source
}
$LogDir        = Join-Path $WorkspaceRoot 'work\app-feed-status'
$PublicationLockPath = Join-Path $LogDir '.publication.lock'
$PublicationReconciliationPath = Join-Path $LogDir 'publication-reconciliation.json'
$PublicationLockOwnerEnvironment = 'INVENTORY_OPS_PUBLICATION_LOCK_OWNER_ID'
$SecretPath    = Join-Path $AppRoot 'runtime\cloud-secrets\publisher.dpapi'
$IntegrationExpectedPath = Join-Path $AppRoot 'runtime\integration-expected-release.json'
$IntegrationCredentialPath = Join-Path $AppRoot 'runtime\integration-credentials\joe-app-development.json'

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogPath = Join-Path $LogDir ("auto-publish-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Level, $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Enter-PublicationPipelineLock {
  $previousOwner = [System.Environment]::GetEnvironmentVariable($PublicationLockOwnerEnvironment)
  if (-not [string]::IsNullOrWhiteSpace($previousOwner)) {
    if (-not (Test-Path -LiteralPath $PublicationLockPath -PathType Leaf)) {
      throw 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
    }
    $item = Get-Item -LiteralPath $PublicationLockPath -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
    }
    try { $recorded = Get-Content -LiteralPath $PublicationLockPath -Raw | ConvertFrom-Json }
    catch { throw 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW' }
    if ([string]$recorded.ownerId -cne $previousOwner) {
      throw 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
    }
    return [pscustomobject]@{ Owns = $false; Content = $null; PreviousOwner = $previousOwner }
  }

  $ownerId = [Guid]::NewGuid().ToString()
  $content = [ordered]@{
    pid = $PID
    startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    ownerId = $ownerId
  } | ConvertTo-Json -Compress
  try {
    $stream = [System.IO.File]::Open(
      $PublicationLockPath,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::Read
    )
    try {
      $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($content)
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush($true)
    } finally {
      $stream.Dispose()
    }
  } catch [System.IO.IOException] {
    throw 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
  }
  [System.Environment]::SetEnvironmentVariable($PublicationLockOwnerEnvironment, $ownerId)
  return [pscustomobject]@{ Owns = $true; Content = $content; PreviousOwner = $null }
}

function Exit-PublicationPipelineLock {
  param($Lock)
  if (-not $Lock) { return }
  try {
    if ($Lock.Owns) {
      if (-not (Test-Path -LiteralPath $PublicationLockPath -PathType Leaf)) {
        throw 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
      }
      $item = Get-Item -LiteralPath $PublicationLockPath -Force
      $current = Get-Content -LiteralPath $PublicationLockPath -Raw
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or $current -cne $Lock.Content) {
        throw 'PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW'
      }
      Remove-Item -LiteralPath $PublicationLockPath -Force
    }
  } finally {
    if ($null -eq $Lock.PreviousOwner) {
      Remove-Item -LiteralPath "Env:$PublicationLockOwnerEnvironment" -ErrorAction SilentlyContinue
    } else {
      [System.Environment]::SetEnvironmentVariable($PublicationLockOwnerEnvironment, [string]$Lock.PreviousOwner)
    }
  }
}

# Windows PowerShell 5.1 can promote a native program's stderr stream to a
# terminating NativeCommandError while $ErrorActionPreference is Stop. That
# used to cut the useful traceback out of the log. Run native helpers with a
# local Continue policy, preserve their complete combined output, and let each
# call site decide whether its exit code is fatal.
function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $FilePath @Arguments 2>&1 | Out-String
    $nativeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  [pscustomobject]@{
    Output   = [string]$output
    ExitCode = [int]$nativeExitCode
  }
}

function Get-PendingPublicationReconciliation {
  if (-not (Test-Path -LiteralPath $PublicationReconciliationPath)) { return $null }
  try {
    $item = Get-Item -LiteralPath $PublicationReconciliationPath -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'invalid marker type'
    }
    $state = Get-Content -LiteralPath $PublicationReconciliationPath -Raw | ConvertFrom-Json
    $parsedRecordedAt = [DateTimeOffset]::MinValue
    $recordedAtValid = [DateTimeOffset]::TryParse([string]$state.recordedAt, [ref]$parsedRecordedAt)
    $expectedStateFields = @('candidate', 'failureCode', 'reconciliationRequired', 'recordedAt', 'reportDate', 'schemaVersion', 'status')
    $actualStateFields = @($state.PSObject.Properties.Name | Sort-Object)
    if ((Compare-Object $expectedStateFields $actualStateFields) -or
        $state.schemaVersion -ne 1 -or
        $state.status -cne 'publication_reconciliation_required' -or
        $state.reconciliationRequired -ne $true -or
        [string]$state.reportDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or
        -not $recordedAtValid -or
        [string]$state.failureCode -notin @('CLOUD_PUBLICATION_ATTEMPT_IN_PROGRESS', 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN', 'CLOUD_PUBLICATION_VERIFIED_RECEIPT_NOT_RECORDED')) {
      throw 'invalid marker schema'
    }
    $expectedCandidateFields = @('bundleSha256', 'holdRefresh', 'sourceHashes')
    $actualCandidateFields = @($state.candidate.PSObject.Properties.Name | Sort-Object)
    if ((Compare-Object $expectedCandidateFields $actualCandidateFields) -or
        [string]$state.candidate.bundleSha256 -notmatch '^[a-fA-F0-9]{64}$' -or
        $state.candidate.holdRefresh -isnot [bool]) {
      throw 'invalid candidate schema'
    }
    $sourceFields = @($state.candidate.sourceHashes.PSObject.Properties.Name | Sort-Object)
    $expectedSourceFields = @('dealerMail', 'managerDisposition', 'managerDispositionBinding', 'public', 'resources')
    if (Compare-Object $expectedSourceFields $sourceFields) { throw 'invalid source-hash schema' }
    foreach ($required in @('public', 'dealerMail', 'resources')) {
      if ([string]$state.candidate.sourceHashes.$required -notmatch '^[a-fA-F0-9]{64}$') { throw 'invalid required source hash' }
    }
    foreach ($optional in @('managerDisposition', 'managerDispositionBinding')) {
      $value = $state.candidate.sourceHashes.$optional
      if ($null -ne $value -and [string]$value -notmatch '^[a-fA-F0-9]{64}$') { throw 'invalid optional source hash' }
    }
    return $state
  } catch {
    throw 'PUBLICATION_RECONCILIATION_STATE_INVALID'
  }
}

# After guarded recovery proves the retained candidate live, the same day's
# hold-refresh status must stop reporting reconciliation-required, or every
# later intraday slot and the monitor stay blocked on a resolved candidate.
# Only a status that names this exact candidate is rewritten; its candidate
# hash is kept for the record.
function Clear-ReconciledHoldRefreshStatus {
  param(
    [Parameter(Mandatory)]$Receipt,
    [Parameter(Mandatory)][string]$Date
  )
  $statusPath = Join-Path $WorkspaceRoot ("work\hold-refresh-status\{0}.json" -f $Date)
  if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) { return }
  try { $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json }
  catch {
    Write-Log 'hold-refresh status: unreadable after reconciliation; left for operator review' 'WARN'
    return
  }
  # Set-StrictMode rejects reads of absent properties; read only named fields.
  $names = @($status.PSObject.Properties.Name)
  $field = { param($Name) if ($names -contains $Name) { $status.$Name } else { $null } }
  $requiresReconciliation = (& $field 'reconciliationRequired') -eq $true -or
    [string](& $field 'status') -ceq 'intraday_holds_publication_outcome_unknown'
  if (-not $requiresReconciliation) { return }
  $receiptHash = ([string]$Receipt.bundleSha256).ToLowerInvariant()
  $receiptDealerMail = ''
  if (@($Receipt.PSObject.Properties.Name) -contains 'sourceHashes' -and $null -ne $Receipt.sourceHashes -and
      @($Receipt.sourceHashes.PSObject.Properties.Name) -contains 'dealerMail') {
    $receiptDealerMail = [string]$Receipt.sourceHashes.dealerMail
  }
  # PowerShell 7 ConvertFrom-Json turns ISO strings into DateTime; keep ISO.
  $receiptVerifiedAt = $Receipt.verifiedAt
  if ($receiptVerifiedAt -is [DateTime]) { $receiptVerifiedAt = $receiptVerifiedAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture) }
  else { $receiptVerifiedAt = [string]$receiptVerifiedAt }
  $statusCandidate = & $field 'candidate'
  $statusHash = ''
  if ($null -ne $statusCandidate -and @($statusCandidate.PSObject.Properties.Name) -contains 'bundleSha256') {
    $statusHash = ([string]$statusCandidate.bundleSha256).ToLowerInvariant()
  }
  if ([string](& $field 'reportDate') -cne $Date -or $statusHash -cne $receiptHash) {
    Write-Log 'hold-refresh status: names a different candidate than the reconciled receipt; left unchanged' 'WARN'
    return
  }
  $cleared = [ordered]@{
    reportDate = $Date
    status = 'intraday_holds_reconciled'
    checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
    summary = ("Inventory Flow {0}: candidate SHA-256 {1} was proved live by guarded reconciliation; the hold refresh may resume." -f $Date, $receiptHash)
    published = $true
    reconciliationRequired = $false
    receipt = [ordered]@{
      bundleSha256 = $receiptHash
      verifiedAt = $receiptVerifiedAt
      dealerMailSha256 = $receiptDealerMail
    }
    candidate = $statusCandidate
    warnings = @()
    steps = @()
  }
  $temporary = "$statusPath.tmp"
  $json = $cleared | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $statusPath -Force
  Write-Log 'hold-refresh status: recorded reconciled candidate; same-day hold refresh unblocked'
}

function Update-IntegrationExpectedMetadata {
  param(
    [Parameter(Mandatory = $true)]$Receipt,
    [Parameter(Mandatory = $true)][string]$Date
  )

  if ($Receipt.status -ne 'published_and_verified' -or
      $Receipt.bundleSha256 -notmatch '^[a-fA-F0-9]{64}$' -or
      -not $Receipt.counts) {
    throw 'VERIFIED_RECEIPT_METADATA_INVALID'
  }

  # The external integration projection is public-only, after manager-delivered
  # listed vehicles are hidden from the API. The app's active inventory can also
  # include DealerMail-only pre-listing vehicles, so do not use active counts.
  $sourceCounts = [ordered]@{}
  foreach ($store in @('Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln')) {
    $sourceCounts[$store] = [int64]$Receipt.counts.publicStoreCounts.$store
  }
  $sourceTotal = [int64]$Receipt.counts.publicRowCount
  $releasePath = Join-Path $WorkspaceRoot ("work\releases\{0}\inventory-flow-release.json" -f $Date)
  if (Test-Path -LiteralPath $releasePath) {
    $releaseEnvelope = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
    $publicStoresByVin = @{}
    foreach ($vehicle in @($releaseEnvelope.release.vehicles)) {
      if ($null -eq $vehicle.publicRecord) { continue }
      $vin = ([string]$vehicle.publicRecord.vin).Trim().ToUpperInvariant()
      $store = [string]$vehicle.publicRecord.store
      if ($vin -match '^[A-HJ-NPR-Z0-9]{17}$' -and $sourceCounts.Contains($store)) {
        $publicStoresByVin[$vin] = $store
      }
    }
    $excludedVins = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($record in @($releaseEnvelope.release.managerDispositionOverlay.records)) {
      $vin = ([string]$record.vin).Trim().ToUpperInvariant()
      $conflicting = @('matched_vin_stock_review', 'stock_ambiguous') -contains [string]$record.matchStatus
      $qualifies = $record.deliveredManagerLog -eq $true -and
        [string]$record.matchMethod -eq 'vin' -and
        $vin -match '^[A-HJ-NPR-Z0-9]{17}$' -and
        -not $conflicting -and
        $publicStoresByVin.ContainsKey($vin)
      if ($qualifies -and $excludedVins.Add($vin)) {
        $store = $publicStoresByVin[$vin]
        $sourceCounts[$store] = [int64]$sourceCounts[$store] - 1
        $sourceTotal -= 1
      }
    }
  }
  if (-not $sourceCounts) { throw 'VERIFIED_RECEIPT_METADATA_INVALID' }

  $stores = [ordered]@{}
  foreach ($store in @('Howell', 'Fowlerville', 'Ford Detroit', 'Lincoln')) {
    $value = $sourceCounts.$store
    if ($null -eq $value -or [int64]$value -lt 0) { throw 'VERIFIED_RECEIPT_STORE_COUNTS_INVALID' }
    $stores[$store] = [int64]$value
  }
  $total = [int64]$sourceTotal
  if (($stores.Values | Measure-Object -Sum).Sum -ne $total -or $total -le 0) {
    throw 'VERIFIED_RECEIPT_STORE_COUNTS_INVALID'
  }

  $metadata = [ordered]@{
    bundleSha256 = ([string]$Receipt.bundleSha256).ToLowerInvariant()
    total = $total
    byStore = $stores
  }
  $parent = Split-Path -Parent $IntegrationExpectedPath
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $temporary = "$IntegrationExpectedPath.tmp"
  # Windows PowerShell 5.1's -Encoding UTF8 adds a BOM. JSON.parse() in the
  # Node verifier is intentionally strict, so write explicit BOM-free UTF-8.
  $json = $metadata | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $IntegrationExpectedPath -Force
}

function Assert-IntegrationDeployment {
  if (-not (Test-Path $IntegrationCredentialPath)) { throw 'INTEGRATION_CREDENTIAL_MISSING' }
  $verification = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @(
    'scripts\verify-integration-deployment.mjs',
    'runtime\integration-credentials\joe-app-development.json',
    '--expected',
    'runtime\integration-expected-release.json'
  )
  if ($verification.ExitCode -ne 0 -or $verification.Output -notmatch '"verified"\s*:\s*true') {
    Write-Log "integration verification FAILED: $($verification.Output.Trim())" 'ERROR'
    throw 'INTEGRATION_VERIFICATION_FAILED'
  }
  Write-Log "integration verification: $($verification.Output.Trim())"
}

function Resolve-ReportDate {
  if ($ReportDate) { return $ReportDate }
  $eastern = [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
  $today = [System.TimeZoneInfo]::ConvertTime([System.DateTimeOffset]::UtcNow, $eastern).ToString('yyyy-MM-dd')
  $snapshot = Join-Path $WorkspaceRoot ("work\inventory-history\snapshots\{0}-public.json" -f $today)
  if (-not (Test-Path -LiteralPath $snapshot)) { throw 'NO_CURRENT_DAY_PUBLIC_SNAPSHOT' }
  return $today
}

function Test-ReceiptMatchesManagerOverlay {
  param(
    [Parameter(Mandatory)]$Receipt,
    [Parameter(Mandatory)][string]$Date
  )

  $manifestPath = Join-Path $WorkspaceRoot ("work\run-status\{0}.json" -f $Date)
  if (-not (Test-Path $manifestPath)) { return $true }

  try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  } catch {
    Write-Log "manager overlay freshness check skipped because the dated manifest is unreadable" 'WARN'
    return $true
  }

  $binding = $manifest.manager_disposition_overlay
  $expected = if ($binding -and $binding.status -eq 'complete') { [string]$binding.sha256 } else { '' }
  # The manifest checksum is the raw operational input. The managerDisposition
  # receipt hash is the sanitized overlay and must not be compared to it.
  $published = if ($Receipt.sourceHashes) { [string]$Receipt.sourceHashes.managerDispositionBinding } else { '' }
  # A missing optional binding is not authority to erase an overlay that was
  # already published. Only a complete, hash-bound current manifest may trigger
  # an automatic manager-overlay republish.
  if ([string]::IsNullOrWhiteSpace($expected)) { return $true }
  return $expected.Equals($published, [System.StringComparison]::OrdinalIgnoreCase)
}

function Complete-VerifiedPublicationState {
  param(
    [Parameter(Mandatory)]$Receipt,
    [Parameter(Mandatory)][string]$Date
  )

  $pointerRun = Invoke-NativeCapture -FilePath $PythonExecutable -Arguments @(
    (Join-Path $WorkspaceRoot 'work\advance_latest_pointer.py'),
    '--report-date',
    $Date
  )
  if ($pointerRun.ExitCode -ne 0) {
    Write-Log "latest pointers: FAILED: $($pointerRun.Output.Trim())" 'ERROR'
    throw 'LATEST_POINTER_ADVANCE_FAILED'
  }
  Write-Log "latest pointers: $($pointerRun.Output.Trim())"

  $manifestPath = Join-Path $WorkspaceRoot ("work\run-status\{0}.json" -f $Date)
  if (-not (Test-Path $manifestPath)) { throw 'RUN_MANIFEST_MISSING_AFTER_PUBLISH' }
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.complete -ne $true -or $manifest.report_date -ne $Date) {
    throw 'RUN_MANIFEST_NOT_COMPLETE_AFTER_PUBLISH'
  }

  if ($manifest.PSObject.Properties.Name -contains 'latest_pointers_advanced') {
    $manifest.latest_pointers_advanced = $true
  } else {
    $manifest | Add-Member -NotePropertyName latest_pointers_advanced -NotePropertyValue $true
  }
  $cloudflarePublish = [ordered]@{
    attempted = $true
    status = 'published_and_verified'
    receipt_path = (Join-Path $LogDir ("{0}.json" -f $Date))
    bundle_sha256 = [string]$Receipt.bundleSha256
    verified_at = [string]$Receipt.verifiedAt
    publisher = 'BobMaxey-InventoryFlow-DailyPublish'
  }
  if ($manifest.PSObject.Properties.Name -contains 'cloudflare_publish') {
    $manifest.cloudflare_publish = $cloudflarePublish
  } else {
    $manifest | Add-Member -NotePropertyName cloudflare_publish -NotePropertyValue $cloudflarePublish
  }
  $temporary = "$manifestPath.tmp"
  $json = $manifest | ConvertTo-Json -Depth 32
  [System.IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $manifestPath -Force
  Write-Log 'run manifest: recorded verified cloud publication and advanced latest pointers'
}

function Complete-PublicationFollowups {
  param(
    [Parameter(Mandatory)]$Receipt,
    [Parameter(Mandatory)][string]$Date,
    [switch]$ReuseDocuments
  )

  # The inventory receipt is written before document uploads. Retry these
  # idempotent uploads even when the inventory release is already verified.
  if (-not $ReuseDocuments) {
    Write-Log 'invoice documents: publishing private saved copies'
    $invoicePublishRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\publish-invoice-documents.mjs', $Date)
    if ($invoicePublishRun.ExitCode -ne 0) { Write-Log "invoice documents FAILED: $($invoicePublishRun.Output.Trim())" 'ERROR'; throw 'INVOICE_DOCUMENT_PUBLISH_FAILED' }
    Write-Log "invoice documents: $($invoicePublishRun.Output.Trim())"
  } else {
    Write-Log 'invoice documents: reused for hold-only refresh'
  }
  Update-IntegrationExpectedMetadata -Receipt $Receipt -Date $Date
  Assert-IntegrationDeployment
  Complete-VerifiedPublicationState -Receipt $Receipt -Date $Date
  # Preserve report-ready evidence only after the publication follow-ups pass.
  $archiveRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\archive-inventory-history.mjs', $Date, '--workspace-root', $WorkspaceRoot)
  if ($archiveRun.ExitCode -ne 0) { Write-Log "historical archive FAILED: $($archiveRun.Output.Trim())" 'ERROR'; throw 'HISTORICAL_ARCHIVE_FAILED' }
  Write-Log "historical archive: $($archiveRun.Output.Trim())"
}

$exitCode = 0
$originalEnv = @{}
$secretNames = @()
$pipelineLock = $null
$verifiedPublicationAvailable = $false

try {
  $pipelineLock = Enter-PublicationPipelineLock
  Write-Log "=== daily-cloud-publish start (host=$env:COMPUTERNAME user=$env:USERNAME) ==="

  # sync-cloud-release.mjs installs this cross-date exact-candidate marker
  # before its first POST network call. Check it before loading secrets,
  # rebuilding enrichment, or honoring -Force so no scheduled lane can create
  # a second candidate while the first attempt still needs reconciliation.
  $pendingReconciliation = Get-PendingPublicationReconciliation
  if ($pendingReconciliation -and -not $ReconcilePending) {
    throw ("PUBLICATION_RECONCILIATION_REQUIRED candidate_bundle_sha256={0}" -f ([string]$pendingReconciliation.candidate.bundleSha256).ToLowerInvariant())
  }
  if ($ReconcilePending -and -not $pendingReconciliation) {
    throw 'PUBLICATION_RECONCILIATION_NOT_FOUND'
  }

  $date = if ($ReconcilePending) { [string]$pendingReconciliation.reportDate } else { Resolve-ReportDate }
  Write-Log "report date: $date"

  if ($HoldRefresh -and [string]::IsNullOrWhiteSpace($env:INVENTORY_OPS_EXPECTED_SOURCE_HASHES_JSON)) {
    throw 'HOLD_REFRESH_SOURCE_BINDINGS_REQUIRED'
  }

  if (-not (Test-Path $SecretPath)) { throw 'SECRET_STORE_MISSING' }

  # Both new publications and document retries need the DPAPI credentials.
  # Keep staging inside the same try/finally so every exit restores the caller.
  # Windows PowerShell 5.1 lacks ConvertFrom-Json -AsHashtable.
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

  if ($ReconcilePending) {
    Push-Location $AppRoot
    try {
      Write-Log ("publication reconciliation: verifying exact retained candidate {0}" -f ([string]$pendingReconciliation.candidate.bundleSha256).ToLowerInvariant())
      $reconcileRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\sync-cloud-release.mjs', '--reconcile-pending')
      if ($reconcileRun.ExitCode -ne 0 -or $reconcileRun.Output -notmatch '"publication"\s*:\s*"(reconciled|reposted)_exact_candidate"') {
        Write-Log "publication reconciliation FAILED: $($reconcileRun.Output.Trim())" 'ERROR'
        throw 'PUBLICATION_RECONCILIATION_NOT_VERIFIED'
      }
      $receiptPath = Join-Path $LogDir ("{0}.json" -f ([string]$pendingReconciliation.reportDate))
      $verifiedReceipt = Get-Content $receiptPath -Raw | ConvertFrom-Json
      if ([string]$verifiedReceipt.bundleSha256 -cne ([string]$pendingReconciliation.candidate.bundleSha256).ToLowerInvariant()) {
        throw 'PUBLICATION_RECONCILIATION_RECEIPT_MISMATCH'
      }
      $verifiedPublicationAvailable = $true
      Clear-ReconciledHoldRefreshStatus -Receipt $verifiedReceipt -Date ([string]$pendingReconciliation.reportDate)
      Complete-PublicationFollowups -Receipt $verifiedReceipt -Date ([string]$pendingReconciliation.reportDate) -ReuseDocuments:([bool]$pendingReconciliation.candidate.holdRefresh)
      Write-Log '=== daily-cloud-publish RECONCILED EXACT CANDIDATE ==='
      exit 0
    } finally { Pop-Location }
  }

  # A verified inventory release still needs its document and completion
  # follow-ups. Reuse the receipt without re-scraping or republishing sources.
  $receiptPath = Join-Path $LogDir ("{0}.json" -f $date)
  if (-not $Force -and (Test-Path $receiptPath)) {
    $receipt = $null
    try {
      $receipt = Get-Content $receiptPath -Raw | ConvertFrom-Json
    } catch {
      Write-Log "existing receipt unreadable, continuing with publish" 'WARN'
    }
    if ($receipt -and $receipt.status -eq 'published_and_verified' -and $receipt.reportDate -eq $date) {
      if (Test-ReceiptMatchesManagerOverlay -Receipt $receipt -Date $date) {
        $verifiedPublicationAvailable = $true
        Push-Location $AppRoot
        try {
          Complete-PublicationFollowups -Receipt $receipt -Date $date
        } finally { Pop-Location }
        Write-Log "already published and verified for $date; document and completion follow-ups verified (use -Force to republish)"
        Write-Log '=== daily-cloud-publish SKIPPED (already current) ==='
        exit 0
      }
      Write-Log "verified receipt is missing the manifest-bound manager disposition overlay; rebuilding through the protected Windows publisher" 'WARN'
    }
  }

  Push-Location $AppRoot
  try {
    if (-not $SkipPhotoCache -and -not $HoldRefresh) {
      # Step 1 - vehicle resource cache (photos / AutoCheck / window stickers).
      # Prefer reusing resources already embedded in the hash-bound snapshot;
      # fall back to a fresh VDP extraction when that yields nothing.
      Write-Log 'photo cache: building (--reuse-snapshot-resources)'
      $cacheRun = Invoke-NativeCapture -FilePath $PythonExecutable -Arguments @('scripts\build_photo_cache.py', '--workspace-root', $WorkspaceRoot, '--report-date', $date, '--reuse-snapshot-resources')
      $cacheOut = $cacheRun.Output
      $reuseExit = $cacheRun.ExitCode
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
        $cacheRun = Invoke-NativeCapture -FilePath $PythonExecutable -Arguments @('scripts\build_photo_cache.py', '--workspace-root', $WorkspaceRoot, '--report-date', $date)
        $cacheOut = $cacheRun.Output
        if ($cacheRun.ExitCode -ne 0) { Write-Log "photo cache FAILED: $($cacheOut.Trim())" 'ERROR'; throw 'PHOTO_CACHE_FAILED' }
      }
      Write-Log "photo cache: $($cacheOut.Trim())"
    } else {
      Write-Log $(if ($HoldRefresh) { 'photo cache: reused for hold-only refresh' } else { 'photo cache: skipped by flag' })
    }

    if (-not $HoldRefresh) {
    # Step 1.4 - vAuto Factory Equipment (CAI label) capture, API path.
    # Silent and headless: an authenticated fetch inside the automation browser's own
    # vAuto tab (127.0.0.1:9222), ~0.2 s per VIN, no form, no popup, nothing on screen.
    # Resumable: VINs already OK in any work\vauto-history file are never re-fetched.
    # NON-FATAL: the enrichment step below merges every prior capture, so a day without
    # the browser (or with an expired vAuto login) still publishes with yesterday's labels.
    $vautoUp = $false
    try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 5; $vautoUp = $true } catch {}
    if ($vautoUp) {
      try {
        $worklistRun = Invoke-NativeCapture -FilePath $PythonExecutable -Arguments @((Join-Path $WorkspaceRoot 'work\build_vauto_worklist.py'), '--report-date', $date)
        $wlOut = $worklistRun.Output
        if ($worklistRun.ExitCode -ne 0) { throw "worklist: $($wlOut.Trim())" }
        Write-Log "vauto: $($wlOut.Trim())"
        $wlPath = Join-Path $WorkspaceRoot "work\vauto-history\worklist-$date.json"
        $feOut = Join-Path $WorkspaceRoot "work\vauto-history\$date-factory-equipment.json"
        $vautoRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\vauto-factory-equipment.mjs', 'run', $wlPath, $feOut, '--budget-ms', '600000')
        $vautoOut = $vautoRun.Output
        if ($vautoRun.ExitCode -ne 0) {
          Write-Log "vauto: capture incomplete (exit $($vautoRun.ExitCode)) - continuing with prior captures: $($vautoOut.Trim())" 'WARN'
          if ($vautoOut -match 'SESSION_EXPIRED') { Write-Log 'vauto: SESSION EXPIRED - sign in to vAuto again in the Work PC Automation Browser (Comet)' 'WARN' }
        } else {
          Write-Log "vauto: $($vautoOut.Trim())"
        }
        $autoCheckRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\capture-vauto-autocheck.mjs', 'run', $date, '--budget-ms', '600000')
        $autoCheckOut = $autoCheckRun.Output
        if ($autoCheckRun.ExitCode -ne 0) {
          Write-Log "vauto AutoCheck: fallback capture incomplete (exit $($autoCheckRun.ExitCode)) - continuing with prior exact-VIN captures: $($autoCheckOut.Trim())" 'WARN'
        } else {
          Write-Log "vauto AutoCheck: $($autoCheckOut.Trim())"
        }
      } catch {
        Write-Log "vauto: skipped - $($_.Exception.Message)" 'WARN'
      }
    } else {
      Write-Log 'vauto: automation browser not listening on 127.0.0.1:9222 - skipping capture, prior labels still merge' 'WARN'
    }

    # Stable vAuto labels are saved once as printable PDFs. Missing or broken
    # source documents remain informational and never block the live inventory.
    try {
      $pdfCacheRun = Invoke-NativeCapture -FilePath $PythonExecutable -Arguments @('scripts\cache-vauto-equipment-pdfs.py', '--workspace-root', $WorkspaceRoot, '--report-date', $date, '--max', '25', '--budget-seconds', '120')
      if ($pdfCacheRun.ExitCode -ne 0) {
        Write-Log "vauto PDFs: cache incomplete - $($pdfCacheRun.Output.Trim())" 'WARN'
      } else {
        Write-Log "vauto PDFs: $($pdfCacheRun.Output.Trim())"
      }
    } catch {
      Write-Log "vauto PDFs: cache skipped - $($_.Exception.Message)" 'WARN'
    }
    if (Test-Path -LiteralPath (Join-Path $AppRoot 'runtime\vauto-pdf-enabled.flag')) {
      $equipmentPublishRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\publish-vauto-documents.mjs', $date)
      if ($equipmentPublishRun.ExitCode -ne 0) {
        Write-Log "vauto PDFs: private staging FAILED - $($equipmentPublishRun.Output.Trim())" 'ERROR'
        throw 'VAUTO_PDF_STAGING_FAILED'
      }
      Write-Log "vauto PDFs: $($equipmentPublishRun.Output.Trim())"
    }

    # Step 1.45 - remaining factory warranty per VIN, figured at that vehicle's listed odometer.
    # Ford/Lincoln coverage comes from Ford OASIS through the authenticated FMCDealer tab in the
    # automation browser; non-Ford makes use the Experian AutoCheck estimate, which is
    # fetched straight from the dealer report page (no login, no clicking - the "enter mileage"
    # calculator is client-side arithmetic the script reproduces exactly).
    # NON-FATAL: warranty figures are reference data; a failure here must never block the publish.
    try {
      $warrantyRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\capture-warranty.mjs', 'run', $date, '--budget-ms', '1200000')
      $warrOut = $warrantyRun.Output
      if ($warrantyRun.ExitCode -ne 0) {
        Write-Log "warranty: capture incomplete (exit $($warrantyRun.ExitCode)) - continuing: $($warrOut.Trim())" 'WARN'
      } else {
        Write-Log "warranty: $($warrOut.Trim())"
        if ($warrOut -match 'session_expired|browser_unavailable|fordOasisPending[^0-9]*[1-9]') { Write-Log 'warranty: Ford OASIS is incomplete - sign in to FMCDealer in the Work PC Automation Browser; Ford/Lincoln AutoCheck-only rows are not published' 'WARN' }
      }
    } catch {
      Write-Log "warranty: skipped - $($_.Exception.Message)" 'WARN'
    }
    } else {
      Write-Log 'stable enrichment: reusing saved vAuto, AutoCheck, PDF, sticker, invoice, photo, and warranty data for hold-only refresh'
    }

    # Step 1.5 - per-VIN resource enrichment (window sticker / invoice / vAuto CAI label)
    # Rebuilds data\vin-document-enrichment.json from whatever the morning captured,
    # values copied as printed, then proves it against the REAL validators before
    # anything is published. A failure here stops the publish - never ships a bad file.
    if (-not $HoldRefresh) {
      Write-Log 'resources: building vin-document-enrichment.json'
      $enrichRun = Invoke-NativeCapture -FilePath $PythonExecutable -Arguments @((Join-Path $WorkspaceRoot 'work\build_vin_document_enrichment.py'), '--report-date', $date)
      $enrichOut = $enrichRun.Output
      if ($enrichRun.ExitCode -ne 0) { Write-Log "resources: build FAILED: $($enrichOut.Trim())" 'ERROR'; throw 'RESOURCE_ENRICHMENT_BUILD_FAILED' }
      Write-Log "resources: $($enrichOut.Trim())"
      $serviceHistoryMergeRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\merge-ford-service-history.mjs', $date)
      $serviceHistoryMergeOut = $serviceHistoryMergeRun.Output
      if ($serviceHistoryMergeRun.ExitCode -ne 0) { Write-Log "resources: Ford service history merge FAILED: $($serviceHistoryMergeOut.Trim())" 'ERROR'; throw 'RESOURCE_SERVICE_HISTORY_MERGE_FAILED' }
      Write-Log "resources: $($serviceHistoryMergeOut.Trim())"
      $autoCheckMergeRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\merge-vauto-autocheck.mjs', $date)
      $autoCheckMergeOut = $autoCheckMergeRun.Output
      if ($autoCheckMergeRun.ExitCode -ne 0) { Write-Log "resources: AutoCheck merge FAILED: $($autoCheckMergeOut.Trim())" 'ERROR'; throw 'RESOURCE_AUTOCHECK_MERGE_FAILED' }
      Write-Log "resources: $($autoCheckMergeOut.Trim())"
      $invoiceMergeRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\merge-invoice-metadata.mjs', $date)
      $invoiceMergeOut = $invoiceMergeRun.Output
      if ($invoiceMergeRun.ExitCode -ne 0) { Write-Log "resources: invoice merge FAILED: $($invoiceMergeOut.Trim())" 'ERROR'; throw 'RESOURCE_INVOICE_MERGE_FAILED' }
      Write-Log "resources: $($invoiceMergeOut.Trim())"
    } else {
      Write-Log 'resources: reusing receipt-bound enrichment already validated by the daily orchestrator'
    }
    Write-Log 'resources: validating against release validators'
    $enrichCheckRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\dryrun_resource_enrichment_check.mjs', $date)
    $enrichCheck = $enrichCheckRun.Output
    if ($enrichCheckRun.ExitCode -ne 0) { Write-Log "resources: validation FAILED: $($enrichCheck.Trim())" 'ERROR'; throw 'RESOURCE_ENRICHMENT_INVALID' }
    Write-Log "resources: $($enrichCheck.Trim())"

    # Step 2 - build, validate, encrypt, publish, and independently re-verify
    # against /internal/status and /internal/readiness. Emits an uppercase error
    # CODE on failure, never raw detail.
    Write-Log 'cloud publish: running sync-cloud-release.mjs'
    $syncRun = Invoke-NativeCapture -FilePath $NodeExecutable -Arguments @('scripts\sync-cloud-release.mjs')
    $syncOut = $syncRun.Output
    if ($syncRun.ExitCode -ne 0) { Write-Log "cloud publish FAILED: $($syncOut.Trim())" 'ERROR'; throw 'CLOUD_PUBLISH_FAILED' }
    Write-Log "cloud publish: $($syncOut.Trim())"

    if ($syncOut -notmatch '"status"\s*:\s*"published_and_verified"') {
      Write-Log 'cloud publish did not report published_and_verified' 'ERROR'
      throw 'PUBLISH_NOT_VERIFIED'
    }
    $verifiedPublicationAvailable = $true
    $verifiedReceipt = Get-Content $receiptPath -Raw | ConvertFrom-Json
    Complete-PublicationFollowups -Receipt $verifiedReceipt -Date $date -ReuseDocuments:$HoldRefresh
    Write-Log '=== daily-cloud-publish SUCCESS ==='
  } finally {
    Pop-Location
  }
} catch {
  $exitCode = 1
  if ($verifiedPublicationAvailable) {
    Write-Log ("=== daily-cloud-publish RELEASE PUBLISHED; FOLLOWUPS FAILED: {0} ===" -f $_.Exception.Message) 'ERROR'
  } else {
    Write-Log ("=== daily-cloud-publish FAILED BEFORE VERIFIED PUBLICATION: {0} ===" -f $_.Exception.Message) 'ERROR'
  }
} finally {
  foreach ($key in $originalEnv.Keys) {
    # PowerShell 7.5+ converts a null setter argument to an empty value.
    # Remove absent originals explicitly; preserve existing strings as-is.
    if ($null -eq $originalEnv[$key]) {
      Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
    } else {
      [System.Environment]::SetEnvironmentVariable($key, $originalEnv[$key])
    }
  }
  $originalEnv = @{}
  $secrets = $null
  Exit-PublicationPipelineLock -Lock $pipelineLock
  $pipelineLock = $null
}

exit $exitCode
