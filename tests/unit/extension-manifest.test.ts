// @vitest-environment node
// @ts-nocheck -- imports the unbundled extension config and the dev-manifest build script (plain ESM).
// Guards the things that make a Manifest V3 extension silently fail to load.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { devManifest } from '../../scripts/build-extension-dev.mjs'
import { WORKSPACES, grantedWorkspaces, workspaceFor } from '../../extension/sidepanel/lib/config.mjs'

const root = resolve(__dirname, '../../extension')
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))

function pngSize(file: string) {
  const bytes = readFileSync(file)
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('Deal Desk extension manifest', () => {
  it('is Manifest V3 with a side panel that has an explicit open trigger', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(existsSync(resolve(root, manifest.side_panel.default_path))).toBe(true)
    expect(existsSync(resolve(root, manifest.background.service_worker))).toBe(true)
    expect(manifest.action.default_popup).toBeUndefined()
    expect(readFileSync(resolve(root, manifest.background.service_worker), 'utf8')).toContain('openPanelOnActionClick: true')
  })

  it('references only icon files that exist at their declared pixel size', () => {
    for (const [size, path] of Object.entries({ ...manifest.icons, ...manifest.action.default_icon })) {
      const file = resolve(root, path as string)
      expect(existsSync(file), path as string).toBe(true)
      expect(pngSize(file)).toEqual({ width: Number(size), height: Number(size) })
    }
  })

  it('asks for the minimum permissions and only the production app origin', () => {
    expect(manifest.permissions.sort()).toEqual(['contextMenus', 'sidePanel', 'storage'])
    expect(manifest.host_permissions).toEqual(['https://inventory-ops.joegallant.me/*'])
    expect(manifest.optional_permissions).toBeUndefined()
  })

  it('adds the loopback demo origins only in the dev-only manifest build', () => {
    const overrides = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/extension-dev-manifest.json'), 'utf8'))
    const dev = devManifest(manifest, overrides)
    expect(dev.host_permissions).toEqual(['https://inventory-ops.joegallant.me/*', 'http://127.0.0.1:4173/*', 'http://localhost:4173/*'])
    expect(dev.permissions).toEqual(manifest.permissions)
    expect(dev.version).toBe(manifest.version)
    expect(() => devManifest(manifest, { host_permissions: ['<all_urls>'] })).toThrow(/only the loopback demo origins/)
  })

  it('offers the local demo workspace only when Chrome grants its origin', () => {
    const shipped = manifest.host_permissions
    const dev = devManifest(manifest, JSON.parse(readFileSync(resolve(__dirname, '../../scripts/extension-dev-manifest.json'), 'utf8'))).host_permissions
    expect(grantedWorkspaces(shipped).map((workspace) => workspace.id)).toEqual(['production'])
    expect(grantedWorkspaces(dev).map((workspace) => workspace.id)).toEqual(['production', 'demo'])
    expect(workspaceFor({ workspace: 'demo' }, 'extension', shipped)).toBe(WORKSPACES.production)
    expect(workspaceFor({ workspace: 'demo' }, 'extension', dev)).toBe(WORKSPACES.demo)
  })

  it('keeps a strict extension-page CSP with no inline script', () => {
    const csp = manifest.content_security_policy.extension_pages
    expect(csp).toMatch(/script-src 'self'/)
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/)
    const html = readFileSync(resolve(root, manifest.side_panel.default_path), 'utf8')
    expect(html).not.toMatch(/<script(?![^>]*src=)/)
    expect(html).not.toMatch(/\son[a-z]+=/i)
  })

  it('bundles every font the stylesheet declares', () => {
    const css = readFileSync(resolve(root, 'sidepanel/panel.css'), 'utf8')
    const fonts = [...css.matchAll(/url\("\.\.\/(fonts\/[^"]+)"\)/g)].map((match) => match[1])
    expect(fonts.length).toBeGreaterThanOrEqual(4)
    for (const font of fonts) expect(existsSync(resolve(root, font)), font).toBe(true)
  })
})
