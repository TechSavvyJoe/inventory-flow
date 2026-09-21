import { formatDate, formatSourceDateText, formatNumber, formatStickerMoney } from './format.mjs'
import { sourceDisplayText } from './source-text.mjs'
import { sourceDistanceText } from './source-distance.mjs'

// Read-only report summaries for the inventory list and vehicle overview.
// Accept the panel view model, never raw API URLs. documentsFor() already
// applies the same provider and exact-listing URL guards as the web app.
const clean = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : null
const numeric = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const entries = (value) => Array.isArray(value) ? value : []
const present = (values, limit = Infinity) => {
  const seen = new Set()
  return values.map(clean).filter((value) => {
    if (!value || seen.has(value.toLowerCase())) return false
    seen.add(value.toLowerCase())
    return true
  }).slice(0, limit)
}
const join = (values) => present(values).join(' · ') || null
// Source prose that can state a distance: a Canadian sticker, an OASIS factory
// term or an AutoCheck detail line may print kilometres. Applied once, where
// the raw field enters a fact, so a converted string is never re-converted.
const fact = (value) => { const cleaned = clean(value); return cleaned === null ? null : sourceDistanceText(cleaned) }

function captureTimestamp(value) {
  const raw = clean(value)
  if (!raw) return null
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) return null
  // Date.parse silently normalizes some impossible calendar dates. Those
  // cannot establish a completed report, even when their timestamp is past.
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(raw)
  if (calendar) {
    const date = new Date(Date.UTC(+calendar[1], +calendar[2] - 1, +calendar[3]))
    if (date.getUTCFullYear() !== +calendar[1] || date.getUTCMonth() !== +calendar[2] - 1 || date.getUTCDate() !== +calendar[3]) return null
  }
  return timestamp
}

function sourceNote(record, hasFacts, { date, dateLabel = 'Captured', missing = 'No report details captured', now } = {}) {
  const timestamp = captureTimestamp(date)
  return join([
    record?.dataState === 'stale' || record?.dataState === 'stale_unverified' ? 'Saved report · refresh at source'
      : record?.dataState === 'incomplete' ? 'Partial captured record'
        : record?.dataState === 'unavailable' ? 'Source currently unavailable'
          : record?.dataState === 'unknown' ? 'Source status unknown' : null,
    !hasFacts ? missing : null,
    clean(date) ? timestamp === null ? `Unrecognized source date: ${date}` : timestamp > now ? `Future source date: ${formatDate(date, now)}` : `${dateLabel} ${formatDate(date, now)}` : null,
    record?.sourceMessage, record?.failureReason,
  ])
}

export function capturedOasisActionsAreEmpty(oasis, { now = Date.now() } = {}) {
  const timestamp = captureTimestamp(oasis?.capturedAt)
  return oasis?.openActionsCaptured === true && Array.isArray(oasis.openFieldServiceActions) && oasis.openFieldServiceActions.length === 0
    && timestamp !== null && timestamp <= now && ['current', 'stale', 'stale_unverified'].includes(oasis.dataState)
}

// A negated AutoCheck finding often names several subjects at once, as in
// "No accidents or damage reported". Consuming only the first subject leaves
// the rest to match the adverse keywords below, which turns an ordinary clean
// line into a false vehicle-history warning, so remove the whole chain.
const NEGATED_SUBJECT = '(?:(?:reported|recorded|known|major|structural)\\s+)?(?:accidents?|damages?|issues?|problems?|records?|title brands?|salvage|flood|odometer discrepancies|rollback)'
const NEGATED_FINDING = new RegExp(`\\b(?:no|zero|0|without|not)\\s+${NEGATED_SUBJECT}(?:\\s*(?:,|\\/|\\bor\\b|\\band\\b)\\s*${NEGATED_SUBJECT})*(?:\\s+(?:reported|recorded|found|detected))?`, 'gi')

