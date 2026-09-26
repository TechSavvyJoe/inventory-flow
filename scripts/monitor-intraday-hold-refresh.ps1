# Monitors the existing intraday hold-refresh task without becoming another
# inventory writer. The only recovery action this script can take is starting
# BobMaxey-InventoryFlow-IntradayHolds once for a newly observed failure.

[CmdletBinding()]
param(
  [string]$WorkspaceRoot,
  [DateTimeOffset]$Now = [DateTimeOffset]::Now,
  [ValidateRange(0, 900)][int]$RecheckDelaySeconds = 60
)

$ErrorActionPreference = 'Stop'
$TargetTaskName = 'BobMaxey-InventoryFlow-IntradayHolds'
$MonitorName = 'BobMaxey-InventoryFlow-IntradayHolds-Monitor'
$OperatingStart = [TimeSpan]::FromHours(9) + [TimeSpan]::FromMinutes(25)
$OperatingEnd = [TimeSpan]::FromHours(19) + [TimeSpan]::FromMinutes(25)
$MaximumVerifiedAge = [TimeSpan]::FromMinutes(90)
$MaximumLegacyReceiptGap = [TimeSpan]::FromMinutes(15)
$MaximumFutureSkew = [TimeSpan]::FromMinutes(5)

$AppRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) { $WorkspaceRoot = $env:BOB_MAXEY_WORKSPACE_ROOT }
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) { $WorkspaceRoot = $env:INVENTORY_WORKSPACE_ROOT }
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $candidate = Split-Path -Parent (Split-Path -Parent $AppRoot)
  if ((Test-Path (Join-Path $candidate 'work')) -and
      (Test-Path (Join-Path $candidate 'outputs')) -and
      (Test-Path (Join-Path $candidate 'apps\inventory-ops'))) {
    $WorkspaceRoot = $candidate
  }
}
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  throw 'Workspace root was not found. Pass -WorkspaceRoot with the reporting workspace path.'
}
$WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
foreach ($requiredPath in @('work', 'outputs', 'apps\inventory-ops')) {
  if (-not (Test-Path -LiteralPath (Join-Path $WorkspaceRoot $requiredPath))) {
    throw "WORKSPACE_ROOT_INVALID: missing $requiredPath under the configured workspace"
  }
}

$ReportDate = $Now.ToString('yyyy-MM-dd')
$MonitorDirectory = Join-Path $WorkspaceRoot 'work\hold-refresh-monitor'
$StatePath = Join-Path $MonitorDirectory 'state.json'
$ActiveAlertPath = Join-Path $MonitorDirectory 'active-alert.json'
$AlertHistoryDirectory = Join-Path $MonitorDirectory 'alerts'
$HoldStatusPath = Join-Path $WorkspaceRoot ("work\hold-refresh-status\{0}.json" -f $ReportDate)
$AppReceiptPath = Join-Path $WorkspaceRoot ("work\app-feed-status\{0}.json" -f $ReportDate)

function Read-JsonFile {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return [pscustomobject]@{ Exists = $false; Valid = $false; Value = $null }
  }
  try {
    return [pscustomobject]@{
      Exists = $true
      Valid = $true
      Value = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
  } catch {
    return [pscustomobject]@{ Exists = $true; Valid = $false; Value = $null }
  }
}

function Write-JsonAtomic {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)]$Value
  )
  $directory = Split-Path -Parent $Path
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $temporary = "{0}.{1}.tmp" -f $Path, [Guid]::NewGuid().ToString('N')
  try {
    $json = $Value | ConvertTo-Json -Depth 16
    [System.IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

function Parse-Instant {
  param($Value)
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
  if ($Value -is [DateTimeOffset]) { return [DateTimeOffset]$Value }
  if ($Value -is [DateTime]) { return [DateTimeOffset]$Value }
  $parsed = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$Value,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$parsed)) { return $null }
  return $parsed
}

function Test-SameInstant {
  param($Left, $Right)
  $leftInstant = Parse-Instant $Left
  $rightInstant = Parse-Instant $Right
  return $null -ne $leftInstant -and $null -ne $rightInstant -and $leftInstant.UtcDateTime -eq $rightInstant.UtcDateTime
}

function Normalize-Hash {
  param($Value)
  $text = ([string]$Value).Trim().ToUpperInvariant()
  if ($text -notmatch '^[A-F0-9]{64}$') { return $null }
  return $text
}

