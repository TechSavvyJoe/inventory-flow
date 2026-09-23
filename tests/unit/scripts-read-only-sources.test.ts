// PRODUCT-RULE TEST
// @ts-nocheck -- plain-text scan over the Node ESM capture scripts.
// @vitest-environment node
// Source systems (DealerMail, CDK, Ford dealerconnection, DealerOn, vAuto) are
// read-only evidence. This is a deliberately plain grep, not an AST: a
// write-shaped call (POST/PUT/PATCH/DELETE, .click(, form submit) may not sit
// near a source host literal, or near a constant built from one, in any
// script — including template strings handed to evalJs or Runtime.evaluate.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as cdp from '../../scripts/lib/cdp.mjs'

const root = path.resolve(__dirname, '../..')
const SOURCE_HOST = /dealermail\.com|dealerconnection\.com|cdkglobal\.com|\bcdk\.com|dealeron\.com|vauto\.com/i
const WRITE_SHAPED = [
  /\bmethod\s*:\s*[`'"]?\s*(?:POST|PUT|PATCH|DELETE)\b/i,
  /[`'"](?:POST|PUT|PATCH|DELETE)[`'"]/,
  /\.click\s*\(/,
  /\bform\.submit\b|\.requestSubmit\s*\(|\.submit\s*\(\s*\)/,
]
const NEAR = 8
// The only sanctioned exception: fetchInTab refuses any POST whose URL is not
// exactly listed in READ_ONLY_POST_URLS, so the allowlist names are exempt.
const ALLOWLIST_NAMES = new Set(['READ_ONLY_POST_URLS', ...Object.entries(cdp)
  .filter(([, value]) => typeof value === 'string' && cdp.READ_ONLY_POST_URLS.includes(value))
  .map(([name]) => name)])

function sourceWriteViolations(text) {
  const lines = text.split(/\r?\n/)
  const bound = new Set()
  for (let changed = true; changed;) {
    changed = false
    for (const line of lines) {
      // Short loop temporaries (r, t, v) do not carry a URL across a file.
      const name = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]{2,})\s*=/.exec(line)?.[1]
      if (!name || bound.has(name) || ALLOWLIST_NAMES.has(name)) continue
      if (SOURCE_HOST.test(line) || [...bound].some((other) => new RegExp(`\\b${other.replace(/\$/g, '\\$')}\\b`).test(line))) {
        bound.add(name); changed = true
      }
    }
  }
  const nearSource = (line) => SOURCE_HOST.test(line) || [...bound].some((name) => new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(line))
  const violations = []
  lines.forEach((line, index) => {
    if (!WRITE_SHAPED.some((pattern) => pattern.test(line))) return
    const window = lines.slice(Math.max(0, index - NEAR), index + NEAR + 1)
    if (window.some(nearSource)) violations.push(`${index + 1}: ${line.trim().slice(0, 120)}`)
  })
  return violations
}

describe('capture scripts never write to a source system', () => {
  it('finds no write-shaped call near a DealerMail, CDK, dealerconnection, DealerOn or vAuto host', () => {
    const files = execFileSync('git', ['ls-files', '-z', '--', 'scripts'], { cwd: root, encoding: 'utf8' })
      .split('\0').filter((name) => name.endsWith('.mjs'))
    expect(files.length).toBeGreaterThan(20)
    const found = files.flatMap((name) => sourceWriteViolations(readFileSync(path.join(root, name), 'utf8')).map((hit) => `${name}:${hit}`))
    expect(found).toEqual([])
  })

  it.each([
    ['a POST beside a DealerMail literal', "const r = await fetch('https://www.dealermail.com/prospect_manager/hold_edit.asp', {\n  method: 'POST',\n})"],
    ['a POST to a DealerMail constant defined far away', `const GRID = 'https://www.dealermail.com/grid.asp'\n${'\n'.repeat(40)}await fetchInTab(page, GRID, { method: 'POST' })`],
    ['a template string for Runtime.evaluate', "await evalJs(`fetch('https://www.fordtechservice.dealerconnection.com/oasis/Save', { method: 'PUT' })`)"],
    ['a click on a CDK page', "const CDK = 'https://drive.cdkglobal.com/deal'\nawait page.evalJs(`document.querySelector('#save').click()`)"],
    ['a form submit on a vAuto page', "// https://www2.vauto.com/Va/Appraisal\nawait page.evalJs('form.submit()')"],
  ])('fails on a planted write: %s', (_label, planted) => {
    expect(sourceWriteViolations(planted)).not.toEqual([])
  })

  it('keeps the loopback CDP control calls and the allowlisted PTS read legal', () => {
    expect(sourceWriteViolations("await fetch(`http://127.0.0.1:${PORT}/json/close/${id}`, { method: 'POST' })")).toEqual([])
    expect(sourceWriteViolations("const ORIGIN = 'https://www.fordtechservice.dealerconnection.com'\nconst r = await fetchInTab(page, PTS_REPAIR_ORDER_DETAILS_URL, {\n  method: 'POST',\n})")).not.toEqual([])
    expect(sourceWriteViolations(`const ORIGIN = 'https://www.fordtechservice.dealerconnection.com'${'\n'.repeat(20)}const r = await fetchInTab(page, PTS_REPAIR_ORDER_DETAILS_URL, {\n  method: 'POST',\n})`)).toEqual([])
  })
})
