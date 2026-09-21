// @vitest-environment node
// Every number, date and sort order shown to staff is formatted for en-US, so
// a browser set to another locale never changes a reading or reorders a list.
// This scans the app and companion sources for a locale-sensitive call that
// leaves the locale to the browser.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = ['src', 'extension']
const SOURCE = /\.(?:ts|tsx|mjs|js)$/
const LOCALE_CALL = /\.(?:localeCompare|toLocaleString|toLocaleDateString|toLocaleTimeString)\(|\bIntl\.(?:NumberFormat|DateTimeFormat|Collator|RelativeTimeFormat|PluralRules|ListFormat)\(/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full)
    return SOURCE.test(name) && !/\.test\.|\.d\.ts$/.test(name) ? [full] : []
  })
}

/** The argument list of the call that opens at `start`, up to its matching paren. */
function argumentsAt(text: string, start: number): string {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    else if (text[index] === ')') { depth -= 1; if (depth === 0) return text.slice(start + 1, index) }
  }
  return text.slice(start + 1)
}

describe('display locale', () => {
  it('pins every locale-sensitive format and sort in the app and companion to en-US', () => {
    const implicit: string[] = []
    for (const file of ROOTS.flatMap(sourceFiles)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(LOCALE_CALL)) {
        const args = argumentsAt(text, match.index + match[0].length - 1)
        if (!/["']en-US["']/.test(args)) implicit.push(`${file}:${text.slice(0, match.index).split('\n').length} ${match[0]}${args.slice(0, 60)}`)
      }
    }
    expect(implicit).toEqual([])
  })
})