function checkPriority(check) {
  // Ranking only: always display the source wording, never infer a clean
  // vehicle, completed service, availability, or remaining warranty.
  const result = join([check.status, check.detail]) ?? ''
  const unnegated = result.replace(NEGATED_FINDING, '')
  if (/\b(?:warning|review|alert|issue|problem|damage|accident|salvage|rebuilt|flood|rollback|discrepanc\w*|conflict\w*|not actual|theft|stolen|lemon|buyback|branded|lien)\b/i.test(unnegated)) return 0
  if (/accident|damage|title|odometer/i.test(check.label) && /\b(?:[1-9]\d*\s+records?|brand|reported|found)\b/i.test(unnegated)) return 0
  if (/\b(?:unknown|unavailable|not reported|not captured|not checked|unable|incomplete)\b/i.test(result)) return 1
  if (/accident|damage|title|odometer/i.test(check.label)) return 2
  return 3
}

/** Explicit adverse/missing detail overrides a nominally clear status color. */
export function historyDetailTone(detail) {
  const priority = checkPriority({ status: detail })
  return priority === 0 ? 'review' : priority === 1 ? 'unknown' : null
}

function historyChecks(history) {
  return entries(history?.checks).filter((check) => clean(check?.label) && (clean(check.status) || clean(check.detail)))
    .map((check, index) => ({
      priority: checkPriority(check), index,
      full: fact(`${clean(check.label)}: ${join([check.status, check.detail])}`),
      compact: fact(`${clean(check.label)}: ${join([check.status, !clean(check.status) || checkPriority({ label: check.label, status: check.detail }) <= 1 ? check.detail : null])}`),
    })).sort((a, b) => a.priority - b.priority || a.index - b.index)
}

function importantItems(values) {
  const items = present(values).map((item) => sourceDistanceText(item))
  const important = /360|camera|adaptive cruise|blind spot|blis\b|heated|ventilated|cooled|leather|tow|trailer|moonroof|sunroof|panoramic|power liftgate|navigation|remote start/i
  return [...items.filter((item) => important.test(item)), ...items.filter((item) => !important.test(item))]
}

function coverageFacts(block, estimate = false) {
  return entries(block?.coverages).map((coverage) => join([
    `${estimate ? 'Warranty estimate' : 'Captured warranty'}: ${coverage.type}`,
    coverage.status, fact(coverage.termText),
    coverage.remainingTimeText ? `${coverage.remainingTimeText} remaining time` : null,
    coverage.remainingMilesText ? `${fact(coverage.remainingMilesText)} remaining miles` : null,
  ]))
}