function Get-Sha256Text {
  param([Parameter(Mandatory)][string]$Text)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Get-OperatingPeriod {
  if ($Now.TimeOfDay -lt $OperatingStart) { return 'before' }
  if ($Now.TimeOfDay -le $OperatingEnd) { return 'inside' }
  return 'after'
}

function Get-ReceiptHealth {
  $statusFile = Read-JsonFile -Path $HoldStatusPath
  $receiptFile = Read-JsonFile -Path $AppReceiptPath
  $reasons = [Collections.Generic.List[string]]::new()

  if (-not $statusFile.Exists) { $reasons.Add('hold_status_missing') }
  elseif (-not $statusFile.Valid) { $reasons.Add('hold_status_invalid_json') }
  if (-not $receiptFile.Exists) { $reasons.Add('app_receipt_missing') }
  elseif (-not $receiptFile.Valid) { $reasons.Add('app_receipt_invalid_json') }

  $status = $statusFile.Value
  $receipt = $receiptFile.Value
  if ($statusFile.Valid) {
    if ([string]$status.status -cne 'intraday_holds_published_and_verified') { $reasons.Add('hold_status_not_verified') }
    if ([string]$status.reportDate -cne $ReportDate) { $reasons.Add('hold_status_report_date_mismatch') }
  }
  if ($receiptFile.Valid) {
    if ([string]$receipt.status -cne 'published_and_verified') { $reasons.Add('app_receipt_not_verified') }
    if ($receipt.complete -ne $true) { $reasons.Add('app_receipt_incomplete') }
    if ([string]$receipt.reportDate -cne $ReportDate) { $reasons.Add('app_receipt_report_date_mismatch') }
  }

  $checkedAt = if ($statusFile.Valid) { Parse-Instant $status.checkedAt } else { $null }
  $verifiedAt = if ($receiptFile.Valid) { Parse-Instant $receipt.verifiedAt } else { $null }
  if ($statusFile.Valid -and $null -eq $checkedAt) { $reasons.Add('hold_status_checked_at_invalid') }
  if ($receiptFile.Valid -and $null -eq $verifiedAt) { $reasons.Add('app_receipt_verified_at_invalid') }

  $linkMode = 'none'
  if ($statusFile.Valid -and $receiptFile.Valid -and $null -ne $status.receipt) {
    $linkMode = 'explicit'
    $statusBundle = Normalize-Hash $status.receipt.bundleSha256
    $receiptBundle = Normalize-Hash $receipt.bundleSha256
    $statusDealerMail = Normalize-Hash $status.receipt.dealerMailSha256
    $receiptDealerMail = Normalize-Hash $receipt.sourceHashes.dealerMail
    $linkedVerifiedAt = Parse-Instant $status.receipt.verifiedAt
    if ($null -eq $statusBundle -or $null -eq $receiptBundle -or $statusBundle -cne $receiptBundle) {
      $reasons.Add('receipt_bundle_link_mismatch')
    }
    if ($null -eq $statusDealerMail -or $null -eq $receiptDealerMail -or $statusDealerMail -cne $receiptDealerMail) {
      $reasons.Add('receipt_dealermail_link_mismatch')
    }
    if ($null -eq $linkedVerifiedAt -or $null -eq $verifiedAt -or $linkedVerifiedAt.UtcDateTime -ne $verifiedAt.UtcDateTime) {
      $reasons.Add('receipt_verified_at_link_mismatch')
    }
  } elseif ($null -ne $checkedAt -and $null -ne $verifiedAt) {
    # Compatibility for the first rollout of the intraday schema. Its status is
    # written immediately after the publisher rewrites the app-feed receipt.
    $linkMode = 'temporal_legacy'
    $gap = $checkedAt - $verifiedAt
    if ($gap -lt -$MaximumFutureSkew -or $gap -gt $MaximumLegacyReceiptGap) {
      $reasons.Add('legacy_receipt_not_corresponding')
    }
  }

  $freshestCommonInstant = $null
  if ($null -ne $checkedAt -and $null -ne $verifiedAt) {
    $freshestCommonInstant = if ($checkedAt -lt $verifiedAt) { $checkedAt } else { $verifiedAt }
    if ($freshestCommonInstant -gt $Now.Add($MaximumFutureSkew)) { $reasons.Add('verified_time_in_future') }
  }
  $ageMinutes = if ($null -ne $freshestCommonInstant) { [Math]::Round(($Now - $freshestCommonInstant).TotalMinutes, 2) } else { $null }
  $period = Get-OperatingPeriod
  $stale = $period -eq 'inside' -and ($null -eq $ageMinutes -or $ageMinutes -gt $MaximumVerifiedAge.TotalMinutes -or $reasons.Count -gt 0)
  $verified = $reasons.Count -eq 0

  return [pscustomobject]@{
    Verified = $verified
    Stale = $stale
    Period = $period
    CheckedAt = if ($null -ne $checkedAt) { $checkedAt.ToString('o') } else { $null }
    VerifiedAt = if ($null -ne $verifiedAt) { $verifiedAt.ToString('o') } else { $null }
    AgeMinutes = $ageMinutes
    LinkMode = $linkMode
    Reasons = @($reasons)
  }
}

function Get-TargetTaskState {
  try {
    $task = Get-ScheduledTask -TaskName $TargetTaskName -ErrorAction Stop
  } catch {
    $missing = $_.Exception -is [Management.Automation.ItemNotFoundException] -or $_.CategoryInfo.Category -eq 'ObjectNotFound'
    return [pscustomobject]@{
      Present = $false
      QueryFailed = -not $missing
      Running = $false
      Available = $false
      State = if ($missing) { 'Missing' } else { 'QueryFailed' }
      LastResult = $null
      LastRunTime = $null
      LastCompletedSucceeded = $false
      HasCompletedRun = $false
    }
  }

  $state = [string]$task.State
  $active = $state -in @('Running', 'Queued')
  try {
    $info = Get-ScheduledTaskInfo -TaskName $TargetTaskName -ErrorAction Stop
  } catch {
    return [pscustomobject]@{
      Present = $true
      QueryFailed = $true
      Running = $active
      Available = $false
      State = 'QueryFailed'
      LastResult = $null
      LastRunTime = $null
      LastCompletedSucceeded = $false
      HasCompletedRun = $false
    }
  }
  $lastRun = if ($null -ne $info.LastRunTime) { [DateTimeOffset]$info.LastRunTime } else { $null }
  $hasCompletedRun = $null -ne $lastRun -and $lastRun.Year -ge 2000
  $lastResult = if ($null -ne $info.LastTaskResult) { [int64]$info.LastTaskResult } else { $null }
  return [pscustomobject]@{
    Present = $true
    QueryFailed = $false
    Running = $active
    Available = $state -in @('Ready', 'Running', 'Queued')
    State = $state
    LastResult = $lastResult
    LastRunTime = if ($null -ne $lastRun) { $lastRun.ToString('o') } else { $null }
    LastCompletedSucceeded = $hasCompletedRun -and $lastResult -eq 0
    HasCompletedRun = $hasCompletedRun
  }
}

function Read-MonitorState {
  $file = Read-JsonFile -Path $StatePath
  if (-not $file.Valid) {
    return [pscustomobject]@{
      lastRecoveryTaskFailureFingerprint = $null
      lastRecoveryReceiptFingerprint = $null
      lastRecoveryTaskRunAt = $null
      lastAlertFingerprint = $null
    }
  }
  return $file.Value
}

function Get-TaskFailureFingerprint {
  param($TaskState)
  if ($TaskState.Running -or -not $TaskState.HasCompletedRun -or $TaskState.LastCompletedSucceeded) { return $null }
  return Get-Sha256Text (@($ReportDate, 'task_failure', $TaskState.LastRunTime, $TaskState.LastResult) -join '|')
}

function Get-ReceiptIssueFingerprint {
  param($ReceiptHealth)
  if (-not $ReceiptHealth.Stale) { return $null }
  return Get-Sha256Text (@(
      $ReportDate,
      'receipt_issue',
      $ReceiptHealth.CheckedAt,
      $ReceiptHealth.VerifiedAt,
      $ReceiptHealth.LinkMode,
      ($ReceiptHealth.Reasons -join ',')
    ) -join '|')
}

function Get-ObservationFingerprint {
  param($TaskState, $ReceiptHealth)
  return Get-Sha256Text (@(
      $ReportDate,
      $TaskState.Present,
      $TaskState.State,
      $TaskState.LastResult,
      $TaskState.LastRunTime,
      $ReceiptHealth.CheckedAt,
      $ReceiptHealth.VerifiedAt,
      $ReceiptHealth.LinkMode,
      ($ReceiptHealth.Reasons -join ',')
    ) -join '|')
}

function Save-MonitorState {
  param(
    [Parameter(Mandatory)]$State,
    [Parameter(Mandatory)]$TaskState,
    [Parameter(Mandatory)]$ReceiptHealth,
    [string]$RecoveryTaskFailureFingerprint,
    [string]$RecoveryReceiptFingerprint,
    [string]$RecoveryTaskRunAt,
    [string]$AlertFingerprint
  )
  Write-JsonAtomic -Path $StatePath -Value ([ordered]@{
      schemaVersion = 1
      monitor = $MonitorName
      reportDate = $ReportDate
      observedAt = $Now.ToString('o')
      taskState = $TaskState.State
      lastTaskResult = $TaskState.LastResult
      lastTaskRunAt = $TaskState.LastRunTime
      receiptStatus = if ($ReceiptHealth.Verified) { 'verified' } else { 'unverified' }
      receiptCheckedAt = $ReceiptHealth.CheckedAt
      receiptVerifiedAt = $ReceiptHealth.VerifiedAt
      receiptLinkMode = $ReceiptHealth.LinkMode
      lastRecoveryTaskFailureFingerprint = $RecoveryTaskFailureFingerprint
      lastRecoveryReceiptFingerprint = $RecoveryReceiptFingerprint
      lastRecoveryTaskRunAt = $RecoveryTaskRunAt
      lastAlertFingerprint = $AlertFingerprint
    })
}

function Publish-Alert {
  param(
    [Parameter(Mandatory)][string]$Code,
    [Parameter(Mandatory)][string]$Summary,
    [Parameter(Mandatory)][string]$Action,
    [Parameter(Mandatory)]$TaskState,
    [Parameter(Mandatory)]$ReceiptHealth,
    [Parameter(Mandatory)][string]$Fingerprint,
    [Parameter(Mandatory)]$PreviousState
  )
  if ([string]$PreviousState.lastAlertFingerprint -ceq $Fingerprint) { return $false }
  $alert = [ordered]@{
    schemaVersion = 1
    monitor = $MonitorName
    taskName = $TargetTaskName
    reportDate = $ReportDate
    createdAt = $Now.ToString('o')
    code = $Code
    summary = $Summary
    action = $Action
    evidence = [ordered]@{
      taskPresent = $TaskState.Present
      taskQueryFailed = $TaskState.QueryFailed
      taskState = $TaskState.State
      lastTaskResult = $TaskState.LastResult
      lastTaskRunAt = $TaskState.LastRunTime
      holdStatusCheckedAt = $ReceiptHealth.CheckedAt
      appReceiptVerifiedAt = $ReceiptHealth.VerifiedAt
      receiptLinkMode = $ReceiptHealth.LinkMode
      reasons = @($ReceiptHealth.Reasons)
    }
  }
  Write-JsonAtomic -Path $ActiveAlertPath -Value $alert
  $historyName = '{0}-{1}.json' -f $Now.ToString('yyyyMMddTHHmmssfff'), $Fingerprint.Substring(0, 12)
  Write-JsonAtomic -Path (Join-Path $AlertHistoryDirectory $historyName) -Value $alert

  # The Application source exists on normal Windows installations. The alert
  # artifact remains authoritative if standard-user event-log access is denied.
  try {
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
      Write-EventLog -LogName Application -Source 'Windows PowerShell' -EventId 9101 -EntryType Error -Message ("{0}: {1} Action: {2}" -f $MonitorName, $Summary, $Action) -ErrorAction Stop
    }
  } catch {}
  return $true
}

