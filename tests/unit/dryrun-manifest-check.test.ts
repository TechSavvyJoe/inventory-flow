// @vitest-environment node
// The dry run is a pre-publish gate, so it must validate the day it is asked
// about and report failure through its exit code rather than only printing.
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../../scripts/dryrun_manifest_check.mjs', import.meta.url))
const created: string[] = []

function emptyWorkspace() {
  const root = path.join(tmpdir(), `inventory-flow-dryrun-${process.pid}-${Date.now()}-${created.length}`)
  created.push(root)
  mkdirSync(path.join(root, 'work', 'run-status'), { recursive: true })
  mkdirSync(path.join(root, 'outputs'), { recursive: true })
  mkdirSync(path.join(root, 'apps', 'inventory-ops'), { recursive: true })
  return root
}

function run(args: string[]) {
  const workspaceRoot = emptyWorkspace()
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, INVENTORY_WORKSPACE_ROOT: workspaceRoot },
    })
    return { status: 0, report: JSON.parse(stdout) }
  } catch (error) {
    const failure = error as { status: number; stdout: string }
    return { status: failure.status, report: JSON.parse(failure.stdout) }
  }
}

function todayInNewYork() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true })
})

describe('dryrun_manifest_check', () => {
  it('validates the requested report date instead of a fixed day', () => {
    const { report } = run(['2026-09-11'])
    expect(report.report_date).toBe('2026-09-11')
    expect(report.manifestPath).toContain(path.join('work', 'run-status', '2026-09-11.json'))
  })

  it("defaults to today's New York date", () => {
    expect(run([]).report.report_date).toBe(todayInNewYork())
  })

  it('exits non-zero when the requested manifest and release are missing', () => {
    const { status, report } = run(['2026-09-11'])
    expect(status).toBe(1)
    expect(report.PASS).toBe(false)
    expect(report.hasCompletedManifestEvidence_error).toBeTruthy()
  })
})
