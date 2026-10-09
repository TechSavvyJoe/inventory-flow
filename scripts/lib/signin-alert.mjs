// Sign-in alerts for the Windows publisher (Joe, 2026-09-28: "if something
// needs a sign in then send me a notification", by iMessage from his Intel
// Mac, with no other machine in between).
//
// The session keeper calls sendSignInAlert after every check. It sends only
// the names of the sites that need Joe, plus whether the automation browser
// is down, over SSH to scripts/mac/send-inventory-alert.mjs on the Mac that
// runs Messages. The SSH key's authorized_keys entry forces that script, so
// the key can do nothing else. No vehicle, customer, cookie or session data
// is sent.
//
// A newly broken site alerts once; if it is still broken six hours later
// the alert repeats, so a lost text is never silent for long; the moment
// every site reads OK again one all-clear follows. A site whose check merely
// errors keeps its earlier state: an error is not a recovery. The state only
// advances after the Mac confirms the send, so a failed send retries on the
// next check.
//
// One more alert fires each morning before the daily run when anything is
// still broken (2026-09-29: DealerMail and vAuto expired overnight, the 5:30
// run refused to publish without hold data, and nobody knew until 7:39). A
// session that dies at 2 AM alerts at 2 AM, which nobody reads, so the
// morning check re-sends once at INVENTORY_ALERT_PRERUN_LOCAL_TIME (local,
// default 05:00, `off` to disable), leaving time to sign in before 5:30.
//
// Configured by two user environment variables on the publisher PC; unset
// means alerts are off:
//   INVENTORY_ALERT_SSH_TARGET  user@host of the Messages Mac (tailnet name)
//   INVENTORY_ALERT_SSH_KEY     path to the private key made for this alert only
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ALERT_PROBLEMS = ['browser', 'dealermail', 'fmcdealer', 'fordvisions', 'vauto']
export const REMIND_AFTER_MS = 6 * 60 * 60 * 1000
export const PRERUN_DEFAULT_LOCAL_TIME = '05:00'
// Above the Mac sender's own 90 s allowance for Messages, plus SSH setup, so a
// slow but successful send is never recorded as a failure (and re-sent).
const SEND_TIMEOUT_MS = 120000
const SSH_TARGET = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/

// Explicit OK clears a site; the keeper's RECOVERED browser also confirms
// health. ERROR, NO_TAB and SKIPPED say nothing about the session.
function confirmedHealthy(status, name) {
  const current = name === 'browser' ? status?.automationBrowser?.status : status?.[name]?.status
  return current === 'OK' || (name === 'browser' && current === 'RECOVERED')
}

export function signInProblems(status, before = []) {
  const found = new Set()
  if (status?.automationBrowser?.status === 'UNAVAILABLE') found.add('browser')
  for (const name of Array.isArray(status?.expired) ? status.expired : []) found.add(name)
  for (const name of before) {
    if (!confirmedHealthy(status, name)) found.add(name)
  }
  return ALERT_PROBLEMS.filter((name) => found.has(name))
}

function readState(statePath) {
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    return Array.isArray(state.problems) ? state : { problems: [] }
  } catch {
    return { problems: [] }
  }
}

function writeState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true })
  const temporary = `${statePath}.tmp`
  writeFileSync(temporary, JSON.stringify(state, null, 2))
  try {
    renameSync(temporary, statePath)
  } catch {
    // A scanner holding the file open blocks the rename on Windows; a direct
    // write still records the send so Joe is not texted again.
    writeFileSync(statePath, JSON.stringify(state, null, 2))
  }
}

// True on the first check at or after this morning's pre-run time when the
// last alert went out before it, so exactly one text lands each morning.
export function preRunReminderDue(now, previous, env = process.env) {
  const setting = env.INVENTORY_ALERT_PRERUN_LOCAL_TIME ?? PRERUN_DEFAULT_LOCAL_TIME
  const parts = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(setting)
  if (!parts) return false
  const due = new Date(now)
  due.setHours(Number(parts[1]), Number(parts[2]), 0, 0)
  if (now.getTime() < due.getTime()) return false
  const lastSent = Date.parse(previous?.sentAt ?? '')
  return !(lastSent >= due.getTime())
}

function sshExecutable(env) {
  const windowsSsh = env.SystemRoot ? path.join(env.SystemRoot, 'System32', 'OpenSSH', 'ssh.exe') : null
  return windowsSsh && existsSync(windowsSsh) ? windowsSsh : 'ssh'
}

// -n: the alert sends no input, and Windows ssh.exe otherwise waits for its
// open stdin pipe to close after the Mac has already answered (seen on
// Joe-PC 2026-09-29: without it every alert would hit the send timeout).
export function sshArgs({ target, key, words }) {
  return ['-n', '-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', target, ...words]
}

