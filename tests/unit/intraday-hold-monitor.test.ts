// @ts-nocheck -- Windows PowerShell behavior harness; no live tasks or data.
// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const monitorPath = fileURLToPath(new URL('../../scripts/monitor-intraday-hold-refresh.ps1', import.meta.url))
const registerPath = fileURLToPath(new URL('../../scripts/register-intraday-hold-monitor-task.ps1', import.meta.url))
const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const bundleSha256 = 'A'.repeat(64)
const dealerMailSha256 = 'B'.repeat(64)
const reportDate = '2026-09-25'

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'inventory-hold-monitor-'))
  roots.push(root)
  for (const directory of ['work', 'outputs', 'apps/inventory-ops']) mkdirSync(path.join(root, directory), { recursive: true })
  return root
}

function writeReceipts(root: string, options: {
  checkedAt?: string
  verifiedAt?: string
  explicitLink?: boolean
  linkBundle?: string
  status?: string
  receiptStatus?: string
  complete?: boolean
  reconciliationRequired?: boolean
  candidateBundleSha256?: string
  failureCode?: string
} = {}) {
  const checkedAt = options.checkedAt ?? '2026-09-25T15:31:00.000Z'
  const verifiedAt = options.verifiedAt ?? '2026-09-25T15:30:00.000Z'
  const receipt = {
    reportDate,
    status: options.receiptStatus ?? 'published_and_verified',
    complete: options.complete ?? true,
    verifiedAt,
    bundleSha256,
    sourceHashes: { dealerMail: dealerMailSha256 },
  }
  const status: Record<string, unknown> = {
    reportDate,
    status: options.status ?? 'intraday_holds_published_and_verified',
    checkedAt,
  }
  if (options.reconciliationRequired !== undefined) status.reconciliationRequired = options.reconciliationRequired
  if (options.candidateBundleSha256) status.candidate = { bundleSha256: options.candidateBundleSha256, dealerMailSha256 }
  if (options.failureCode) status.failureCode = options.failureCode
  if (options.explicitLink !== false) {
    status.receipt = {
      bundleSha256: options.linkBundle ?? bundleSha256,
      verifiedAt,
      dealerMailSha256,
    }
  }
  mkdirSync(path.join(root, 'work/hold-refresh-status'), { recursive: true })
  mkdirSync(path.join(root, 'work/app-feed-status'), { recursive: true })
  writeFileSync(path.join(root, `work/hold-refresh-status/${reportDate}.json`), JSON.stringify(status))
  writeFileSync(path.join(root, `work/app-feed-status/${reportDate}.json`), JSON.stringify(receipt))
}

const harness = String.raw`
param(
  [Parameter(Mandatory)][string]$MonitorPath,
  [Parameter(Mandatory)][string]$WorkspaceRoot,
  [Parameter(Mandatory)][string]$ScenarioPath,
  [Parameter(Mandatory)][string]$ResultPath
)
$ErrorActionPreference = 'Stop'
$scenario = Get-Content -LiteralPath $ScenarioPath -Raw | ConvertFrom-Json
$global:mockTaskState = [string]$scenario.initial.state
$global:mockLastResult = [int64]$scenario.initial.lastResult
$global:mockLastRunTime = [DateTimeOffset]::Parse([string]$scenario.initial.lastRunTime)
$global:mockStarted = 0
$global:mockEvents = 0
$env:OS = 'Windows_NT'

function global:Get-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  if ($scenario.missing) { throw [Management.Automation.ItemNotFoundException]::new('synthetic missing task') }
  if ($scenario.queryFails) { throw [UnauthorizedAccessException]::new('synthetic query failure') }
  [pscustomobject]@{ TaskName = $TaskName; State = $global:mockTaskState }
}
function global:Get-ScheduledTaskInfo {
  [CmdletBinding()] param([string]$TaskName)
  [pscustomobject]@{ LastTaskResult = $global:mockLastResult; LastRunTime = $global:mockLastRunTime }
}
function global:Start-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  if ($scenario.startThrows) { throw [InvalidOperationException]::new('synthetic start failure') }
  $global:mockStarted += 1
  if ($null -ne $scenario.afterStart) {
    $global:mockTaskState = [string]$scenario.afterStart.state
    $global:mockLastResult = [int64]$scenario.afterStart.lastResult
    $global:mockLastRunTime = [DateTimeOffset]::Parse([string]$scenario.afterStart.lastRunTime)
  }
}
function global:Write-EventLog {
  [CmdletBinding()] param([string]$LogName, [string]$Source, [int]$EventId, [string]$EntryType, [string]$Message)
  $global:mockEvents += 1
}

& $MonitorPath -WorkspaceRoot $WorkspaceRoot -Now ([DateTimeOffset]::Parse([string]$scenario.now)) -RecheckDelaySeconds 0
@{ started = $global:mockStarted; events = $global:mockEvents } |
  ConvertTo-Json -Compress |
  Set-Content -LiteralPath $ResultPath -Encoding utf8
`

