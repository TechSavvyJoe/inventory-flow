# Registers a read-mostly monitor for BobMaxey-InventoryFlow-IntradayHolds.
# The monitor never runs DealerMail capture or Cloudflare publication commands;
# its only repair action is Start-ScheduledTask for that exact existing task.

[CmdletBinding()]
param([string]$WorkspaceRoot)

$ErrorActionPreference = 'Stop'
$TaskName = 'BobMaxey-InventoryFlow-IntradayHolds-Monitor'
$MonitorPath = Join-Path $PSScriptRoot 'monitor-intraday-hold-refresh.ps1'
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
if (-not (Test-Path -LiteralPath $MonitorPath -PathType Leaf)) { throw "monitor script not found: $MonitorPath" }
try {
  Get-ScheduledTask -TaskName 'BobMaxey-InventoryFlow-IntradayHolds' -ErrorAction Stop | Out-Null
} catch {
  throw 'MONITORED_TASK_MISSING: register BobMaxey-InventoryFlow-IntradayHolds before registering its monitor'
}

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -WorkspaceRoot "{1}"' -f $MonitorPath, $WorkspaceRoot) `
  -WorkingDirectory $AppRoot

# The monitored writer runs at :25/:55. Checking at :42/:12 gives it time to
# finish, then checks once more before the next slot. The final 19:57 check can
# report a failed or timed-out 19:25 run but cannot start it outside the window.
$startAt = (Get-Date -Hour 9 -Minute 42 -Second 0)
$trigger = New-ScheduledTaskTrigger -Daily -At $startAt
$repeatSource = New-ScheduledTaskTrigger -Once -At $startAt `
  -RepetitionInterval (New-TimeSpan -Minutes 15) `
  -RepetitionDuration (New-TimeSpan -Hours 10 -Minutes 15)
$trigger.Repetition = $repeatSource.Repetition

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$principal = New-ScheduledTaskPrincipal `
  -UserId ("{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME) `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Monitors the existing Inventory Flow intraday hold task and its verified receipts. It can start only that existing task once when a new in-window failure is observed.' `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  RunAs = $task.Principal.UserId
  LogonType = $task.Principal.LogonType
  NextRun = $info.NextRunTime
  Repetition = ('every {0} for {1}' -f $task.Triggers[0].Repetition.Interval, $task.Triggers[0].Repetition.Duration)
} | Format-List
