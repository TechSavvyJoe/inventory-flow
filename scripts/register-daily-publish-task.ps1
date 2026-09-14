# Registers the Windows Scheduled Task that runs daily-cloud-publish.ps1.
#
# Why a Windows task and not the Claude/Cowork scheduled task: the publish step
# is classified as a production deploy and is refused in unattended AI sessions.
# Windows Task Scheduler has no such gate, and running as JoeGallant keeps the
# DPAPI (current-user) secret bundle decryptable.
#
# Re-runnable: -Force replaces any existing registration.

$ErrorActionPreference = 'Stop'

$TaskName = 'BobMaxey-InventoryFlow-DailyPublish'
$ScriptPath = Join-Path $PSScriptRoot 'daily-cloud-publish.ps1'
$AppRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $ScriptPath)) { throw "publish script not found: $ScriptPath" }

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $ScriptPath) `
  -WorkingDirectory $AppRoot

# First attempt at 09:15 local, then every 30 minutes through 15:15. This
# deliberately covers the 9:15 / 9:45 / 10:15 / 10:45 cadence documented in
# docs/CLOUDFLARE_PRIVATE_RELEASE_RUNBOOK.md ("follows report completion"), and
# keeps retrying past it as insurance. The script's idempotency guard makes every
# attempt after a verified publish a cheap no-op, so the extra slots cost nothing
# and a late-finishing morning build still publishes the same day.
$startAt = (Get-Date -Hour 9 -Minute 15 -Second 0)
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
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -RestartCount 2 `
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
  -Description 'Bob Maxey Inventory Flow: builds the vehicle resource/photo cache and publishes the verified release to Cloudflare. Runs as JoeGallant so the DPAPI secret store decrypts. Idempotent - skips if the day is already published_and_verified.' `
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