function run(root: string, scenario: Record<string, unknown>) {
  const harnessPath = path.join(root, 'monitor-harness.ps1')
  const scenarioPath = path.join(root, 'scenario.json')
  const resultPath = path.join(root, 'result.json')
  writeFileSync(harnessPath, harness)
  writeFileSync(scenarioPath, JSON.stringify(scenario))
  const execution = spawnSync('pwsh', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', harnessPath,
    '-MonitorPath', monitorPath,
    '-WorkspaceRoot', root,
    '-ScenarioPath', scenarioPath,
    '-ResultPath', resultPath,
  ], { encoding: 'utf8' })
  expect(execution.error, 'PowerShell (pwsh) is required to exercise the real monitor').toBeUndefined()
  expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(0)
  expect(execution.stdout).toBe('')
  return JSON.parse(readFileSync(resultPath, 'utf8'))
}

const ready = (lastResult = 0, lastRunTime = '2026-09-25T11:55:00-04:00') => ({
  state: 'Ready', lastResult, lastRunTime,
})

describe('intraday hold task monitor', () => {
  it('stays silent when the completed task and explicitly linked receipts are healthy', () => {
    const root = workspace()
    writeReceipts(root)
    const result = run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(),
    })

    expect(result).toEqual({ started: 0, events: 0 })
    expect(existsSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/state.json'), 'utf8'))).toMatchObject({
      taskState: 'Ready', lastTaskResult: 0, lastTaskRunAt: '2026-09-25T15:55:00.0000000Z',
      receiptStatus: 'verified', receiptLinkMode: 'explicit',
    })
  })

  it('starts only the existing task once for a failed completed run and clears after a successful recheck', () => {
    const root = workspace()
    writeReceipts(root)
    const result = run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(1, '2026-09-25T11:25:00-04:00'),
      afterStart: ready(0, '2026-09-25T12:00:00-04:00'),
    })

    expect(result).toEqual({ started: 1, events: 0 })
    expect(existsSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'))).toBe(false)
  })

  it('alerts once after stale status survives one retry and suppresses the unchanged retry and alert', () => {
    const root = workspace()
    writeReceipts(root, {
      checkedAt: '2026-09-25T13:01:00.000Z',
      verifiedAt: '2026-09-25T13:00:00.000Z',
    })
    const first = run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(),
      afterStart: ready(1, '2026-09-25T12:00:00-04:00'),
    })
    expect(first).toEqual({ started: 1, events: 1 })
    const alertPath = path.join(root, 'work/hold-refresh-monitor/active-alert.json')
    expect(JSON.parse(readFileSync(alertPath, 'utf8'))).toMatchObject({
      code: 'intraday_hold_task_failed',
      taskName: 'BobMaxey-InventoryFlow-IntradayHolds',
      evidence: { taskPresent: true, lastTaskResult: 1 },
    })

    const second = run(root, {
      now: '2026-09-25T12:15:00-04:00',
      initial: ready(1, '2026-09-25T12:00:00-04:00'),
    })
    expect(second).toEqual({ started: 0, events: 0 })
    expect(JSON.parse(readFileSync(alertPath, 'utf8')).createdAt).toBe('2026-09-25T16:00:00.0000000Z')
  })

  it('alerts on the first reconciliation-required observation and never starts the writer for that candidate', () => {
    const root = workspace()
    const candidateHash = 'C'.repeat(64)
    writeReceipts(root, {
      status: 'intraday_holds_publication_outcome_unknown',
      reconciliationRequired: true,
      candidateBundleSha256: candidateHash,
      failureCode: 'CLOUD_PUBLICATION_ATTEMPT_IN_PROGRESS',
    })
    const scenario = {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(),
    }

    expect(run(root, scenario)).toEqual({ started: 0, events: 1 })
    const alertPath = path.join(root, 'work/hold-refresh-monitor/active-alert.json')
    expect(JSON.parse(readFileSync(alertPath, 'utf8'))).toMatchObject({
      code: 'intraday_hold_publication_reconciliation_required',
      summary: expect.stringContaining(candidateHash),
      action: expect.stringContaining(candidateHash),
      evidence: {
        reconciliationRequired: true,
        candidateBundleSha256: candidateHash,
      },
    })
    expect(JSON.parse(readFileSync(alertPath, 'utf8')).action).toContain('/internal/status')
    expect(JSON.parse(readFileSync(alertPath, 'utf8')).action).toContain('/internal/readiness')

    expect(run(root, { ...scenario, now: '2026-09-25T12:15:00-04:00' })).toEqual({ started: 0, events: 0 })
    expect(readdirSync(path.join(root, 'work/hold-refresh-monitor/alerts'))).toHaveLength(1)
  })

  it('uses the cross-date publisher marker as authoritative and never starts the writer', () => {
    const root = workspace()
    const candidateHash = 'E'.repeat(64)
    writeReceipts(root)
    writeFileSync(path.join(root, 'work/app-feed-status/publication-reconciliation.json'), JSON.stringify({
      schemaVersion: 1,
      status: 'publication_reconciliation_required',
      reconciliationRequired: true,
      reportDate: '2026-09-24',
      failureCode: 'CLOUD_PUBLICATION_OUTCOME_UNKNOWN',
      recordedAt: '2026-09-24T20:00:00.000Z',
      candidate: {
        bundleSha256: candidateHash,
        holdRefresh: false,
        sourceHashes: {
          public: '1'.repeat(64), dealerMail: '2'.repeat(64), resources: '3'.repeat(64),
          managerDisposition: null, managerDispositionBinding: null,
        },
      },
    }))

    const result = run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(1, '2026-09-25T11:25:00-04:00'),
    })

    expect(result).toEqual({ started: 0, events: 1 })
    expect(JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'), 'utf8'))).toMatchObject({
      code: 'intraday_hold_publication_reconciliation_required',
      summary: expect.stringContaining(candidateHash),
      evidence: {
        reconciliationRequired: true,
        reconciliationSource: 'global_marker',
        candidateBundleSha256: candidateHash,
      },
    })
  })

  it('fails closed on a malformed cross-date publisher marker without starting the writer', () => {
    const root = workspace()
    writeReceipts(root)
    writeFileSync(path.join(root, 'work/app-feed-status/publication-reconciliation.json'), '{truncated marker')

    expect(run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(1, '2026-09-25T11:25:00-04:00'),
    })).toEqual({ started: 0, events: 1 })
    const alert = JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'), 'utf8'))
    expect(alert).toMatchObject({
      code: 'intraday_hold_publication_reconciliation_required',
      evidence: { reconciliationRequired: true, reconciliationSource: 'global_marker' },
    })
    expect(alert.evidence.reasons).toContain('publication_reconciliation_marker_invalid')
    expect(alert.evidence.reasons).toContain('candidate_bundle_hash_missing_or_invalid')
  })

  it.each(['missing', 'corrupt'])('uses the reconciliation manifest when hold status is %s and never starts the writer', (statusCondition) => {
    const root = workspace()
    const candidateHash = 'D'.repeat(64)
    writeReceipts(root)
    const statusPath = path.join(root, `work/hold-refresh-status/${reportDate}.json`)
    if (statusCondition === 'missing') rmSync(statusPath)
    else writeFileSync(statusPath, '{truncated reconciliation status')
    const manifestPath = path.join(root, `work/run-status/${reportDate}.json`)
    mkdirSync(path.dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify({
      report_date: reportDate,
      cloudflare_publish: {
        status: 'publication_outcome_unknown',
        reconciliation_required: true,
        expected_bundle_sha256: candidateHash,
      },
    }))
    const scenario = {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(),
    }

    expect(run(root, scenario)).toEqual({ started: 0, events: 1 })
    const alertPath = path.join(root, 'work/hold-refresh-monitor/active-alert.json')
    expect(JSON.parse(readFileSync(alertPath, 'utf8'))).toMatchObject({
      code: 'intraday_hold_publication_reconciliation_required',
      action: expect.stringContaining(candidateHash),
      evidence: {
        reconciliationRequired: true,
        reconciliationSource: 'manifest',
        candidateBundleSha256: candidateHash,
      },
    })
    expect(run(root, { ...scenario, now: '2026-09-25T12:15:00-04:00' })).toEqual({ started: 0, events: 0 })
    expect(readdirSync(path.join(root, 'work/hold-refresh-monitor/alerts'))).toHaveLength(1)
  })

  it('treats an explicit receipt-link mismatch as unverified and alerts after one repair attempt', () => {
    const root = workspace()
    writeReceipts(root, { linkBundle: 'C'.repeat(64) })
    const result = run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(),
      afterStart: ready(0, '2026-09-25T12:00:00-04:00'),
    })

    expect(result).toEqual({ started: 1, events: 1 })
    const alert = JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'), 'utf8'))
    expect(alert.code).toBe('intraday_hold_status_unverified')
    expect(alert.evidence.reasons).toContain('receipt_bundle_link_mismatch')
  })

  it('accepts the rollout schema only when its receipt timestamp immediately precedes the hold status', () => {
    const root = workspace()
    writeReceipts(root, { explicitLink: false })
    expect(run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(),
    })).toEqual({ started: 0, events: 0 })
    expect(JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/state.json'), 'utf8')).receiptLinkMode).toBe('temporal_legacy')
  })

  it('does not start the writer outside the operating window and does not age out a valid end-of-day receipt', () => {
    const root = workspace()
    writeReceipts(root, {
      checkedAt: '2026-09-25T13:01:00.000Z',
      verifiedAt: '2026-09-25T13:00:00.000Z',
    })
    const result = run(root, {
      now: '2026-09-25T20:00:00-04:00',
      initial: ready(0, '2026-09-25T19:25:00-04:00'),
    })

    expect(result).toEqual({ started: 0, events: 0 })
    expect(existsSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'))).toBe(false)
  })

  it('waits quietly when the writer is already running', () => {
    const root = workspace()
    writeReceipts(root, {
      checkedAt: '2026-09-25T13:01:00.000Z',
      verifiedAt: '2026-09-25T13:00:00.000Z',
    })
    expect(run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: { state: 'Running', lastResult: 1, lastRunTime: '2026-09-25T11:59:00-04:00' },
    })).toEqual({ started: 0, events: 0 })
    expect(existsSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'))).toBe(false)
  })

  it('does not restart the same recovery run when it later completes unsuccessfully', () => {
    const root = workspace()
    writeReceipts(root, {
      checkedAt: '2026-09-25T13:01:00.000Z',
      verifiedAt: '2026-09-25T13:00:00.000Z',
    })
    const first = run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: ready(),
      afterStart: { state: 'Running', lastResult: 267009, lastRunTime: '2026-09-25T12:00:00-04:00' },
    })
    expect(first).toEqual({ started: 1, events: 0 })
    const recoveryState = JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/state.json'), 'utf8'))
    expect(recoveryState).toMatchObject({
      lastRecoveryTaskRunAt: '2026-09-25T16:00:00.0000000Z',
      taskState: 'Running',
    })
    expect(recoveryState.lastRecoveryReceiptFingerprint).toMatch(/^[a-f0-9]{64}$/)

    // The failed recovery may rewrite status evidence before Task Scheduler
    // exposes its final result. That new fingerprint must not permit a second
    // start of the exact same recovery run.
    writeReceipts(root, {
      checkedAt: '2026-09-25T13:02:00.000Z',
      verifiedAt: '2026-09-25T13:00:00.000Z',
      status: 'intraday_holds_publication_outcome_unknown',
    })
    const second = run(root, {
      now: '2026-09-25T12:15:00-04:00',
      initial: ready(1, '2026-09-25T12:00:00-04:00'),
    })
    expect(second).toEqual({ started: 0, events: 1 })
    expect(first.started + second.started).toBe(1)
  })

  it('alerts when the task is disabled even if its last receipt is fresh', () => {
    const root = workspace()
    writeReceipts(root)
    expect(run(root, {
      now: '2026-09-25T12:00:00-04:00',
      initial: { state: 'Disabled', lastResult: 0, lastRunTime: '2026-09-25T11:55:00-04:00' },
    })).toEqual({ started: 0, events: 1 })
    expect(JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'), 'utf8'))).toMatchObject({
      code: 'intraday_hold_task_unavailable',
      action: expect.stringContaining('enable or repair'),
    })
  })

  it('creates one actionable alert when the required task is missing', () => {
    const root = workspace()
    writeReceipts(root)
    const scenario = {
      now: '2026-09-25T12:00:00-04:00',
      missing: true,
      initial: ready(),
    }
    expect(run(root, scenario)).toEqual({ started: 0, events: 1 })
    expect(run(root, scenario)).toEqual({ started: 0, events: 0 })
    expect(JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'), 'utf8'))).toMatchObject({
      code: 'intraday_hold_task_missing',
      action: expect.stringContaining('Register the existing intraday hold-refresh task'),
    })
  })

  it('distinguishes a scheduler query failure from a missing task', () => {
    const root = workspace()
    writeReceipts(root)
    expect(run(root, {
      now: '2026-09-25T12:00:00-04:00',
      queryFails: true,
      initial: ready(),
    })).toEqual({ started: 0, events: 1 })
    expect(JSON.parse(readFileSync(path.join(root, 'work/hold-refresh-monitor/active-alert.json'), 'utf8'))).toMatchObject({
      code: 'intraday_hold_task_query_failed',
      action: expect.stringContaining('Task Scheduler service'),
      evidence: { taskQueryFailed: true },
    })
  })

  it('alerts without retrying when the task remains failed after the operating window', () => {
    const root = workspace()
    writeReceipts(root)
    expect(run(root, {
      now: '2026-09-25T20:00:00-04:00',
      initial: ready(9, '2026-09-25T19:25:00-04:00'),
    })).toEqual({ started: 0, events: 1 })
  })
})