function Clear-ActiveAlert {
  Remove-Item -LiteralPath $ActiveAlertPath -Force -ErrorAction SilentlyContinue
}

$previousState = Read-MonitorState
$taskState = Get-TargetTaskState
$receiptHealth = Get-ReceiptHealth
$observationFingerprint = Get-ObservationFingerprint -TaskState $taskState -ReceiptHealth $receiptHealth
$recoveryTaskFailureFingerprint = [string]$previousState.lastRecoveryTaskFailureFingerprint
$recoveryReceiptFingerprint = [string]$previousState.lastRecoveryReceiptFingerprint
$recoveryTaskRunAt = [string]$previousState.lastRecoveryTaskRunAt
$alertFingerprint = [string]$previousState.lastAlertFingerprint

if ($taskState.QueryFailed -or -not $taskState.Present) {
  $queryCode = if ($taskState.QueryFailed) { 'intraday_hold_task_query_failed' } else { 'intraday_hold_task_missing' }
  $querySummary = if ($taskState.QueryFailed) {
    "The monitor could not read $TargetTaskName and its most recent result."
  } else {
    "The required Windows task $TargetTaskName is missing."
  }
  $queryAction = if ($taskState.QueryFailed) {
    'Verify the Task Scheduler service and this user account access, then run this monitor again.'
  } else {
    'Register the existing intraday hold-refresh task, then run this monitor again.'
  }
  $missingFingerprint = Get-Sha256Text ("{0}|{1}" -f $ReportDate, $queryCode)
  $newAlert = Publish-Alert `
    -Code $queryCode `
    -Summary $querySummary `
    -Action $queryAction `
    -TaskState $taskState `
    -ReceiptHealth $receiptHealth `
    -Fingerprint $missingFingerprint `
    -PreviousState $previousState
  if ($newAlert) { $alertFingerprint = $missingFingerprint }
  Save-MonitorState -State $previousState -TaskState $taskState -ReceiptHealth $receiptHealth -RecoveryTaskFailureFingerprint $recoveryTaskFailureFingerprint -RecoveryReceiptFingerprint $recoveryReceiptFingerprint -RecoveryTaskRunAt $recoveryTaskRunAt -AlertFingerprint $alertFingerprint
  return
}

$scheduledRunFailed = $taskState.HasCompletedRun -and -not $taskState.LastCompletedSucceeded
$taskFailureFingerprint = Get-TaskFailureFingerprint -TaskState $taskState
$receiptIssueFingerprint = Get-ReceiptIssueFingerprint -ReceiptHealth $receiptHealth
$currentRunWasRecovery = Test-SameInstant $previousState.lastRecoveryTaskRunAt $taskState.LastRunTime
$taskFailureAlreadyAttempted = $null -ne $taskFailureFingerprint -and (
  [string]$previousState.lastRecoveryTaskFailureFingerprint -ceq $taskFailureFingerprint -or
  $currentRunWasRecovery
)
$receiptIssueAlreadyAttempted = $null -ne $receiptIssueFingerprint -and [string]$previousState.lastRecoveryReceiptFingerprint -ceq $receiptIssueFingerprint
$needsRepair = $receiptHealth.Period -eq 'inside' -and -not $taskState.Running -and -not $currentRunWasRecovery -and (
  ($scheduledRunFailed -and -not $taskFailureAlreadyAttempted) -or
  ($receiptHealth.Stale -and -not $receiptIssueAlreadyAttempted)
)
if ($needsRepair) {
  if ($null -ne $taskFailureFingerprint) { $recoveryTaskFailureFingerprint = $taskFailureFingerprint }
  if ($null -ne $receiptIssueFingerprint) { $recoveryReceiptFingerprint = $receiptIssueFingerprint }
  try {
    Start-ScheduledTask -TaskName $TargetTaskName -ErrorAction Stop
    if ($RecheckDelaySeconds -gt 0) { Start-Sleep -Seconds $RecheckDelaySeconds }
    $taskState = Get-TargetTaskState
    $receiptHealth = Get-ReceiptHealth
    $observationFingerprint = Get-ObservationFingerprint -TaskState $taskState -ReceiptHealth $receiptHealth
    if (-not [string]::IsNullOrWhiteSpace($taskState.LastRunTime)) { $recoveryTaskRunAt = [string]$taskState.LastRunTime }
    $recheckedFailureFingerprint = Get-TaskFailureFingerprint -TaskState $taskState
    $recheckedReceiptFingerprint = Get-ReceiptIssueFingerprint -ReceiptHealth $receiptHealth
    if ($null -ne $recheckedFailureFingerprint) { $recoveryTaskFailureFingerprint = $recheckedFailureFingerprint }
    if ($null -ne $recheckedReceiptFingerprint) { $recoveryReceiptFingerprint = $recheckedReceiptFingerprint }
    $previousState = [pscustomobject]@{
      lastRecoveryTaskFailureFingerprint = $recoveryTaskFailureFingerprint
      lastRecoveryReceiptFingerprint = $recoveryReceiptFingerprint
      lastRecoveryTaskRunAt = $recoveryTaskRunAt
      lastAlertFingerprint = $alertFingerprint
    }
  } catch {
    $startFailureFingerprint = Get-Sha256Text ("{0}|start_failed|{1}" -f $observationFingerprint, $_.Exception.GetType().FullName)
    $newAlert = Publish-Alert `
      -Code 'intraday_hold_task_start_failed' `
      -Summary "The monitor could not start $TargetTaskName." `
      -Action 'Open Task Scheduler, verify the task can run as its configured user, and start that task once.' `
      -TaskState $taskState `
      -ReceiptHealth $receiptHealth `
      -Fingerprint $startFailureFingerprint `
      -PreviousState $previousState
    if ($newAlert) { $alertFingerprint = $startFailureFingerprint }
    Save-MonitorState -State $previousState -TaskState $taskState -ReceiptHealth $receiptHealth -RecoveryTaskFailureFingerprint $recoveryTaskFailureFingerprint -RecoveryReceiptFingerprint $recoveryReceiptFingerprint -RecoveryTaskRunAt $recoveryTaskRunAt -AlertFingerprint $alertFingerprint
    return
  }
}

