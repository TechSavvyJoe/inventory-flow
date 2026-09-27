// @vitest-environment node
// Publisher-secret handoff between Windows hosts (scripts/lib/secret-handoff.psm1
// and the Export/Accept/Check modes of scripts/cloud-secret-store.ps1). Every
// value here is synthetic; the harness prints only booleans, codes and error
// codes, never a secret value.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const scriptsDir = fileURLToPath(new URL('../../scripts/', import.meta.url))
const modulePath = path.join(scriptsDir, 'lib', 'secret-handoff.psm1')
const roots: string[] = []

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'inventory-secret-handoff-'))
  roots.push(root)
  return root
}

function runPwsh(script: string, args: string[]) {
  const root = tempRoot()
  const harness = path.join(root, 'harness.ps1')
  writeFileSync(harness, script)
  const run = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', harness, ...args], { encoding: 'utf8', timeout: 180_000 })
  expect(run.error, 'PowerShell (pwsh) is required to exercise the secret handoff').toBeUndefined()
  expect(run.status, run.stderr).toBe(0)
  return { root, results: JSON.parse(run.stdout.trim().split(/\r?\n/).pop() ?? '{}') as Record<string, unknown> }
}

afterAll(() => {
  for (const root of roots.splice(0)) {
    if (!path.basename(root).startsWith('inventory-secret-handoff-')) throw new Error('Unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

const MODULE_HARNESS = String.raw`
param([Parameter(Mandatory)][string]$ModulePath)
$ErrorActionPreference = 'Stop'
Import-Module $ModulePath -Force
function Get-ErrorCode([scriptblock]$Block) {
  try { & $Block | Out-Null; return 'OK' } catch { return ([string]$_.Exception.Message).Split(':')[0] }
}
function Get-PublicKey($rsa) { [Convert]::ToBase64String($rsa.ExportSubjectPublicKeyInfo()) }
function Edit-Field([string]$json, [string]$field) {
  $envelope = $json | ConvertFrom-Json -AsHashtable
  $bytes = [Convert]::FromBase64String($envelope[$field]); $bytes[0] = $bytes[0] -bxor 0x01
  $envelope[$field] = [Convert]::ToBase64String($bytes)
  return ($envelope | ConvertTo-Json -Compress)
}
$recipient = [System.Security.Cryptography.RSA]::Create(3072)
$stranger = [System.Security.Cryptography.RSA]::Create(3072)
$small = [System.Security.Cryptography.RSA]::Create(2048)
$public = Get-PublicKey $recipient
$settings = [ordered]@{
  INVENTORY_OPS_CLOUD_URL = 'https://synthetic.invalid'
  INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN = 'SYNTHETIC-PUBLISHER-TOKEN-7F3A'
  INVENTORY_OPS_RELEASE_ENCRYPTION_KEY_BASE64 = 'U1lOVEhFVElDLUtFWS1OT1QtUkVBTA=='
}
$fileText = '{"client":"SYNTHETIC-CLIENT","secret":"SYNTHETIC-FILE-SECRET","note":"café"}'
$files = @{ 'synthetic-probe.json' = [Text.Encoding]::UTF8.GetBytes($fileText) }
$envelope = New-SecretHandoff -Settings $settings -Files $files -PublicKeyBase64 $public
$opened = Read-SecretHandoff -Json $envelope -PrivateKey $recipient
$parsed = $envelope | ConvertFrom-Json -AsHashtable
$senderCode = Get-HandoffTransferCode -Settings $settings -Files $files
$receiverCode = Get-HandoffTransferCode -Settings $opened.Settings -Files $opened.Files
$keys = [string[]]@($settings.Keys); [Array]::Reverse($keys)
$reversed = [ordered]@{}; foreach ($name in $keys) { $reversed[$name] = $settings[$name] }
$changed = [ordered]@{}; foreach ($name in $settings.Keys) { $changed[$name] = $settings[$name] }
$changed.INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN = 'SYNTHETIC-PUBLISHER-TOKEN-7F3B'
$forged = New-SecretHandoff -Settings $changed -Files $files -PublicKeyBase64 $public
$forgedOpened = Read-SecretHandoff -Json $forged -PrivateKey $recipient
$retargeted = $envelope | ConvertFrom-Json -AsHashtable; $retargeted.recipient = Get-HandoffKeyFingerprint -PublicKeyBase64 (Get-PublicKey $stranger)
$legacy = [ordered]@{}
foreach ($name in $settings.Keys) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($settings[$name]); $parts = @()
  for ($offset = 0; $offset -lt $bytes.Length; $offset += 16) {
    $chunk = $bytes[$offset..([Math]::Min($offset + 15, $bytes.Length - 1))]
    $parts += [Convert]::ToBase64String($recipient.Encrypt([byte[]]$chunk, [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256))
  }
  $legacy[$name] = $parts
}
$legacyOpened = Read-SecretHandoff -Json ($legacy | ConvertTo-Json -Compress) -PrivateKey $recipient
$settingsMatch = $opened.Settings.Count -eq $settings.Count
foreach ($name in $settings.Keys) { if ($opened.Settings[$name] -cne $settings[$name]) { $settingsMatch = $false } }
$legacyMatch = $legacyOpened.Settings.Count -eq $settings.Count
foreach ($name in $settings.Keys) { if ($legacyOpened.Settings[$name] -cne $settings[$name]) { $legacyMatch = $false } }
$leaks = @($settings.Values) + @('SYNTHETIC-FILE-SECRET', 'SYNTHETIC-CLIENT') | Where-Object { $envelope.Contains($_) }
[ordered]@{
  format = $parsed.format
  recipientMatches = $parsed.recipient -ceq (Get-HandoffKeyFingerprint -PublicKeyBase64 $public)
  fingerprintShape = (Get-HandoffKeyFingerprint -PublicKeyBase64 $public) -cmatch '^SHA256:[0-9A-F]{4}(-[0-9A-F]{4}){3}$'
  settingsMatch = $settingsMatch
  fileMatches = [Text.Encoding]::UTF8.GetString($opened.Files['synthetic-probe.json']) -ceq $fileText
  openedFormat = $opened.Format
  envelopeLeaks = @($leaks).Count
  codeShape = $senderCode -cmatch '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  codesMatch = $senderCode -ceq $receiverCode
  codeOrderIndependent = $senderCode -ceq (Get-HandoffTransferCode -Settings $reversed -Files $files)
  codeDetectsChange = $senderCode -cne (Get-HandoffTransferCode -Settings $changed -Files $files)
  codeDetectsFileChange = $senderCode -cne (Get-HandoffTransferCode -Settings $settings -Files @{ 'synthetic-probe.json' = [Text.Encoding]::UTF8.GetBytes($fileText + ' ') })
  forgedOpens = $forgedOpened.Settings.Count -eq $settings.Count
  forgedCodeDiffers = $senderCode -cne (Get-HandoffTransferCode -Settings $forgedOpened.Settings -Files $forgedOpened.Files)
  wrongRecipient = Get-ErrorCode { Read-SecretHandoff -Json $envelope -PrivateKey $stranger }
  retargetedEnvelope = Get-ErrorCode { Read-SecretHandoff -Json ($retargeted | ConvertTo-Json -Compress) -PrivateKey $stranger }
  tamperedCiphertext = Get-ErrorCode { Read-SecretHandoff -Json (Edit-Field $envelope 'ciphertext') -PrivateKey $recipient }
  tamperedTag = Get-ErrorCode { Read-SecretHandoff -Json (Edit-Field $envelope 'tag') -PrivateKey $recipient }
  tamperedNonce = Get-ErrorCode { Read-SecretHandoff -Json (Edit-Field $envelope 'nonce') -PrivateKey $recipient }
  smallKey = Get-ErrorCode { New-SecretHandoff -Settings $settings -Files $files -PublicKeyBase64 (Get-PublicKey $small) }
  invalidKey = Get-ErrorCode { New-SecretHandoff -Settings $settings -Files $files -PublicKeyBase64 'not-a-key' }
  lowercaseName = Get-ErrorCode { New-SecretHandoff -Settings @{ token = 'x' } -Files @{} -PublicKeyBase64 $public }
  hyphenName = Get-ErrorCode { New-SecretHandoff -Settings @{ 'BAD-NAME' = 'x' } -Files @{} -PublicKeyBase64 $public }
  shortName = Get-ErrorCode { New-SecretHandoff -Settings @{ A = 'x' } -Files @{} -PublicKeyBase64 $public }
  oversizedValue = Get-ErrorCode { New-SecretHandoff -Settings @{ BIG_VALUE = ('x' * 8193) } -Files @{} -PublicKeyBase64 $public }
  traversalFile = Get-ErrorCode { New-SecretHandoff -Settings @{} -Files @{ '..\x.json' = [byte[]](1) } -PublicKeyBase64 $public }
  slashFile = Get-ErrorCode { New-SecretHandoff -Settings @{} -Files @{ 'a/b.json' = [byte[]](1) } -PublicKeyBase64 $public }
  driveFile = Get-ErrorCode { New-SecretHandoff -Settings @{} -Files @{ 'C:\x.json' = [byte[]](1) } -PublicKeyBase64 $public }
  wrongExtension = Get-ErrorCode { New-SecretHandoff -Settings @{} -Files @{ 'probe.txt' = [byte[]](1) } -PublicKeyBase64 $public }
  uppercaseFile = Get-ErrorCode { New-SecretHandoff -Settings @{} -Files @{ 'Probe.json' = [byte[]](1) } -PublicKeyBase64 $public }
  emptyFile = Get-ErrorCode { New-SecretHandoff -Settings @{} -Files @{ 'probe.json' = [byte[]]@() } -PublicKeyBase64 $public }
  oversizedFile = Get-ErrorCode { New-SecretHandoff -Settings @{} -Files @{ 'probe.json' = [byte[]]::new(65537) } -PublicKeyBase64 $public }
  malformed = Get-ErrorCode { Read-SecretHandoff -Json '{not json' -PrivateKey $recipient }
  unsupportedFormat = Get-ErrorCode { Read-SecretHandoff -Json '{"format":"inventory-flow-secret-handoff-v9"}' -PrivateKey $recipient }
  legacyMatch = $legacyMatch
  legacyFormat = $legacyOpened.Format
  legacyFiles = $legacyOpened.Files.Count
  legacyInvalidName = Get-ErrorCode { Read-SecretHandoff -Json '{"lower":["AAAA"]}' -PrivateKey $recipient }
} | ConvertTo-Json -Compress
`

describe('publisher secret handoff envelope', () => {
  let results: Record<string, unknown>
  beforeAll(() => { results = runPwsh(MODULE_HARNESS, ['-ModulePath', modulePath]).results }, 200_000)

  it('round-trips settings and credential files only for the recipient key', () => {
    expect(results.format).toBe('inventory-flow-secret-handoff-v2')
    expect(results.recipientMatches).toBe(true)
    expect(results.fingerprintShape).toBe(true)
    expect(results.settingsMatch).toBe(true)
    expect(results.fileMatches).toBe(true)
    expect(results.openedFormat).toBe('v2')
  })

  it('never carries a plaintext value in the envelope', () => {
    expect(results.envelopeLeaks).toBe(0)
  })

  it('prints the same order-independent transfer code on both PCs and changes it for any altered value', () => {
    expect(results.codeShape).toBe(true)
    expect(results.codesMatch).toBe(true)
    expect(results.codeOrderIndependent).toBe(true)
    expect(results.codeDetectsChange).toBe(true)
    expect(results.codeDetectsFileChange).toBe(true)
  })

  it('exposes an envelope forged with the public key through a different transfer code', () => {
    expect(results.forgedOpens).toBe(true)
    expect(results.forgedCodeDiffers).toBe(true)
  })

  it('opens only on the intended PC and rejects any tampering', () => {
    expect(results.wrongRecipient).toBe('HANDOFF_NOT_FOR_THIS_PC')
    expect(results.retargetedEnvelope).toBe('HANDOFF_DECRYPTION_FAILED')
    expect(results.tamperedCiphertext).toBe('HANDOFF_DECRYPTION_FAILED')
    expect(results.tamperedTag).toBe('HANDOFF_DECRYPTION_FAILED')
    expect(results.tamperedNonce).toBe('HANDOFF_DECRYPTION_FAILED')
  })

  it('refuses weak or invalid recipient keys', () => {
    expect(results.smallKey).toBe('HANDOFF_KEY_TOO_SMALL')
    expect(results.invalidKey).toBe('HANDOFF_PUBLIC_KEY_INVALID')
  })

  it('refuses setting names and credential file names that could escape their place', () => {
    for (const key of ['lowercaseName', 'hyphenName', 'shortName']) expect(results[key], key).toBe('HANDOFF_INVALID_SETTING_NAME')
    expect(results.oversizedValue).toBe('HANDOFF_INVALID_SETTING_VALUE')
    for (const key of ['traversalFile', 'slashFile', 'driveFile', 'wrongExtension', 'uppercaseFile']) expect(results[key], key).toBe('HANDOFF_INVALID_FILE_NAME')
    expect(results.emptyFile).toBe('HANDOFF_INVALID_FILE_CONTENT')
    expect(results.oversizedFile).toBe('HANDOFF_INVALID_FILE_CONTENT')
  })

  it('rejects malformed input and unknown formats', () => {
    expect(results.malformed).toBe('HANDOFF_MALFORMED')
    expect(results.unsupportedFormat).toBe('HANDOFF_FORMAT_UNSUPPORTED')
  })

  it('still opens the original chunked handoff format for settings', () => {
    expect(results.legacyMatch).toBe(true)
    expect(results.legacyFormat).toBe('v1')
    expect(results.legacyFiles).toBe(0)
    expect(results.legacyInvalidName).toBe('HANDOFF_INVALID_SETTING_NAME')
  })
})

const WINDOWS_HARNESS = String.raw`
param([Parameter(Mandatory)][string]$ScriptsDir, [Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Stop'
$sides = @{}
foreach ($side in 'source', 'target') {
  $app = Join-Path $Root $side
  New-Item -ItemType Directory -Force -Path (Join-Path $app 'scripts\lib') | Out-Null
  Copy-Item -LiteralPath (Join-Path $ScriptsDir 'cloud-secret-store.ps1') -Destination (Join-Path $app 'scripts')
  Copy-Item -LiteralPath (Join-Path $ScriptsDir 'lib\secret-handoff.psm1') -Destination (Join-Path $app 'scripts\lib')
  $sides[$side] = $app
}
function Invoke-Store([string]$side, [string[]]$arguments) {
  $output = & pwsh -NoLogo -NoProfile -NonInteractive -File (Join-Path $sides[$side] 'scripts\cloud-secret-store.ps1') @arguments 2>&1 | Out-String
  return @{ Output = $output; Exit = $LASTEXITCODE }
}
function Get-Code([string]$text) { if ($text -match 'Transfer code: ([0-9A-F-]+)') { return $Matches[1] } return $null }
function Get-Canonical([string]$json) {
  $table = $json | ConvertFrom-Json -AsHashtable; $sorted = [ordered]@{}
  foreach ($name in ([string[]]@($table.Keys) | Sort-Object -CaseSensitive)) { $sorted[$name] = $table[$name] }
  return ($sorted | ConvertTo-Json -Compress)
}
$source = $sides.source; $target = $sides.target
New-Item -ItemType Directory -Force -Path (Join-Path $source 'runtime\cloud-secrets'), (Join-Path $source 'runtime\integration-credentials') | Out-Null
$storeJson = '{"INVENTORY_OPS_CLOUD_URL":"https://synthetic.invalid","INVENTORY_OPS_RELEASE_PUBLISHER_TOKEN":"SYNTHETIC-PUBLISHER-TOKEN-7F3A"}'
[IO.File]::WriteAllText((Join-Path $source 'runtime\cloud-secrets\publisher.dpapi'), (ConvertFrom-SecureString (ConvertTo-SecureString $storeJson -AsPlainText -Force)))
$credentialText = '{"secret":"SYNTHETIC-FILE-SECRET"}'
[IO.File]::WriteAllText((Join-Path $source 'runtime\integration-credentials\synthetic-probe.json'), $credentialText)
$handoff = Join-Path $Root 'publisher.handoff.json'
$publicKey = Join-Path $target 'runtime\cloud-secrets\handoff-public.txt'
$init = Invoke-Store 'target' @('-Mode', 'Initialize')
$export = Invoke-Store 'source' @('-Mode', 'Export', '-PublicKeyPath', $publicKey, '-OutputPath', $handoff)
$again = Invoke-Store 'source' @('-Mode', 'Export', '-PublicKeyPath', $publicKey, '-OutputPath', $handoff)
$inside = Invoke-Store 'source' @('-Mode', 'Export', '-PublicKeyPath', $publicKey, '-OutputPath', (Join-Path $source 'publisher.handoff.json'))
$accept = Invoke-Store 'target' @('-Mode', 'Accept', '-InputPath', $handoff)
$checkSource = Invoke-Store 'source' @('-Mode', 'Check')
$checkTarget = Invoke-Store 'target' @('-Mode', 'Check')
[IO.File]::WriteAllText((Join-Path $target 'runtime\integration-credentials\synthetic-probe.json'), '{"secret":"SYNTHETIC-OTHER"}')
$conflict = Invoke-Store 'target' @('-Mode', 'Accept', '-InputPath', $handoff)
$targetStore = [System.Net.NetworkCredential]::new('', (ConvertTo-SecureString ([IO.File]::ReadAllText((Join-Path $target 'runtime\cloud-secrets\publisher.dpapi'))))).Password
$allOutput = $init.Output + $export.Output + $accept.Output + $checkSource.Output + $checkTarget.Output + $conflict.Output
[ordered]@{
  initExit = $init.Exit; exportExit = $export.Exit; acceptExit = $accept.Exit
  exportCode = Get-Code $export.Output; acceptCode = Get-Code $accept.Output
  checkSourceCode = Get-Code $checkSource.Output; checkTargetCode = Get-Code $checkTarget.Output
  storesEqual = (Get-Canonical $targetStore) -ceq (Get-Canonical $storeJson)
  refusesOverwrite = $again.Exit -ne 0
  refusesRepositoryOutput = ($inside.Exit -ne 0) -and ($inside.Output -match 'HANDOFF_OUTPUT_INSIDE_REPOSITORY')
  refusesDifferentCredential = ($conflict.Exit -ne 0) -and ($conflict.Output -match 'CREDENTIAL_FILE_EXISTS')
  leaksValue = $allOutput.Contains('SYNTHETIC-PUBLISHER-TOKEN') -or $allOutput.Contains('SYNTHETIC-FILE-SECRET')
} | ConvertTo-Json -Compress
`

describe.skipIf(process.platform !== 'win32')('publisher secret handoff on Windows (DPAPI)', () => {
  let results: Record<string, unknown>
  beforeAll(() => {
    const root = tempRoot()
    results = runPwsh(WINDOWS_HARNESS, ['-ScriptsDir', scriptsDir, '-Root', root]).results
  }, 200_000)

  it('moves every setting and credential file from one Windows user store to another with matching codes', () => {
    expect([results.initExit, results.exportExit, results.acceptExit]).toEqual([0, 0, 0])
    expect(results.exportCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
    expect(new Set([results.exportCode, results.acceptCode, results.checkSourceCode, results.checkTargetCode]).size).toBe(1)
    expect(results.storesEqual).toBe(true)
  })

  it('refuses to overwrite a handoff, to write one inside the repository, or to replace a different credential file', () => {
    expect(results.refusesOverwrite).toBe(true)
    expect(results.refusesRepositoryOutput).toBe(true)
    expect(results.refusesDifferentCredential).toBe(true)
  })

  it('never prints a secret value', () => {
    expect(results.leaksValue).toBe(false)
  })
})