describe('intraday hold monitor registration safety', () => {
  it('can start only the named existing task and never invokes a capture or publisher', () => {
    const monitor = readFileSync(monitorPath, 'utf8')
    expect(monitor).toContain("$TargetTaskName = 'BobMaxey-InventoryFlow-IntradayHolds'")
    expect(monitor.match(/Start-ScheduledTask/g)).toHaveLength(1)
    expect(monitor).toContain('Start-ScheduledTask -TaskName $TargetTaskName')
    expect(monitor).not.toMatch(/run-inventory-flow-daily\.mjs|daily-cloud-publish\.ps1|capture-dealermail\.mjs|publish-cloud-release\.mjs|Invoke-Expression|Start-Process/i)
  })

  it('registers a separate limited-user monitor on the post-writer cadence', () => {
    const registration = readFileSync(registerPath, 'utf8')
    expect(registration).toContain("$TaskName = 'BobMaxey-InventoryFlow-IntradayHolds-Monitor'")
    expect(registration).toContain("Get-ScheduledTask -TaskName 'BobMaxey-InventoryFlow-IntradayHolds'")
    expect(registration).toContain("Join-Path $PSScriptRoot 'monitor-intraday-hold-refresh.ps1'")
    expect(registration).toContain('-Hour 9 -Minute 42')
    expect(registration).toContain('New-TimeSpan -Minutes 15')
    expect(registration).toContain('-LogonType Interactive')
    expect(registration).toContain('-RunLevel Limited')
    expect(registration).not.toMatch(/run-inventory-flow-daily\.mjs|daily-cloud-publish\.ps1|capture-dealermail\.mjs|publish-cloud-release\.mjs/i)
  })
})