if ($taskState.Running) {
  Save-MonitorState -State $previousState -TaskState $taskState -ReceiptHealth $receiptHealth -RecoveryTaskFailureFingerprint $recoveryTaskFailureFingerprint -RecoveryReceiptFingerprint $recoveryReceiptFingerprint -RecoveryTaskRunAt $recoveryTaskRunAt -AlertFingerprint $alertFingerprint
  return
}

$scheduledRunFailed = $taskState.HasCompletedRun -and -not $taskState.LastCompletedSucceeded
$healthyForPeriod = $taskState.Available -and $taskState.LastCompletedSucceeded -and $receiptHealth.Verified -and ($receiptHealth.Period -ne 'inside' -or -not $receiptHealth.Stale)
if ($healthyForPeriod) {
  Clear-ActiveAlert
  Save-MonitorState -State $previousState -TaskState $taskState -ReceiptHealth $receiptHealth -RecoveryTaskFailureFingerprint $null -RecoveryReceiptFingerprint $null -RecoveryTaskRunAt $null -AlertFingerprint $null
  return
}

# Before the first operating slot, today's receipt is not expected yet. A
# previous successful completion is enough to avoid a false overnight alert.
if ($receiptHealth.Period -eq 'before' -and $taskState.Available -and $taskState.LastCompletedSucceeded) {
  Save-MonitorState -State $previousState -TaskState $taskState -ReceiptHealth $receiptHealth -RecoveryTaskFailureFingerprint $recoveryTaskFailureFingerprint -RecoveryReceiptFingerprint $recoveryReceiptFingerprint -RecoveryTaskRunAt $recoveryTaskRunAt -AlertFingerprint $alertFingerprint
  return
}

