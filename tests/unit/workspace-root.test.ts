import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveWorkspaceRoot } from '../../scripts/lib/workspace-root.mjs'

const created: string[] = []

function makeWorkspace(name: string) {
  const root = path.join(tmpdir(), `inventory-flow-${name}-${process.pid}-${Date.now()}`)
  created.push(root)
  mkdirSync(path.join(root, 'work', 'run-status'), { recursive: true })
  mkdirSync(path.join(root, 'outputs'), { recursive: true })
  mkdirSync(path.join(root, 'apps', 'inventory-ops', 'scripts'), { recursive: true })
  return root
}

afterEach(() => {
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true })
})

describe('resolveWorkspaceRoot', () => {
  it('prefers the launched junction path over the canonical module path', () => {
    const workspace = makeWorkspace('junction')
    const canonical = path.join(tmpdir(), 'canonical-repository', 'scripts', 'capture.mjs')
    const launched = path.join(workspace, 'apps', 'inventory-ops', 'scripts', 'capture.mjs')

    expect(resolveWorkspaceRoot(pathToFileURL(canonical).href, {
      argv1: launched,
      cwd: path.parse(workspace).root,
      envRoot: '',
    })).toBe(workspace)
  })

  it('honors an explicit validated workspace override', () => {
    const workspace = makeWorkspace('environment')
    expect(resolveWorkspaceRoot(pathToFileURL('C:/not/a/workspace/scripts/capture.mjs').href, {
      argv1: '',
      cwd: path.parse(workspace).root,
      envRoot: workspace,
    })).toBe(workspace)
  })

  it('accepts the scheduled-task workspace flag', () => {
    const workspace = makeWorkspace('flag')
    const originalArgv = process.argv
    process.argv = [...originalArgv, '--workspace-root', workspace]
    try {
      expect(resolveWorkspaceRoot(pathToFileURL('C:/not/a/workspace/scripts/capture.mjs').href, {
        argv1: '',
        cwd: path.parse(workspace).root,
      })).toBe(workspace)
    } finally {
      process.argv = originalArgv
    }
  })

  it('fails closed instead of silently writing under the wrong repository', () => {
    expect(() => resolveWorkspaceRoot(pathToFileURL('C:/not/a/workspace/scripts/capture.mjs').href, {
      argv1: '',
      cwd: 'C:/',
      envRoot: '',
    })).toThrow(/WORKSPACE_ROOT_NOT_FOUND/)
  })
})
