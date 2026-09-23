// @ts-nocheck -- exercises the plain ESM source cache and capture CLI.
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reusableInvoices } from '../../scripts/lib/invoice-cache.mjs'

const vin = '1FTFW1E84RKF12345'
const otherVin = '1FTFW1E84RKF54321'
const pdf = Buffer.from('%PDF-1.4\nsynthetic VIN-bound test\n%%EOF\n')
const folders: string[] = []
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function fixture({ printedVin = vin, fileBytes = pdf, reportDate = '2026-09-22' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'invoice-reuse-'))
  folders.push(root)
  const folder = path.join(root, 'work', 'invoice-history', reportDate)
  mkdirSync(folder, { recursive: true })
  const capturedAtUtc = `${reportDate}T12:30:00Z`
  writeFileSync(path.join(folder, `${vin}.pdf`), fileBytes)
  writeFileSync(path.join(folder, 'index.json'), JSON.stringify({ schema: 'ford-invoice-index-v1', reportDate,
    capturedAtUtc, results: [{ vin, status: 'pdf', bytes: fileBytes.length }] }))
  writeFileSync(path.join(folder, 'parsed.json'), JSON.stringify({ schema: 'ford-invoice-parsed-v1', reportDate,
    parsedAtUtc: capturedAtUtc, results: [{ vin, status: 'pdf', invoice: { vin: printedVin }, error: null }] }))
  return { root, capturedAtUtc }
}

afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

describe('cross-day invoice reuse', () => {
  it('reuses only an intact parsed exact-VIN PDF with its original capture date', () => {
    const { root, capturedAtUtc } = fixture()
    const found = reusableInvoices(root, '2026-09-23', [vin, otherVin])
    expect(found.size).toBe(1)
    expect(found.get(vin)).toMatchObject({ vin, capturedAtUtc, sourceReportDate: '2026-09-22', bytes: pdf.length })
    expect(found.has(otherVin)).toBe(false)
  })

  it('rejects a mismatched VIN, incomplete PDF, and missing parse evidence', () => {
    const wrong = fixture({ printedVin: otherVin })
    const broken = fixture({ fileBytes: Buffer.from('%PDF-1.4\nno trailer') })
    const missing = fixture()
    rmSync(path.join(missing.root, 'work', 'invoice-history', '2026-09-22', 'parsed.json'))
    for (const root of [wrong.root, broken.root, missing.root]) {
      expect(reusableInvoices(root, '2026-09-23', [vin]).size).toBe(0)
    }
  })

  it('finishes an all-cached day without needing a Ford browser session', () => {
    const { root, capturedAtUtc } = fixture()
    mkdirSync(path.join(root, 'work', 'run-status'), { recursive: true })
    mkdirSync(path.join(root, 'outputs'), { recursive: true })
    mkdirSync(path.join(root, 'apps', 'inventory-ops'), { recursive: true })
    const snapshot = path.join(root, 'work', 'inventory-history', 'snapshots')
    mkdirSync(snapshot, { recursive: true })
    writeFileSync(path.join(snapshot, '2026-09-23-public.json'), JSON.stringify({ vehicles: { [vin]: { vin, make: 'Ford' } } }))
    const output = execFileSync(process.execPath, [path.join(repo, 'scripts', 'capture-invoices.mjs'), 'run', '2026-09-23'], {
      cwd: repo, env: { ...process.env, BOB_MAXEY_WORKSPACE_ROOT: root }, encoding: 'utf8', timeout: 10_000,
    })
    expect(JSON.parse(output)).toMatchObject({ sessionStatus: 'ok', attempted: 0, reused: 1 })
    const current = path.join(root, 'work', 'invoice-history', '2026-09-23')
    expect(readFileSync(path.join(current, `${vin}.pdf`))).toEqual(pdf)
    expect(JSON.parse(readFileSync(path.join(current, 'index.json'), 'utf8')).results[0].capturedAtUtc).toBe(capturedAtUtc)
  })
})
