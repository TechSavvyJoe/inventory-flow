// A port of the app's vehicle-feature-utils: every published equipment item
// from the strongest source wins (factory sticker > vAuto label > website
// listing), grouped into the same categories the app uses, standouts first.

export const CATEGORY_LABELS = Object.freeze({
  packages: 'Packages & special equipment',
  'driver-assistance': 'Driver assistance & safety',
  'towing-utility': 'Towing & utility',
  comfort: 'Comfort & convenience',
  technology: 'Technology & audio',
  performance: 'Performance & capability',
  other: 'Other published equipment',
})

const CATEGORY_MATCHERS = [
  ['packages', /\b(package|equipment\s+group|edition|appearance\s+group|special\s+series|black\s+label|king\s+ranch|platinum|lariat|tremor|raptor|shelby|stx|luxury\s+group|technology\s+group)\b/i],
  ['driver-assistance', /\b(bluecruise|super\s+cruise|pro\s*pilot|propilot|co-?pilot|active\s+driving\s+assist|hands[- ]free\s+driv|adaptive\s+cruise|cruise\s+control\s+with\s+stop|lane\s+(?:change\s+alert|keep|keeping|centering|departure|tracing)|blind\s+spot|blind\s+zone|blis|cross[- ](?:path|traffic)|pre[- ]collision|forward\s+collision|full[- ]speed\s+forward\s+collision|automatic\s+emergency|emergency\s+braking|front\s+pedestrian\s+braking|park(?:ing)?\s+assist|park\s*sense|park\s*view|parking\s+sensor|reverse\s+sensing|360(?:-degree)?\s+camera|surround\s+(?:view|vision)|driver\s+(?:alert|attention|monitoring)|drowsy\s+driver|safety\s+alert\s+seat|traffic\s+sign\s+(?:recognition|assist)|evasive\s+steering|pedestrian|automatic\s+high[- ]beam|auto\s+high[- ]beam|intelli\s*beam|backup\s+camera|rear\s*view\s+camera|air\s*bag|anti[- ]lock|abs\b|stability\s+control|traction\s+control|ford\s+co-?pilot|toyota\s+safety\s+sense|honda\s+sensing)\b/i],
  ['towing-utility', /\b(tow|towing|trailer|hitch|gooseneck|fifth[- ]wheel|5th[- ]wheel|payload|bed\s*liner|bed\s+utility|tailgate|cargo\s+management|pro\s+power\s+onboard)\b/i],
  ['comfort', /\b(heated|ventilated|cooled|massage|leather|memory\s+seat|power\s+seat|moonroof|sunroof|panoramic|climate\s+control|third[- ]row|3rd[- ]row|remote\s+start|keyless|hands[- ]free\s+liftgate|power\s+liftgate|power\s+running\s+board)\b/i],
  ['technology', /\b(navigation|sync\b|apple\s+carplay|android\s+auto|wireless\s+charging|bluetooth|wi-?fi|touchscreen|touch\s+screen|head[- ]up|digital\s+(?:cluster|display)|b&o|bang\s*&\s*olufsen|premium\s+audio|satellite\s+radio|usb)\b/i],
  ['performance', /\b(4x4|4wd|four[- ]wheel\s+drive|awd|all[- ]wheel\s+drive|locking\s+differential|limited[- ]slip|off[- ]road|sport[- ]tuned|performance|turbo|ecoboost|hybrid|electric|ev\b|suspension|skid\s+plate)\b/i],
]

const STANDOUT = /\b(package|equipment\s+group|edition|special\s+series|black\s+label|king\s+ranch|platinum|lariat|tremor|raptor|shelby|max\s+trailer|trailer\s+tow|tow\s+technology|gooseneck|fifth[- ]wheel|5th[- ]wheel|pro\s+trailer|pro\s+power\s+onboard|bluecruise|super\s+cruise|pro\s*pilot|propilot|hands[- ]free\s+driv|active\s+driving\s+assist|adaptive\s+cruise|lane\s+centering|360(?:-degree)?\s+camera|surround\s+(?:view|vision)|active\s+park|blind\s+spot|blind\s+zone|automatic\s+emergency|driver\s+monitoring|traffic\s+sign\s+recognition|panoramic|moonroof|sunroof|ventilated|cooled\s+seat|massage|b&o|bang\s*&\s*olufsen|premium\s+audio|head[- ]up|wireless\s+charging|locking\s+differential|off[- ]road|hybrid|electric)\b/i

