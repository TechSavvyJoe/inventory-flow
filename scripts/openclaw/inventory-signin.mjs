// OpenClaw webhook transform for Inventory Flow sign-in alerts. It runs on
// the Mac that hosts the OpenClaw gateway: copy it to
// ~/.openclaw/hooks/transforms/inventory-signin.mjs and map it with
// match.path "inventory-signin" (docs/DAILY_AUTOMATION_RUNBOOK.md).
//
// It accepts only the known site names from scripts/lib/signin-alert.mjs and
// builds a fixed sentence, so this path always hands the agent fixed text;
// anything else is skipped (returns null). The hooks token itself still
// unlocks OpenClaw's general /hooks/agent endpoint, so it is a credential.
//
// Optional: inventory-signin.config.json beside this file, holding
// {"rustdeskId": "<the publisher PC's RustDesk ID>"}, adds a link that opens
// the RustDesk phone app on that PC. The ID comes only from this Mac-side
// file, never from the request, so a caller cannot point Joe at another
// machine. No password ever goes in the link.
import { readFileSync } from 'node:fs'

const SITES = {
  dealermail: 'DealerMail',
  fmcdealer: 'FMCDealer (Ford OASIS)',
  fordvisions: 'Ford invoices (fordvisions)',
  vauto: 'vAuto',
}
const RUSTDESK_ID = /^[A-Za-z0-9_-]{6,20}$/

export function inventorySignInText(payload, config = {}) {
  const host = typeof payload?.host === 'string' && /^[A-Za-z0-9-]{1,32}$/.test(payload.host) ? payload.host : 'the publisher PC'
  if (payload?.kind === 'all_clear') return `Inventory Flow: every sign-in on ${host} is working again.`
  if (payload?.kind !== 'needs_sign_in' || !Array.isArray(payload.services)) return null
  const services = [...new Set(payload.services)]
  const browserDown = services.includes('browser')
  const sites = services.filter((name) => Object.hasOwn(SITES, name)).map((name) => SITES[name])
  const parts = []
  if (browserDown) parts.push(`the automation browser on ${host} is not running; sign in to Windows there so it can start`)
  if (sites.length) parts.push(`sign in to ${sites.join(', ')} in the automation browser on ${host}`)
  if (!parts.length) return null
  const text = `Inventory Flow needs you: ${parts.join('. Then ')}.`
  const id = typeof config?.rustdeskId === 'string' && RUSTDESK_ID.test(config.rustdeskId) ? config.rustdeskId : null
  return id ? `${text}\nOpen ${host} in RustDesk: rustdesk://connection/new/${id}` : text
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(new URL('./inventory-signin.config.json', import.meta.url), 'utf8'))
  } catch {
    return {}
  }
}

export default function inventorySignIn(ctx) {
  const text = inventorySignInText(ctx?.payload, readConfig())
  if (!text) return null
  return { message: `Sign-in alert for Joe. Send him exactly this text and nothing else:\n${text}` }
}
