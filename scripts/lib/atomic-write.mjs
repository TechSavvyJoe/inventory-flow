// Durable atomic writers for host-side release artifacts.
// Temp file + fsync + rename + directory sync matches sync-cloud-release.mjs
// so a crash mid-write never leaves a truncated JSON file for concurrent readers.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const UNSUPPORTED_DIRECTORY_SYNC = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'])

function syncDirectory(directory) {
  if (process.platform === 'win32') return
  let descriptor
  try {
    descriptor = openSync(directory, 'r')
    fsyncSync(descriptor)
  } catch (error) {
    // Some filesystems do not expose directory fsync. Real I/O failures must
    // still fail the write so callers do not treat the artifact as durable.
    if (UNSUPPORTED_DIRECTORY_SYNC.has(error?.code)) return
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function ensureDirectory(directory) {
  const resolved = path.resolve(directory)
  const created = []
  let current = resolved
  while (!existsSync(current)) {
    created.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  mkdirSync(resolved, { recursive: true })
  // Sync newly created parents through the first pre-existing ancestor so a
  // power loss cannot drop a dated release or hash folder entry.
  for (const entry of created.reverse()) syncDirectory(entry)
  syncDirectory(current)
}

export function writeAtomicFile(filePath, contents, { mode = 0o600 } = {}) {
  ensureDirectory(path.dirname(filePath))
  const temporary = `${filePath}.${process.pid}.tmp`
  let descriptor = null
  try {
    descriptor = openSync(temporary, 'w', mode)
    writeFileSync(descriptor, contents)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporary, filePath)
    syncDirectory(path.dirname(filePath))
  } finally {
    if (descriptor !== null) try { closeSync(descriptor) } catch { /* already closed */ }
    try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

export function writeJsonAtomic(filePath, value) {
  writeAtomicFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}
