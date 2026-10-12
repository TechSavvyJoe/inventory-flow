import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(allowedColors: number, actualColors: number) {
  const root = await mkdtemp(join(tmpdir(), 'inventory-design-baseline-'))
  temporary.push(root)
  await mkdir(join(root, 'scripts/lib'), { recursive: true })
  await mkdir(join(root, 'src'))
  await copyFile(resolve('scripts/check-design-system.mjs'), join(root, 'scripts/check-design-system.mjs'))
  await copyFile(resolve('scripts/lib/css-metrics.mjs'), join(root, 'scripts/lib/css-metrics.mjs'))
  await writeFile(join(root, 'src/main.tsx'), "import './theme.css'\n")
  await writeFile(join(root, 'src/theme.css'), `.surface { ${Array.from({ length: actualColors }, () => 'color: #123456;').join(' ')} }`)
  // Equivalent JSON key order must not make a quiet release checkout dirty.
  const original = JSON.stringify({
    files: { 'src/theme.css': { idSelectors: 0, important: 0, rgbHslColors: 0, rawColors: allowedColors, smallText: 0 } },
    grandfatheredFilenames: [],
    globalStyleImports: ['./theme.css'],
  }, null, 2) + '\n'
  const path = join(root, 'scripts/design-system-baseline.json')
  await writeFile(path, original)
  return { root, path, original }
}

describe('design baseline release checkout stability', () => {
  it('keeps an equal baseline byte-identical across repeated guard runs', async () => {
    const f = await fixture(1, 1)
    for (let run = 0; run < 2; run++) {
      const output = execFileSync(process.execPath, ['scripts/check-design-system.mjs'], { cwd: f.root, encoding: 'utf8' })
      expect(output).toContain('Design-system guard passed')
      expect(output).not.toContain('baseline tightened')
      expect(await readFile(f.path, 'utf8')).toBe(f.original)
    }
  })

  it('still persists a real debt reduction', async () => {
    const f = await fixture(2, 1)
    const output = execFileSync(process.execPath, ['scripts/check-design-system.mjs'], { cwd: f.root, encoding: 'utf8' })
    expect(output).toContain('baseline tightened automatically')
    expect(JSON.parse(await readFile(f.path, 'utf8')).files['src/theme.css'].rawColors).toBe(1)
  })

  it('still rejects increased debt without changing the baseline', async () => {
    const f = await fixture(1, 2)
    const result = spawnSync(process.execPath, ['scripts/check-design-system.mjs'], { cwd: f.root, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('rawColors increased from 1 to 2')
    expect(await readFile(f.path, 'utf8')).toBe(f.original)
  })

  it.each([
    ['important', '.surface { color: var(--text) !important; }'],
    ['idSelectors', '#surface { color: var(--text); }'],
  ])('cannot accept an increase in the absolute %s ban', async (metric, css) => {
    const f = await fixture(0, 0)
    await writeFile(join(f.root, 'src/theme.css'), css)
    const result = spawnSync(process.execPath, ['scripts/check-design-system.mjs', '--accept'], { cwd: f.root, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`${metric} increased from 0 to 1`)
    expect(await readFile(f.path, 'utf8')).toBe(f.original)
  })

  it('accepts reviewable color debt without weakening absolute metrics', async () => {
    const f = await fixture(0, 1)
    const result = spawnSync(process.execPath, ['scripts/check-design-system.mjs', '--accept'], { cwd: f.root, encoding: 'utf8' })
    expect(result.status).toBe(0)
    const metrics = JSON.parse(await readFile(f.path, 'utf8')).files['src/theme.css']
    expect(metrics).toMatchObject({ rawColors: 1, important: 0, idSelectors: 0 })
  })
})
