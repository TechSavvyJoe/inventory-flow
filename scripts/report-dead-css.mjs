// Read-only report of CSS selectors under src/ that can never match, because they require a class
// that no source file renders. It writes nothing; it only prints.
//
//   node scripts/report-dead-css.mjs                  per-file summary and the most common dead classes
//   node scripts/report-dead-css.mjs --selectors      also every dead selector with the class that kills it
//   node scripts/report-dead-css.mjs --templates      also the class templates the scan resolved
//   node scripts/report-dead-css.mjs --json           the whole report as JSON on stdout
//   node scripts/report-dead-css.mjs src/styles/shell.css ...   limit the report to these sheets
//
// A class counts as rendered when it can come out of non-test src TS/TSX or index.html:
//   - it appears there as a whole token (strings, JSX, identifiers, comments: deliberately
//     over-inclusive; module specifiers such as './transfer-workspace-v3.css' are ignored), or
//   - it matches a template or concatenation (`inventory-workspace-panel--${tab}`, 'is-' + x), or
//   - a library adds it at runtime (react-router NavLink: active/pending/transitioning;
//     lucide-react: lucide, lucide-*).
// A template that starts with an interpolation (`${formId}-title`) builds an id or an ARIA
// reference in this codebase, so it does not make classes live unless it continues with -- or __;
// --templates lists every one of them for review.
//
// Selectors are judged one by one, never per rule: a selector is dead when one of its compounds
// requires an unrendered class. :not(...) never kills a selector; :is/:where/:matches/:has kill it
// only when every argument is dead. A rule is dead only when every selector in its list is dead;
// a rule with live and dead selectors is "partial" (drop the dead selectors, keep the rule).
// Nested rules are decided with their parent rule.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
// postcss is not a direct dependency; borrow the copy Vite resolves.
const postcss = createRequire(createRequire(join(ROOT, 'package.json')).resolve('vite'))('postcss')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const onlyFiles = args.filter((a) => !a.startsWith('--')).map((a) => relative(ROOT, resolve(a)))

function walk(dir, pred, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, pred, out)
    else if (pred(p)) out.push(p)
  }
  return out
}

// ---------- classes the source can render ----------
const tokens = new Set(['active', 'pending', 'transitioning', 'lucide'])
const globs = new Map([['lucide-*', /^lucide-[A-Za-z0-9_-]+$/]])
const leadingTemplates = []
const WORD = /[A-Za-z0-9_-]/

