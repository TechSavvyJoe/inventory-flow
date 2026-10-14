// Durable atomic writers for host-side release artifacts.
// Temp file + fsync + rename + directory sync matches sync-cloud-release.mjs
// so a crash mid-write never leaves a truncated JSON file for concurrent readers.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function syncDirectory(directory) {
  if (process.platform === 'win32') return
  let descriptor
  try {
    descriptor = openSync(directory, 'r')
    fsyncSync(descriptor)
  } catch {
    // Some filesystems do not expose directory fsync.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

export function writeAtomicFile(filePath, contents, { mode = 0o600 } = {}) {
  mkdirSync(path.dirname(filePath), { recursive: true })
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