// One ssh attempt. Output goes to a temporary file, never a pipe: Windows
// ssh.exe returns the Mac's answer and then does not exit while its stdout is
// a pipe (Node execFile or spawn), however long it is given (Joe-PC,
// 2026-09-29: the Mac answered in 287 ms, ssh was still running at 45 s; with
// a file it exits in about 2 s).
function sshAttempt({ command, args, timeoutMs }) {
  const outPath = path.join(os.tmpdir(), `inventory-alert-${process.pid}-${Date.now()}.txt`)
  const fd = openSync(outPath, 'w')
  return new Promise((resolve) => {
    let timedOut = false
    let timer
    let finished = false
    const finish = (code, spawnError) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try { closeSync(fd) } catch {}
      let output = ''
      try { output = readFileSync(outPath, 'utf8') } catch {}
      try { rmSync(outPath, { force: true }) } catch {}
      resolve({ code, output, timedOut, spawnError })
    }
    let child
    try {
      child = spawn(command[0], [...command.slice(1), ...args], { stdio: ['ignore', fd, fd], windowsHide: true })
    } catch (error) {
      finish(null, error)
      return
    }
    timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    child.on('error', (error) => finish(null, error))
    child.on('exit', (code) => finish(code, null))
  })
}

function readReply(output) {
  for (const line of String(output).trim().split(/\r?\n/).reverse()) {
    try {
      const reply = JSON.parse(line)
      if (reply && typeof reply === 'object' && 'ok' in reply) return reply
    } catch {}
  }
  return null
}

// Runs the forced script once; resolves ok only when it reports ok. Exit 255
// may follow remote execution, so immediately retrying can send duplicate texts.
export async function sshSend({ target, key, words, env = process.env, command = [sshExecutable(env)], timeoutMs = SEND_TIMEOUT_MS }) {
  const args = sshArgs({ target, key, words })
  const attempt = await sshAttempt({ command, args, timeoutMs })
  const reply = readReply(attempt.output)
  if (reply?.ok === true) return { ok: true }
  if (reply?.error) return { ok: false, error: reply.error }
  if (attempt.timedOut) return { ok: false, error: 'timeout' }
  if (attempt.spawnError) return { ok: false, error: `ssh_unavailable_${attempt.spawnError.code ?? 'error'}` }
  return { ok: false, error: attempt.code === 255 ? 'ssh_connect_failed' : `ssh_exit_${attempt.code ?? 'unknown'}` }
}

function alertConfig(env) {
  const target = env.INVENTORY_ALERT_SSH_TARGET
  const key = env.INVENTORY_ALERT_SSH_KEY
  if (!target || !key) return { status: 'not_configured' }
  if (!SSH_TARGET.test(target)) return { status: 'refused_bad_target' }
  if (!existsSync(key)) return { status: 'key_missing' }
  return { target, key }
}

export async function sendSignInAlert({ status, statePath, env = process.env, send = sshSend, now = new Date() }) {
  const config = alertConfig(env)
  if (!config.target) return config

  const previous = readState(statePath)
  const before = previous.problems
  const problems = signInProblems(status, before)
  // Keep the last alert state until all probes confirm recovery; otherwise an
  // unrelated failed probe could trigger all-clear or erase the pending notice.
  if (!problems.length && before.length && !ALERT_PROBLEMS.every(name => confirmedHealthy(status, name))) {
    return { status: 'unchanged', problems: before }
  }
  const newlyBroken = problems.filter((name) => !before.includes(name))
  const lastSent = Date.parse(previous.sentAt ?? '')
  let kind = null
  if (newlyBroken.length) kind = 'needs_sign_in'
  else if (problems.length && preRunReminderDue(now, previous, env)) kind = 'before_run'
  else if (problems.length && !(now - lastSent < REMIND_AFTER_MS)) kind = 'needs_sign_in'
  else if (!problems.length && before.length) kind = 'all_clear'

  if (!kind) {
    // A site recovered while others stay broken: remember it quietly so a
    // later relapse alerts again, without messaging for the partial fix.
    if (problems.join(',') !== before.join(',')) writeState(statePath, { ...previous, problems, updatedAt: now.toISOString() })
    return { status: 'unchanged', problems }
  }

  const host = env.COMPUTERNAME || 'publisher-pc'
  const result = await send({ target: config.target, key: config.key, words: [kind, problems.join(',') || '-', host], env })
  if (!result.ok) return { status: 'send_failed', error: result.error, kind, problems }
  writeState(statePath, { problems, sentAt: now.toISOString(), updatedAt: now.toISOString(), kind })
  return { status: 'sent', kind, problems }
}

// One test text through the same path; does not touch the alert state.
export async function sendTestAlert({ env = process.env, send = sshSend } = {}) {
  const config = alertConfig(env)
  if (!config.target) return config
  const result = await send({ target: config.target, key: config.key, words: ['test', '-', env.COMPUTERNAME || 'publisher-pc'], env })
  return result.ok ? { status: 'sent', kind: 'test' } : { status: 'send_failed', error: result.error }
}
