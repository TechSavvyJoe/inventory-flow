#!/usr/local/bin/node
// Sends one Inventory Flow sign-in alert as an iMessage from the Mac that
// runs Messages (Joe's Intel Mac). The publisher PC calls it over SSH with a
// key whose authorized_keys entry forces this script, so that key can do
// nothing else:
//   command="/usr/local/bin/node <path>/send-inventory-alert.mjs",restrict ssh-ed25519 AAAA... inventory-alert
// Arguments arrive in SSH_ORIGINAL_COMMAND (or argv when run by hand):
//   <needs_sign_in|all_clear|test> <site,site|-> <PC name>
//
// It accepts only the known site names from scripts/lib/signin-alert.mjs and
// builds a fixed sentence; anything else is refused. The chat and the
// RustDesk ID come only from send-inventory-alert.config.json beside this
// file ({"chatId": 224, "rustdeskId": "<publisher PC RustDesk ID>"}), never
// from the caller, so a caller cannot choose the recipient or point Joe at
// another machine. No password ever goes in the link.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SITES = {
  dealermail: 'DealerMail',
  fmcdealer: 'FMCDealer (Ford OASIS)',
  fordvisions: 'Ford invoices (fordvisions)',
  vauto: 'vAuto',
}
const KNOWN = new Set(['browser', ...Object.keys(SITES)])
const RUSTDESK_ID = /^[A-Za-z0-9_-]{6,20}$/
const IMSG = '/usr/local/bin/imsg'

export function parseAlertArgs(words) {
  const [kind, list = '-', host = ''] = Array.isArray(words) ? words : []
  if (!['needs_sign_in', 'before_run', 'all_clear', 'test'].includes(kind)) return null
  const services = list === '-' ? [] : [...new Set(String(list).split(','))]
  if (services.some((name) => !KNOWN.has(name))) return null
  if (['needs_sign_in', 'before_run'].includes(kind) && !services.length) return null
  return { kind, services, host: /^[A-Za-z0-9-]{1,32}$/.test(host) ? host : 'the publisher PC' }
}

export function alertText({ kind, services, host }, config = {}) {
  if (kind === 'test') return `Inventory Flow test: sign-in alerts from ${host} reach you.`
  if (kind === 'all_clear') return `Inventory Flow: every sign-in on ${host} is working again.`
  const parts = []
  if (services.includes('browser')) parts.push(`the automation browser on ${host} is not running; sign in to Windows there so it can start`)
  const sites = services.filter((name) => Object.hasOwn(SITES, name)).map((name) => SITES[name])
  if (sites.length) parts.push(`sign in to ${sites.join(', ')} in the automation browser on ${host}`)
  const lead = kind === 'before_run' ? "Inventory Flow, before this morning's run" : 'Inventory Flow needs you'
  const text = `${lead}: ${parts.join('. Then ')}.`
  const id = typeof config.rustdeskId === 'string' && RUSTDESK_ID.test(config.rustdeskId) ? config.rustdeskId : null
  return id ? `${text}\nOpen ${host} in RustDesk: rustdesk://connection/new/${id}` : text
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(new URL('./send-inventory-alert.config.json', import.meta.url), 'utf8'))
  } catch {
    return {}
  }
}

function main() {
  const words = process.env.SSH_ORIGINAL_COMMAND ? process.env.SSH_ORIGINAL_COMMAND.trim().split(/\s+/) : process.argv.slice(2)
  const alert = parseAlertArgs(words)
  if (!alert) {
    console.log(JSON.stringify({ ok: false, error: 'refused' }))
    return 2
  }
  const config = readConfig()
  if (!Number.isInteger(config.chatId)) {
    console.log(JSON.stringify({ ok: false, error: 'chat_not_configured' }))
    return 3
  }
  const sent = spawnSync(IMSG, ['send', '--chat-id', String(config.chatId), '--text', alertText(alert, config)], { encoding: 'utf8', timeout: 30000 })
  const ok = sent.status === 0
  console.log(JSON.stringify(ok ? { ok: true, kind: alert.kind } : { ok: false, error: 'imsg_failed', status: sent.status }))
  return ok ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main()
