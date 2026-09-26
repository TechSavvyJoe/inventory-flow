// @vitest-environment node
// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const reportDate = '2026-09-25'
const roots: string[] = []
const receipt = {
  status: 'published_and_verified', reportDate, bundleSha256: 'a'.repeat(64),
  verifiedAt: `${reportDate}T14:00:00Z`, sourceHashes: { managerDispositionBinding: null },
  counts: { publicRowCount: 4, publicStoreCounts: { Howell: 1, Fowlerville: 1, 'Ford Detroit': 1, Lincoln: 1 } },
}

// Execute the actual publisher in a child PowerShell session. All native helpers
// and the browser probe are intercepted before the script starts; only the
// temporary synthetic workspace and synthetic SecureString are ever opened.
const harness = String.raw`
param([string]$AppRoot, [string]$WorkspaceRoot, [string]$ScenarioPath)
$ErrorActionPreference = 'Stop'
$global:HarnessScenario = Get-Content -LiteralPath $ScenarioPath -Raw | ConvertFrom-Json
$env:USERPROFILE = $global:HarnessScenario.profile
$env:INVENTORY_TEST_EXISTING_SECRET = 'synthetic-before'
Remove-Item -LiteralPath 'Env:INVENTORY_TEST_NEW_SECRET' -ErrorAction SilentlyContinue
if ((Test-Path -LiteralPath 'Env:INVENTORY_TEST_NEW_SECRET') -or
    $null -ne [System.Environment]::GetEnvironmentVariable('INVENTORY_TEST_NEW_SECRET')) {
  throw 'SYNTHETIC_ABSENT_ENVIRONMENT_PRECONDITION_FAILED'
}
$syntheticSecrets = @{
  INVENTORY_TEST_EXISTING_SECRET = 'synthetic-loaded'
  INVENTORY_TEST_NEW_SECRET = 'synthetic-added'
}
# Empty environment values became supported in PowerShell 7.5. Verify their
# restoration there without treating an empty value as an absent variable.
$supportsEmptyEnvironmentValues = $PSVersionTable.PSVersion.Major -gt 7 -or
  ($PSVersionTable.PSVersion.Major -eq 7 -and $PSVersionTable.PSVersion.Minor -ge 5)
if ($supportsEmptyEnvironmentValues) {
  $env:INVENTORY_TEST_EMPTY_SECRET = ''
  if (-not (Test-Path -LiteralPath 'Env:INVENTORY_TEST_EMPTY_SECRET') -or
      '' -cne [System.Environment]::GetEnvironmentVariable('INVENTORY_TEST_EMPTY_SECRET')) {
    throw 'SYNTHETIC_EMPTY_ENVIRONMENT_PRECONDITION_FAILED'
  }
  $syntheticSecrets.INVENTORY_TEST_EMPTY_SECRET = 'synthetic-empty-loaded'
}
if ($global:HarnessScenario.secretPresent) {
  $syntheticSecrets | ConvertTo-Json -Compress | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString |
    Set-Content -NoNewline -LiteralPath (Join-Path $AppRoot 'runtime/cloud-secrets/publisher.dpapi')
}
if ($global:HarnessScenario.lockPresent) {
  Set-Content -NoNewline -LiteralPath (Join-Path $WorkspaceRoot 'work/app-feed-status/.publication.lock') -Value '{"pid":999999,"ownerId":"synthetic-other-task"}'
}

function global:Get-Command {
  param([string]$Name, [string]$ErrorAction)
  if ($Name -notin @('node', 'python')) { throw 'UNEXPECTED_COMMAND_LOOKUP' }
  [pscustomobject]@{ Source = 'Invoke-SyntheticNative' }
}
function global:Invoke-WebRequest { throw 'SYNTHETIC_BROWSER_OFFLINE' }
function global:Invoke-SyntheticNative {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$HelperArguments)
  $global:LASTEXITCODE = 9
  $helper = ($HelperArguments[0].Replace('\', '/').Split('/'))[-1]
  $event = [ordered]@{
    helper = $helper
    arguments = @($HelperArguments | Select-Object -Skip 1)
    credentialsLoaded = ($env:INVENTORY_TEST_EXISTING_SECRET -eq 'synthetic-loaded' -and
      $env:INVENTORY_TEST_NEW_SECRET -eq 'synthetic-added' -and
      (-not $supportsEmptyEnvironmentValues -or $env:INVENTORY_TEST_EMPTY_SECRET -eq 'synthetic-empty-loaded'))
  }
  $event | ConvertTo-Json -Compress | Add-Content -LiteralPath $global:HarnessScenario.events
  switch ($helper) {
    'sync-cloud-release.mjs' {
      $global:HarnessScenario.receipt | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $global:HarnessScenario.receiptPath
      $global:LASTEXITCODE = 0
      '{"status":"published_and_verified"}'
    }
    'publish-invoice-documents.mjs' {
      $global:LASTEXITCODE = $global:HarnessScenario.invoiceExit
      if ($global:LASTEXITCODE -eq 0) { '{"stored":0,"alreadyStored":1}' }
      else { 'INVOICE_PUBLISH_REJECTED' }
    }
    'verify-integration-deployment.mjs' {
      $global:LASTEXITCODE = $global:HarnessScenario.integrationExit
      if ($global:LASTEXITCODE -eq 0) { '{"verified":true}' }
      else { 'INTEGRATION_VERIFICATION_FAILED' }
    }
    { $_ -in @('cache-vauto-equipment-pdfs.py', 'capture-warranty.mjs',
      'build_vin_document_enrichment.py', 'merge-ford-service-history.mjs',
      'merge-vauto-autocheck.mjs', 'merge-invoice-metadata.mjs',
      'dryrun_resource_enrichment_check.mjs', 'advance_latest_pointer.py',
      'archive-inventory-history.mjs') } {
      $global:LASTEXITCODE = 0
      '{"synthetic":true}'
    }
    default { throw 'UNEXPECTED_NATIVE_HELPER' }
  }
}

$beforeLocation = (Get-Location).Path
& (Join-Path $AppRoot 'scripts/daily-cloud-publish.ps1') -ReportDate '2026-09-25' -WorkspaceRoot $WorkspaceRoot -SkipPhotoCache -Force:$global:HarnessScenario.force
$publisherExit = $LASTEXITCODE
[ordered]@{
  exitCode = $publisherExit
  existingSecretRestored = ($env:INVENTORY_TEST_EXISTING_SECRET -eq 'synthetic-before')
  newSecretRemoved = (-not (Test-Path -LiteralPath 'Env:INVENTORY_TEST_NEW_SECRET') -and
    $null -eq [System.Environment]::GetEnvironmentVariable('INVENTORY_TEST_NEW_SECRET'))
  supportsEmptyEnvironmentValues = $supportsEmptyEnvironmentValues
  emptySecretRestored = if ($supportsEmptyEnvironmentValues) {
    (Test-Path -LiteralPath 'Env:INVENTORY_TEST_EMPTY_SECRET') -and
      '' -ceq [System.Environment]::GetEnvironmentVariable('INVENTORY_TEST_EMPTY_SECRET')
  } else { $null }
  locationRestored = ((Get-Location).Path -eq $beforeLocation)
} | ConvertTo-Json | Set-Content -LiteralPath $global:HarnessScenario.result
exit $publisherExit
`