/** Reports remain evidence; service, hold, listing, and custody are separate. */
export function resourceSummaries(vehicle, { now = Date.now() } = {}) {
  const result = []
  const docs = vehicle.documents ?? {}
  const fordFamily = /^(ford|lincoln)$/i.test(clean(vehicle.make) ?? '')
  const sticker = docs.windowSticker
  const options = importantItems(entries(sticker?.options))
  const stickerPowertrain = join([fact(sticker?.engine), fact(sticker?.transmission)])
  const stickerFacts = present([
    numeric(sticker?.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker)} MSRP` : null,
    sticker?.equipmentGroup, ...entries(sticker?.equipmentGroupContents), ...options.slice(0, 2), stickerPowertrain, ...options.slice(2),
    join([sticker?.exteriorColor ? `Exterior ${sticker.exteriorColor}` : null, sticker?.interiorColor ? `Interior ${sticker.interiorColor}` : null]),
    ...importantItems(entries(sticker?.standardEquipment)),
    ...entries(sticker?.warranty).map((line) => `Printed warranty: ${fact(line)}`),
  ])
  if (sticker) result.push({
    id: 'window-sticker', title: 'Window sticker', brand: fordFamily ? 'ford' : null, facts: stickerFacts,
    compactFacts: present([
      join([numeric(sticker.totalMsrp) ? `${formatStickerMoney(sticker.totalMsrp, sticker)} MSRP` : null, sticker.equipmentGroup]),
      join(options.slice(0, 2)) ?? stickerPowertrain ?? sticker.standardEquipment?.[0], ...stickerFacts,
    ], 2),
    sourceNote: sourceNote(sticker, stickerFacts.length > 0, { now }),
    url: sticker.url, sourceKind: sticker.url ? 'Original source' : 'Saved data', target: 'records', hasCapturedData: stickerFacts.length > 0,
  })

  const history = docs.autoCheck
  const checks = historyChecks(history)
  const warranty = docs.warrantyCheck
  const range = numeric(history?.rangeLow) && numeric(history?.rangeHigh) && history.rangeLow <= history.rangeHigh ? `${formatNumber(history.rangeLow)}–${formatNumber(history.rangeHigh)} range` : null
  const score = numeric(history?.score) ? join([`Score ${formatNumber(history.score)}`, range]) : null
  const ownership = join([numeric(history?.ownerCount) ? `${formatNumber(history.ownerCount)} ${history.ownerCount === 1 ? 'owner' : 'owners'}` : null, fact(history?.usage)])
  const odometer = numeric(history?.lastReportedOdometer) ? `Last reported ${formatNumber(history.lastReportedOdometer)} mi${clean(history.lastReportedOdometerDate) ? ` · ${formatDate(history.lastReportedOdometerDate, now)}` : ''}` : null
  const historyFacts = present([
    ...checks.filter((check) => check.priority <= 1).map((check) => check.full), score, ownership, odometer,
    ...checks.filter((check) => check.priority > 1).map((check) => check.full),
    clean(history?.inServiceDate) ? `Estimated warranty start ${formatDate(history.inServiceDate, now)}` : null,
    history?.vehicleClass ? `Vehicle class: ${history.vehicleClass}` : null,
    history?.assemblyCountry ? `Assembly: ${history.assemblyCountry}` : null,
    ...coverageFacts(warranty?.autoCheck, true),
  ])
  if (history || warranty?.autoCheck) result.push({
    id: 'autocheck', title: 'AutoCheck', brand: 'autocheck', facts: historyFacts,
    compactFacts: present([
      ...checks.filter((check) => check.priority <= 1).map((check) => check.compact),
      join([numeric(history?.score) ? `Score ${formatNumber(history.score)}` : null, ownership]),
      checks.find((check) => check.priority > 1)?.compact, odometer, ...historyFacts,
    ], 2),
    sourceNote: join([
      sourceNote(history, historyFacts.length > 0, { date: history?.reportRunAt, dateLabel: 'Report run', now }),
      warranty?.autoCheck ? join(['Captured warranty estimate, not OASIS coverage', sourceNote(warranty, true, { date: warranty.capturedAt, dateLabel: 'Warranty captured', now }), numeric(warranty.mileageEntered) ? `At ${formatNumber(warranty.mileageEntered)} mi entered` : null]) : null,
    ]),
    url: history?.url ?? null, sourceKind: history?.url ? 'Original source' : 'Saved data', target: 'records', hasCapturedData: historyFacts.length > 0,
  })

  const factory = docs.factoryEquipment
  const packages = present(entries(factory?.packages).map((pkg) => join([pkg.name, pkg.code])))
  const equipmentItems = importantItems([
    ...entries(factory?.sections).flatMap((section) => entries(section.items).map((item) => item.label)),
    ...entries(factory?.packages).flatMap((pkg) => entries(pkg.features)),
  ])
  const powertrain = join([fact(factory?.engine), fact(factory?.transmission), factory?.drivetrain])
  const equipmentFacts = present([
    ...packages, ...equipmentItems.slice(0, 4), powertrain,
    join([factory?.exteriorColor ? `Exterior ${factory.exteriorColor}` : null, factory?.interiorColor ? `Interior ${factory.interiorColor}` : null]),
    numeric(factory?.totalMsrp) ? `${formatNumber(factory.totalMsrp)} reference MSRP · currency not captured` : null,
    ...equipmentItems.slice(4),
  ])
  if (factory) result.push({
    id: 'vauto', title: 'vAuto equipment', brand: 'vauto', facts: equipmentFacts,
    compactFacts: present([join(packages.slice(0, 2)), join(equipmentItems.slice(0, 2)) ?? powertrain, powertrain, ...equipmentFacts], 2),
    sourceNote: join(['Informational · not an original sticker', sourceNote(factory, equipmentFacts.length > 0, { date: factory.capturedAt, now })]),
    url: factory.url, sourceKind: factory.url ? 'Source document' : 'Saved data', target: 'equipment', hasCapturedData: equipmentFacts.length > 0,
  })

  if (fordFamily) {
    const oasis = docs.fordOasis
    const actions = present(entries(oasis?.openFieldServiceActions).map((action) => join([action.code, fact(sourceDisplayText(action.description))])))
    const coverages = present(entries(oasis?.warrantyCoverages).map((coverage) => join([coverage.type, fact(sourceDisplayText(coverage.description))])))
    const capturedEmpty = capturedOasisActionsAreEmpty(oasis, { now })
    const warrantyStart = clean(oasis?.warrantyStartDate) ? `Warranty start ${formatDate(oasis.warrantyStartDate, now)}` : clean(warranty?.fordOasis?.warrantyStartDate) ? `Warranty start ${formatDate(warranty.fordOasis.warrantyStartDate, now)}` : null
    const buildDate = clean(oasis?.buildDate) ? `Built ${formatDate(oasis.buildDate, now)}` : null
    const oasisFacts = present([
      ...actions.map((action) => `Open FSA ${action}`), warrantyStart, buildDate,
      ...coverages.map((coverage) => `Recorded coverage: ${coverage}`),
      capturedEmpty ? '0 open Ford actions in captured report' : null,
      ...entries(oasis?.extendedCoverageExpirations).map((expiration) => `Extended coverage: ${fact(formatSourceDateText(expiration))}`),
      numeric(oasis?.monthsInService) ? `${formatNumber(oasis.monthsInService)} months in service at capture` : null,
      numeric(oasis?.saleMileage) ? `${formatNumber(oasis.saleMileage)} mi at sale` : null,
      clean(oasis?.releaseDate) ? `Released ${formatDate(oasis.releaseDate, now)}` : null,
      ...coverageFacts(warranty?.fordOasis),
    ])
    if (vehicle.links?.oasis || oasis || warranty?.fordOasis) result.push({
      id: 'oasis', title: 'Ford OASIS', brand: 'ford', facts: oasisFacts,
      compactFacts: present([actions.length && oasis?.openActionsCaptured === false ? `At least ${actions.length} captured actions · result incomplete` : null, actions[0] ? `Open FSA ${actions[0]}` : null, warrantyStart, coverages[0] ? `Recorded coverage: ${coverages[0]}` : null, capturedEmpty ? '0 open Ford actions in captured report' : null, buildDate, ...oasisFacts, !oasisFacts.length ? 'DealerConnection sign-in' : null], 2),
      sourceNote: join([
        actions.length && oasis?.openActionsCaptured === false ? `At least ${actions.length} captured actions · result incomplete` : null,
        sourceNote(oasis, oasisFacts.length > 0, { date: oasis?.capturedAt, missing: 'No OASIS report details captured', now }),
        oasisFacts.length > 0 && !actions.length && !capturedEmpty ? 'Open-action result not captured' : null,
        warranty?.fordOasis ? join([sourceNote(warranty, true, { date: warranty.capturedAt, dateLabel: 'Warranty captured', now }), numeric(warranty.mileageEntered) ? `At ${formatNumber(warranty.mileageEntered)} mi entered` : null]) : null,
      ]),
      url: vehicle.links?.oasis ?? null, sourceKind: vehicle.links?.oasis ? 'Dealer lookup' : 'Saved data', target: 'records', hasCapturedData: oasisFacts.length > 0,
    })
    if (vehicle.links?.invoice) result.push({
      id: 'invoice', title: 'Ford invoice', brand: 'ford', facts: [], compactFacts: ['DealerConnection sign-in'],
      sourceNote: 'Invoice details are not captured', url: vehicle.links.invoice, sourceKind: 'Dealer lookup', target: 'records', hasCapturedData: false,
    })
  }
  return result
}
