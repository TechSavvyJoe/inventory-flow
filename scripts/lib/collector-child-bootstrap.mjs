import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// The installed entrypoint must not run before the host has durably enrolled
// this exact child. IPC disconnect before the start grant admits no writer.
const [journalPath, nonce, ownerId, entrypoint, ...args] = process.argv.slice(2)
let admitted = false
const deadline = setTimeout(() => { if (!admitted) process.exit(1) }, 30_000)
deadline.unref()
process.on('disconnect', () => { if (!admitted) process.exit(1) })
process.once('message', async message => {
  try {
    if (message?.type !== 'collector_start' || message.nonce !== nonce || !path.isAbsolute(journalPath ?? '') || !path.isAbsolute(entrypoint ?? '')) throw new Error('CAPTURE_PROCESS_FAILED')
    const workspaceRoot = process.env.BOB_MAXEY_WORKSPACE_ROOT
    if (journalPath !== path.join(workspaceRoot, 'work/collector-attempts/capture-rollback.json')) throw new Error('CAPTURE_PROCESS_FAILED')
    const entrypoints = ['apps/inventory-ops/scripts/capture-dealermail.mjs', 'work/build_v2_snapshot.mjs', 'work/finalize_cloud_snapshot.mjs'].map(relative => path.join(workspaceRoot, relative))
    if (!entrypoints.includes(entrypoint)) throw new Error('CAPTURE_PROCESS_FAILED')
    for (const filePath of [journalPath, path.join(workspaceRoot, 'work/app-feed-status/.publication.lock'), entrypoint]) {
      let current = workspaceRoot
      for (const part of path.relative(workspaceRoot, filePath).split(path.sep)) {
        current = path.join(current, part)
        const stat = lstatSync(current)
        if (stat.isSymbolicLink() || (current === filePath ? !stat.isFile() : !stat.isDirectory())) throw new Error('CAPTURE_PROCESS_FAILED')
      }
    }
    if (lstatSync(journalPath).size > 128 * 1024 * 1024) throw new Error('CAPTURE_PROCESS_FAILED')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    const lock = JSON.parse(readFileSync(path.join(workspaceRoot, 'work/app-feed-status/.publication.lock'), 'utf8'))
    if (journal.schemaVersion !== 2 || journal.child?.phase !== 'active' || journal.child.pid !== process.pid || journal.child.nonce !== nonce ||
        journal.child.ownerId !== ownerId || lock.ownerId !== ownerId || lock.pid !== journal.child.parentPid) throw new Error('CAPTURE_PROCESS_FAILED')
    admitted = true
    clearTimeout(deadline)
    process.disconnect()
    // Preserve the original installed script's CLI and its direct-entry guard.
    process.argv = [process.execPath, entrypoint, ...args]
    await import(pathToFileURL(entrypoint).href)
  } catch { process.exit(1) }
})
if (!process.connected) process.exit(1)