const SOURCE_STRENGTH = { 'factory-equipment-group': 4, 'factory-option': 3, 'factory-standard-equipment': 2, 'vauto-equipment-package': 2, 'vauto-informational-equipment': 2, 'published-listing-feature': 1 }
export const SOURCE_LABELS = Object.freeze({
  'factory-equipment-group': 'Original sticker equipment group', 'factory-option': 'Original sticker option', 'factory-standard-equipment': 'Original sticker standard equipment',
  'vauto-equipment-package': 'vAuto equipment label package', 'vauto-informational-equipment': 'vAuto equipment label', 'published-listing-feature': 'Dealer website listing',
})

const categoryFor = (label) => CATEGORY_MATCHERS.find(([, pattern]) => pattern.test(label))?.[0] ?? 'other'
export const equipmentKey = (label) => String(label).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function candidates(vehicle) {
  const sticker = vehicle.documents?.windowSticker
  const factory = vehicle.documents?.factoryEquipment
  return [
    ...(sticker?.equipmentGroup ? [{ label: sticker.equipmentGroup, source: 'factory-equipment-group' }] : []),
    ...(sticker?.options ?? []).map((label) => ({ label, source: 'factory-option' })),
    ...(sticker?.standardEquipment ?? []).map((label) => ({ label, source: 'factory-standard-equipment' })),
    ...(factory?.packages ?? []).flatMap((item) => [
      { label: [item.name, item.code ? `(${item.code})` : null].filter(Boolean).join(' '), source: 'vauto-equipment-package' },
      ...(item.features ?? []).map((label) => ({ label, source: 'vauto-informational-equipment' })),
    ]),
    ...(factory?.sections ?? []).flatMap((section) => (section.items ?? []).map((item) => ({ label: item.label, source: 'vauto-informational-equipment' }))),
    ...(vehicle.features ?? []).map((label) => ({ label, source: 'published-listing-feature' })),
  ]
}

export function publishedEquipment(vehicle) {
  const byKey = new Map()
  for (const candidate of candidates(vehicle)) {
    const label = String(candidate.label ?? '').replace(/\s+/g, ' ').trim()
    if (!label) continue
    const key = equipmentKey(label)
    if (!key) continue
    const next = { label, source: candidate.source, category: categoryFor(label), standout: STANDOUT.test(label) }
    const existing = byKey.get(key)
    if (!existing || SOURCE_STRENGTH[next.source] > SOURCE_STRENGTH[existing.source]) byKey.set(key, next)
  }
  return [...byKey.values()].sort((left, right) => {
    if (left.standout !== right.standout) return left.standout ? -1 : 1
    return (SOURCE_STRENGTH[right.source] - SOURCE_STRENGTH[left.source]) || left.label.localeCompare(right.label, undefined, { numeric: true })
  })
}

export function standoutEquipment(vehicle, limit = 4) {
  return publishedEquipment(vehicle).filter((item) => item.standout).slice(0, Math.max(0, limit))
}

export function equipmentByCategory(vehicle) {
  const items = publishedEquipment(vehicle)
  return Object.keys(CATEGORY_LABELS)
    .map((category) => ({ category, label: CATEGORY_LABELS[category], items: items.filter((item) => item.category === category) }))
    .filter((group) => group.items.length > 0)
}

const CLEAR_PATTERNS = [
  /^no (?:accidents?|damage|accidents? or damage) (?:reported|found|indicated)$/,
  /^no (?:open )?recalls?(?: (?:reported|found|indicated))?$/,
  /^no (?:title brands?|odometer problems?|structural damage|frame damage) (?:reported|found|indicated)$/,
]
const CLEAR_STATUSES = new Set(['clean', 'clean title', 'pass', 'passed', 'no issue', 'no issues', 'no issue reported', 'no issues reported', 'no accident', 'no accidents', 'no accident reported', 'no accidents reported', 'no open recalls'])

/** clear | review | unknown — the same reading the app gives an AutoCheck line. */
export function autoCheckTone(status) {
  const normalized = String(status ?? '').trim().toLowerCase().replace(/[.,;:]+$/g, '').replace(/\s+/g, ' ')
  if (!normalized || normalized === 'not reported' || normalized === 'not available') return 'unknown'
  return CLEAR_STATUSES.has(normalized) || CLEAR_PATTERNS.some((pattern) => pattern.test(normalized)) ? 'clear' : 'review'
}