function addTemplate(parts, literals, origin) {
  // parts: characters of one class-like word, '*' marking an interpolation.
  const glued = parts.some((p, k) => p === '*' && (
    (k > 0 && parts[k - 1] !== '*' && !/[-_]/.test(parts[k - 1])) ||
    (k < parts.length - 1 && parts[k + 1] !== '*' && !/[-_]/.test(parts[k + 1]))))
  if (glued) {
    // `inventory-row${held ? '--held' : ''}` or `${n}px`: expand to the literal alternatives.
    let words = ['']
    let star = 0
    for (const p of parts) {
      if (p === '*') { const lits = literals[star++]; words = words.flatMap((w) => (lits.length ? lits : ['']).map((l) => w + l)) }
      else words = words.map((w) => w + p)
    }
    for (const w of words) for (const t of w.split(/\s+/)) if (t) tokens.add(t)
    return
  }
  const glob = parts.join('')
  if (!glob.includes('*') || !/[A-Za-z]/.test(glob.replace(/\*/g, ''))) return
  if (glob.startsWith('*') && !/^\*(--|__)/.test(glob)) { leadingTemplates.push({ glob, origin }); return }
  if (!globs.has(glob)) globs.set(glob, new RegExp('^' + glob.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[A-Za-z0-9_-]+') + '$'))
}

function scanString(text, i) {
  const quote = text[i]
  let j = i + 1
  while (j < text.length && text[j] !== quote && text[j] !== '\n') { if (text[j] === '\\') j++; j++ }
  const words = text.slice(i + 1, j).split(/\s+/)
  const first = words[0]
  const last = words[words.length - 1]
  if (last && /^[A-Za-z0-9_-]+[-_]$/.test(last)) addTemplate([...last, '*'], [[]], 'concatenation') // 'is-' + x
  if (words.length === 1 && first && /^[-_][A-Za-z0-9_-]+$/.test(first)) addTemplate(['*', ...first], [[]], 'concatenation') // x + '-row'
  return j + 1
}

function skipExpression(text, j, origin) {
  let depth = 1
  while (j < text.length) {
    const c = text[j]
    if (c === '`') { j = scanTemplate(text, j, origin); continue }
    if (c === '"' || c === "'") { j = scanString(text, j); continue }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return j + 1
    j++
  }
  return j
}

function scanTemplate(text, i, origin) {
  let j = i + 1
  let word = []
  let literals = []
  const flush = () => { if (word.includes('*')) addTemplate(word, literals, origin); word = []; literals = [] }
  while (j < text.length) {
    const c = text[j]
    if (c === '\\') { word.push(text[j + 1]); j += 2; continue }
    if (c === '`') { flush(); return j + 1 }
    if (c === '$' && text[j + 1] === '{') {
      const start = j + 2
      j = skipExpression(text, start, origin)
      const expr = text.slice(start, j - 1)
      const lits = [...expr.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`$]*)`?/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')
      // `${cond ? " is-x" : ""}` only appends whole, space-separated classes.
      if (lits.length && lits.every((l) => l === '' || /^\s/.test(l))) { flush(); continue }
      word.push('*')
      literals.push(lits)
      continue
    }
    if (WORD.test(c)) { word.push(c); j++; continue }
    flush()
    j++
  }
  return j
}

const sources = walk(join(ROOT, 'src'), (p) => /\.(tsx?|mts|jsx?|mjs)$/.test(p) && !/\.test\.|\/test\/|\/__tests__\//.test(p))
sources.push(join(ROOT, 'index.html'))
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
    .replace(/\bfrom\s*(['"])[^'"\n]+\1/g, 'from ""')
    .replace(/\bimport\s*(['"])[^'"\n]+\1/g, 'import ""')
    .replace(/\bimport\(\s*(['"`])[^'"`\n]+\1\s*\)/g, 'import("")')
  for (const m of text.matchAll(/[A-Za-z0-9_-]+/g)) tokens.add(m[0])
  if (file.endsWith('.html')) continue
  const origin = relative(ROOT, file)
  for (let i = 0; i < text.length;) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue }
    if (c === '`') { i = scanTemplate(text, i, origin); continue }
    if (c === '"' || c === "'") {
      // JSX text can hold apostrophes ("can't"): only a quote that closes on the same line is a string.
      const close = text.indexOf(c, i + 1)
      const nl = text.indexOf('\n', i)
      if (close > 0 && (nl < 0 || close < nl)) { i = scanString(text, i); continue }
    }
    i++
  }
}

const liveCache = new Map()
function classLive(name) {
  if (!liveCache.has(name)) liveCache.set(name, tokens.has(name) || [...globs.values()].some((re) => re.test(name)))
  return liveCache.get(name)
}

// ---------- selectors ----------
function closing(s, i, open, close) {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') { j++; continue }
    if (c === '"' || c === "'") { j++; while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; j++ } continue }
    if (c === open) depth++
    else if (c === close && --depth === 0) return j
  }
  throw new Error(`unbalanced ${open} in ${s}`)
}

function splitTopLevel(s) {
  const parts = []
  let depth = 0
  let start = 0
  for (let j = 0; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') { j++; continue }
    if (c === '"' || c === "'") { j++; while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; j++ } continue }
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) { parts.push(s.slice(start, j)); start = j + 1 }
  }
  parts.push(s.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

const IDENT = /^(?:\\.|[A-Za-z0-9_-]|[^\x00-\x7f])+/
const ANY_OF = new Set(['is', 'where', 'matches', '-webkit-any', '-moz-any', 'any', 'has'])
// The first unrendered class a selector requires, or null when it can match.
function deadClass(selector) {
  const s = selector.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (let i = 0; i < s.length;) {
    const c = s[i]
    if (c === '\\') { i += 2; continue }
    if (c === '"' || c === "'") { i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++ } i++; continue }
    if (c === '[') { i = closing(s, i, '[', ']') + 1; continue }
    if (c === '.' || c === '#') {
      const m = s.slice(i + 1).match(IDENT)
      const name = m ? m[0].replace(/\\(.)/g, '$1') : ''
      if (c === '.' && name && !/^\d/.test(name) && !classLive(name)) return name
      i += 1 + (m ? m[0].length : 0)
      continue
    }
    if (c === ':') {
      let j = i + 1
      if (s[j] === ':') j++
      const name = (s.slice(j).match(/^[A-Za-z-]+/) || [''])[0].toLowerCase()
      j += name.length
      if (s[j] === '(') {
        const end = closing(s, j, '(', ')')
        if (ANY_OF.has(name)) {
          const dead = splitTopLevel(s.slice(j + 1, end)).map((part) => deadClass(part.replace(/^[>+~]\s*/, '')))
          if (dead.every(Boolean)) return dead[0]
        }
        i = end + 1
      } else i = j
      continue
    }
    i++
  }
  return null
}

// ---------- sheets ----------
const sheets = walk(join(ROOT, 'src'), (p) => p.endsWith('.css')).map((p) => relative(ROOT, p)).sort()
  .filter((f) => !onlyFiles.length || onlyFiles.includes(f))
const report = { files: {}, deadClasses: {}, selectors: [] }
const count = (node, pred) => { let n = 0; node.walkDecls((d) => { if (pred(d)) n++ }); return n }

for (const file of sheets) {
  const css = readFileSync(join(ROOT, file), 'utf8')
  const root = postcss.parse(css, { from: file })
  const stats = { rules: 0, deadRules: 0, partialRules: 0, selectors: 0, deadSelectors: 0, declarations: count(root, () => true), deadDeclarations: 0, important: count(root, (d) => d.important), deadImportant: 0, lines: css.split('\n').length - (css.endsWith('\n') ? 1 : 0) }
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    for (let a = rule.parent; a; a = a.parent) if (a.type === 'rule') return
    stats.rules++
    const verdicts = rule.selectors.map((selector) => ({ selector, dead: deadClass(selector) }))
    const dead = verdicts.filter((v) => v.dead)
    stats.selectors += verdicts.length
    stats.deadSelectors += dead.length
    if (!dead.length) return
    for (const v of dead) {
      report.deadClasses[v.dead] = (report.deadClasses[v.dead] || 0) + 1
      report.selectors.push({ file, line: rule.source.start.line, selector: v.selector, deadClass: v.dead, wholeRule: dead.length === verdicts.length })
    }
    if (dead.length === verdicts.length) {
      stats.deadRules++
      stats.deadDeclarations += count(rule, () => true)
      stats.deadImportant += count(rule, (d) => d.important)
    } else stats.partialRules++
  })
  report.files[file] = stats
}

if (flag('--json')) {
  console.log(JSON.stringify({ ...report, templates: [...globs.keys()].sort(), leadingTemplates }, null, 1))
} else {
  const rows = Object.entries(report.files).filter(([, v]) => v.deadSelectors).sort((a, b) => b[1].deadDeclarations - a[1].deadDeclarations)
  console.log('sheet | rules dead/partial/total | selectors dead/total | declarations dead/total | !important dead/total')
  for (const [f, v] of rows) console.log(`${f} | ${v.deadRules}/${v.partialRules}/${v.rules} | ${v.deadSelectors}/${v.selectors} | ${v.deadDeclarations}/${v.declarations} | ${v.deadImportant}/${v.important}`)
  const total = (key) => Object.values(report.files).reduce((sum, v) => sum + v[key], 0)
  console.log(`total: ${total('deadSelectors')}/${total('selectors')} selectors, ${total('deadDeclarations')}/${total('declarations')} declarations and ${total('deadImportant')}/${total('important')} !important in dead rules, across ${Object.keys(report.files).length} sheets`)
  const top = Object.entries(report.deadClasses).sort((a, b) => b[1] - a[1]).slice(0, 25)
  if (top.length) console.log('most common dead classes: ' + top.map(([c, n]) => `${c} (${n})`).join(', '))
  if (flag('--selectors')) for (const s of report.selectors) console.log(`${s.file}:${s.line} ${s.wholeRule ? 'rule' : 'partial'} ${s.selector.replace(/\s+/g, ' ')}  [${s.deadClass}]`)
  if (flag('--templates')) {
    for (const g of [...globs.keys()].sort()) console.log('template', g)
    for (const t of leadingTemplates) console.log('ignored leading template', t.glob, t.origin)
  }
}
