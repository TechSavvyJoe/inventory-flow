# Registers the Windows Scheduled Task that runs the app-first Inventory Flow
# daily pipeline. This is the script-first replacement for AI-supervised
# morning runs: it collects sources, validates the app/API/MCP release bundle,
# and publishes through the protected Cloudflare publisher.
#
# Re-runnable: -Force replaces any existing registration.

[CmdletBinding()]
param([string]$WorkspaceRoot)

$ErrorActionPreference = 'Stop'

$TaskName = 'BobMaxey-InventoryFlow-DailyRun'
$ScriptPath = Join-Path $PSScriptRoot 'run-inventory-flow-daily.mjs'
$AppRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) { $WorkspaceRoot = $env:BOB_MAXEY_WORKSPACE_ROOT }
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) { $WorkspaceRoot = $env:INVENTORY_WORKSPACE_ROOT }
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $candidate = Split-Path -Parent (Split-Path -Parent $AppRoot)
  if ((Test-Path (Join-Path $candidate 'work\run-status')) -and
      (Test-Path (Join-Path $candidate 'outputs')) -and
      (Test-Path (Join-Path $candidate 'apps\inventory-ops'))) {
    $WorkspaceRoot = $candidate
  }
}
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  throw 'Workspace root was not found. Pass -WorkspaceRoot with the reporting workspace path.'
}
$WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
foreach ($requiredPath in @('work\run-status', 'outputs', 'apps\inventory-ops')) {
  if (-not (Test-Path -LiteralPath (Join-Path $WorkspaceRoot $requiredPath))) {
    throw "WORKSPACE_ROOT_INVALID: missing $requiredPath under $WorkspaceRoot"
  }
}

$BundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$NodeExecutable = if (Test-Path -LiteralPath $BundledNode) { $BundledNode } else { (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path $ScriptPath)) { throw "daily run script not found: $ScriptPath" }

$action = New-ScheduledTaskAction `
  -Execute $NodeExecutable `
  -Argument ('"{0}" --workspace-root "{1}"' -f $ScriptPath, $WorkspaceRoot) `
  -WorkingDirectory $AppRoot

# Starts before store opening and retries every 30 minutes for six hours. The
# command is idempotent: once app-feed-status\YYYY-MM-DD.json is
# published_and_verified, later runs validate and skip without recapturing.
$startAt = (Get-Date -Hour 7 -Minute 30 -Second 0)
$trigger = New-ScheduledTaskTrigger -Daily -At $startAt
$repeatSource = New-ScheduledTaskTrigger -Once -At $startAt `
  -RepetitionInterval (New-TimeSpan -Minutes 30) `
  -RepetitionDuration (New-TimeSpan -Hours 6)
$trigger.Repetition = $repeatSource.Repetition

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
  -RestartCount 1 `
  -RestartInterval (New-TimeSpan -Minutes 10)

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
  -Description 'Bob Maxey Inventory Flow: app-first daily data collector and Cloudflare release publisher. Excel workbook generation is optional and outside the critical app/API/MCP path.' `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  TaskName   = $task.TaskName
  State      = $task.State
  RunAs      = $task.Principal.UserId
  LogonType  = $task.Principal.LogonType
  NextRun    = $info.NextRunTime
  Repetition = ('every {0} for {1}' -f $task.Triggers[0].Repetition.Interval, $task.Triggers[0].Repetition.Duration)
} | Format-List