function fixture(cached = false) {
  const root = mkdtempSync(path.join(tmpdir(), 'inventory publisher retry '))
  roots.push(root)
  const appRoot = path.join(root, 'app')
  const workspaceRoot = path.join(root, 'workspace')
  for (const directory of [
    path.join(appRoot, 'scripts'), path.join(appRoot, 'runtime/cloud-secrets'),
    path.join(appRoot, 'runtime/integration-credentials'), path.join(root, 'profile'),
    ...['work/run-status', 'work/app-feed-status', 'outputs', 'apps/inventory-ops'].map(part => path.join(workspaceRoot, part)),
  ]) mkdirSync(directory, { recursive: true })
  copyFileSync(fileURLToPath(new URL('../../scripts/daily-cloud-publish.ps1', import.meta.url)), path.join(appRoot, 'scripts/daily-cloud-publish.ps1'))
  writeFileSync(path.join(appRoot, 'runtime/integration-credentials/joe-app-development.json'), '{}')
  const manifestPath = path.join(workspaceRoot, 'work/run-status', `${reportDate}.json`)
  const receiptPath = path.join(workspaceRoot, 'work/app-feed-status', `${reportDate}.json`)
  writeFileSync(manifestPath, JSON.stringify({ complete: true, report_date: reportDate, manager_disposition_overlay: null }))
  if (cached) writeFileSync(receiptPath, JSON.stringify(receipt))
  const harnessPath = path.join(root, 'harness.ps1')
  writeFileSync(harnessPath, harness)
  const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8'))
  let runNumber = 0
  function run(options: { invoiceExit?: number; integrationExit?: number; secretPresent?: boolean; force?: boolean; lockPresent?: boolean } = {}) {
    const prefix = path.join(root, `attempt-${++runNumber}`)
    const scenario = {
      profile: path.join(root, 'profile'), events: `${prefix}.events`, result: `${prefix}.result`,
      receipt, receiptPath, invoiceExit: 0, integrationExit: 0, secretPresent: true, force: false, lockPresent: false, ...options,
    }
    const scenarioPath = `${prefix}.json`
    writeFileSync(scenarioPath, JSON.stringify(scenario))
    const execution = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', harnessPath,
      '-AppRoot', appRoot, '-WorkspaceRoot', workspaceRoot, '-ScenarioPath', scenarioPath], {
      encoding: 'utf8', timeout: 25_000, cwd: root,
    })
    expect(execution.error, 'PowerShell (pwsh) is required to exercise the real daily publisher').toBeUndefined()
    const output = execution.stdout + execution.stderr
    expect(existsSync(scenario.result), output).toBe(true)
    const result = JSON.parse(readFileSync(scenario.result, 'utf8'))
    expect(result).toMatchObject({ existingSecretRestored: true, newSecretRemoved: true, locationRestored: true })
    if (result.supportsEmptyEnvironmentValues) expect(result.emptySecretRestored).toBe(true)
    else expect(result.emptySecretRestored).toBeNull()
    expect(execution.status).toBe(result.exitCode)
    expect(output).not.toMatch(/synthetic-before|synthetic-loaded|synthetic-added|synthetic-empty-loaded/)
    const events: { helper: string; arguments: string[]; credentialsLoaded: boolean }[] = existsSync(scenario.events)
      ? readFileSync(scenario.events, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line)) : []
    expect(events.every(event => event.credentialsLoaded)).toBe(true)
    return { output, events, helpers: events.map(event => event.helper), exitCode: result.exitCode }
  }
  return { run, readManifest, receiptPath, appRoot }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('daily PowerShell publisher document retries', () => {
  it('retries a failed invoice after the receipt was saved without recapturing or republishing sources', () => {
    const test = fixture()
    const first = test.run({ invoiceExit: 1 })
    expect(first.exitCode).toBe(1)
    expect(first.helpers.slice(-2), first.output).toEqual(['sync-cloud-release.mjs', 'publish-invoice-documents.mjs'])
    expect(first.output).toContain('INVOICE_DOCUMENT_PUBLISH_FAILED')
    expect(first.output).toContain('RELEASE PUBLISHED; FOLLOWUPS FAILED')
    expect(first.output).not.toMatch(/SUCCESS|SKIPPED/)
    expect(test.readManifest()).not.toHaveProperty('cloudflare_publish')
    const savedReceipt = readFileSync(test.receiptPath, 'utf8')
    expect(JSON.parse(savedReceipt)).toEqual(receipt)

    const retry = test.run()
    expect(retry.exitCode, retry.output).toBe(0)
    expect(retry.helpers).toEqual(['publish-invoice-documents.mjs', 'verify-integration-deployment.mjs',
      'advance_latest_pointer.py', 'archive-inventory-history.mjs'])
    expect(retry.events[0].arguments).toEqual([reportDate])
    expect(retry.output).toContain('"alreadyStored":1')
    expect(retry.output).toContain('SKIPPED (already current)')
    expect(readFileSync(test.receiptPath, 'utf8')).toBe(savedReceipt)
    expect(test.readManifest()).toMatchObject({ latest_pointers_advanced: true, cloudflare_publish: { status: 'published_and_verified' } })
  }, 60_000)

  it('fails a cached-receipt invoice retry before integration, pointers, archive, or success', () => {
    const test = fixture(true)
    const result = test.run({ invoiceExit: 1 })
    expect(result.exitCode).toBe(1)
    expect(result.helpers, result.output).toEqual(['publish-invoice-documents.mjs'])
    expect(result.output).toContain('RELEASE PUBLISHED; FOLLOWUPS FAILED')
    expect(result.output).not.toMatch(/SUCCESS|SKIPPED/)
    expect(test.readManifest()).not.toHaveProperty('latest_pointers_advanced')
    expect(existsSync(path.join(test.appRoot, 'runtime/integration-expected-release.json'))).toBe(false)
  }, 30_000)

  it('requires successful integration verification after a cached invoice retry before completion', () => {
    const test = fixture(true)
    const result = test.run({ integrationExit: 1 })
    expect(result.exitCode).toBe(1)
    expect(result.helpers, result.output).toEqual(['publish-invoice-documents.mjs', 'verify-integration-deployment.mjs'])
    expect(result.output).not.toMatch(/SUCCESS|SKIPPED/)
    expect(test.readManifest()).not.toHaveProperty('cloudflare_publish')
  }, 30_000)

  it('fails closed when cached publication has no publisher secret bundle', () => {
    const test = fixture(true)
    const result = test.run({ secretPresent: false })
    expect(result.exitCode).toBe(1)
    expect(result.helpers).toEqual([])
    expect(result.output).toContain('SECRET_STORE_MISSING')
    expect(result.output).not.toMatch(/SUCCESS|SKIPPED/)
  }, 30_000)

  it('serializes the whole publisher behind the shared pipeline lock', () => {
    const test = fixture(true)
    const result = test.run({ lockPresent: true })
    expect(result.exitCode).toBe(1)
    expect(result.helpers).toEqual([])
    expect(result.output).toContain('PUBLICATION_WRITER_ACTIVE_OR_LOCK_REQUIRES_REVIEW')
  }, 30_000)

  it('keeps an explicit forced republish on the normal path and runs the same follow-ups', () => {
    const test = fixture(true)
    const result = test.run({ force: true })
    expect(result.exitCode, result.output).toBe(0)
    expect(result.helpers.slice(-5)).toEqual(['sync-cloud-release.mjs', 'publish-invoice-documents.mjs',
      'verify-integration-deployment.mjs', 'advance_latest_pointer.py', 'archive-inventory-history.mjs'])
    expect(result.output).toContain('SUCCESS')
    expect(result.output).not.toContain('SKIPPED')
  }, 30_000)
})