$code = if (-not $taskState.Available) { 'intraday_hold_task_unavailable' }
elseif ($scheduledRunFailed) { 'intraday_hold_task_failed' }
elseif (-not $taskState.HasCompletedRun) { 'intraday_hold_task_has_no_completed_run' }
else { 'intraday_hold_status_unverified' }
$summary = if (-not $taskState.Available) {
  "$TargetTaskName is present but its state is $($taskState.State)."
} elseif ($scheduledRunFailed) {
  "The most recent completed $TargetTaskName run failed and the one permitted recovery attempt did not repair it."
} elseif (-not $taskState.HasCompletedRun) {
  "$TargetTaskName has no completed run that can be confirmed successful."
} else {
  "Today's verified intraday hold status and app-feed receipt could not be confirmed after the one permitted recovery attempt."
}
$action = if (-not $taskState.Available) {
  'Open Task Scheduler, enable or repair the existing intraday hold task, then start that task once. Do not run capture or publication scripts directly.'
} else {
  'Open Task Scheduler and the active alert artifact, repair the stated condition, then run the existing intraday hold task once. Do not run capture or publication scripts directly.'
}
$newAlert = Publish-Alert `
  -Code $code `
  -Summary $summary `
  -Action $action `
  -TaskState $taskState `
  -ReceiptHealth $receiptHealth `
  -Fingerprint $observationFingerprint `
  -PreviousState $previousState
if ($newAlert) { $alertFingerprint = $observationFingerprint }
Save-MonitorState -State $previousState -TaskState $taskState -ReceiptHealth $receiptHealth -RecoveryTaskFailureFingerprint $recoveryTaskFailureFingerprint -RecoveryReceiptFingerprint $recoveryReceiptFingerprint -RecoveryTaskRunAt $recoveryTaskRunAt -AlertFingerprint $alertFingerprint
