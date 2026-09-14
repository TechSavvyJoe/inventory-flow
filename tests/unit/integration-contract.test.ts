// @vitest-environment node
// @ts-nocheck -- portable ESM modules; every fixture below is synthetic.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createIntegrationReadService } from '../../server/integrations/read-service.mjs'

const spec = JSON.parse(readFileSync(new URL('../../docs/inventory-flow.openapi.json', import.meta.url), 'utf8'))
const workerSource = readFileSync(new URL('../../cloudflare/src/integration-worker.mjs', import.meta.url), 'utf8')
const SECRET = 'synthetic-contract-cursor-key-never-use-live-01234567'
const vinFor = (index: number) => `1FTFW1E50NFA${String(index).padStart(5, '0')}`

// A published path is only honest if the deployed Worker answers it. Both the
// literal routes and the templated VIN route are read back out of the route
// table itself so a new endpoint cannot ship without appearing in the contract.
function workerRoutes() {
  const literal = [...workerSource.matchAll(/url\.pathname === '\/api\/v1([^']*)'/g)].map(match => match[1])
  const templated = /\/\^\\\/api\\\/v1\\\/vehicles\\\/\(\[A-HJ-NPR-Z0-9\]\{17\}\)\$\//.test(workerSource) ? ['/vehicles/{vin}'] : []
  return [...literal, ...templated].sort()
}

function resolve(schema) {
  return schema && schema.$ref ? resolve(spec.components.schemas[schema.$ref.replace('#/components/schemas/', '')]) : schema
}

// Walks a real response against the published schema and collects every field
// the API returns that a strict validator (additionalProperties: false) would
// reject, plus every required field the response does not actually carry.
function contractGaps(value, schema, path = '') {
  const resolved = resolve(schema)
  if (!resolved || value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap((item, index) => contractGaps(item, resolved.items, `${path}[${index}]`))
  if (typeof value !== 'object') return []
  const properties = resolved.properties ?? {}
  const gaps = []
  if (resolved.additionalProperties === false) {
    for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) gaps.push(`undeclared ${path}.${key}`)
  }
  for (const key of resolved.required ?? []) if (!Object.hasOwn(value, key)) gaps.push(`missing required ${path}.${key}`)
  for (const [key, child] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) gaps.push(...contractGaps(value[key], child, `${path}.${key}`))
  }
  return gaps
}

function service() {
  const vehicle = {
    vin: vinFor(1), stockNumber: '0001TEST', year: 2024, make: 'Ford', model: 'F-150', trim: 'XLT', vehicleName: '2024 Ford F-150 XLT',
    listedPrice: 42810, msrp: 65000, mileage: 2052, daysListed: 4, exteriorColor: 'Oxford White', interiorColor: 'Black',
    bodyStyle: 'SuperCrew', bodyType: 'Truck', drivetrain: '4WD', engine: '3.5L EcoBoost', transmission: '10-speed automatic',
    fuelType: 'Gasoline', mpgCity: 17, mpgHighway: 23, certified: true, inventoryDate: '2026-09-09', modelCode: 'W1E',
    features: 'Trailer Tow Package', listingUrl: 'https://www.bobmaxeyfordhowell.com/used', photoCount: 1,
    imageUrl: 'https://images.dealeron.com/car.jpg', imageUrls: ['https://images.dealeron.com/car.jpg'],
    publicStore: 'Howell', homeStore: 'Howell', homeStoreConfirmed: true, crmStore: 'Howell', sourceReportedLocation: 'Howell',
    websiteStatus: 'Not provided', publicListingState: 'Listed publicly; availability not confirmed',
    dealerOn: { inStock: true, inTransit: false, inProduction: false },
    hold: { state: 'none_observed', backupCount: 0 },
    // newRequestBlocked is an app-API field; the Location schema below is
    // additionalProperties: false, so the contract walk proves it stays out.
    movement: { state: 'arrived', currentLocation: 'Howell', lastConfirmedAt: '2026-09-09T12:00:00Z', locationConfidence: 'verified', newRequestBlocked: true },
    managerDisposition: {
      stockNumber: '0001TEST', vin: vinFor(1), vehicleName: '2024 Ford F-150 XLT', soldManagerLog: true, deliveredManagerLog: true,
      deliveryDate: '2026-09-09', confidence: 'high', sourceStore: 'Howell', sourcePeriod: '2026-09', matchMethod: 'vin',
      matchStatus: 'matched', physicalStore: 'Howell', reviewRequired: false,
    },
  }
  return createIntegrationReadService({
    bootstrap: {
      meta: {
        reportDate: '2026-09-09', completedAt: '2026-09-09T13:00:00Z', timezone: 'America/New_York',
        publicFreshness: 'current', dealerMailFreshness: 'current', managerDispositionFreshness: 'current',
        managerDispositionCoverageStatus: 'provided', managerDispositionCoveredSourceStores: ['Howell'],
      },
      vehicles: [vehicle],
      publicChanges: [{ id: 'change-1', type: 'price_change', field: 'Listed price', valueType: 'money', reportDate: '2026-09-09', previousReportDate: '2026-09-08', vin: vinFor(1), stockNumber: '0001TEST', vehicleName: '2024 Ford F-150', store: 'Howell', beforeValue: 44000, afterValue: 42810, currentVehicle: true }],
      managerDispositions: [vehicle.managerDisposition],
    },
    principal: { clientId: 'synthetic-contract-client', userId: 'synthetic-user', role: 'sales', stores: ['Howell'], scopes: ['inventory.read', 'changes.read', 'health.read', 'holds.aggregate.read'] },
    bundleSha256: 'a'.repeat(64), cursorSecret: SECRET,
  })
}

describe('published integration contract', () => {
  it('publishes exactly the endpoints the deployed Worker answers', () => {
    // A connected application generates its client from this document. A route
    // the Worker serves but the contract omits is invisible to every generated
    // client; a route the contract promises but the Worker rejects is a 404.
    expect(Object.keys(spec.paths).sort()).toEqual(workerRoutes())
  })

  it('documents every published endpoint for the humans who wire up a consumer', () => {
    // The endpoint table in SHARED_DATA_API.md is what an integrator reads
    // before generating anything, so an endpoint missing from it is missing.
    const doc = readFileSync(new URL('../../docs/SHARED_DATA_API.md', import.meta.url), 'utf8')
    const documented = [...doc.matchAll(/^\| `(\/[^`]*)` \| /gm)].map(match => match[1]).sort()
    expect(documented).toEqual(Object.keys(spec.paths).sort())
  })

  it.each([
    ['inventory', api => api.inventory(), 'InventoryPage'],
    ['vehicle detail', api => api.vehicle(vinFor(1)), 'VehicleResponse'],
    ['changes', api => api.changes(), 'ChangesPage'],
    ['data health', api => api.health(), 'HealthResponse'],
    ['hold summary', api => api.holdSummary(), 'HoldSummaryResponse'],
    ['manager dispositions', api => api.managerDispositions(), 'ManagerDispositionsPage'],
  ])('describes every field the %s response actually returns', (_label, call, schemaName) => {
    // The schemas are additionalProperties: false, so anything the API returns
    // and the contract omits makes a validating consumer reject a correct
    // production response outright.
    const schema = spec.components.schemas[schemaName]
    expect(schema, `${schemaName} is not published`).toBeTruthy()
    expect(contractGaps(call(service()), schema)).toEqual([])
  })

  it('describes the capabilities document a consumer negotiates against', () => {
    expect(contractGaps(service().capabilities, spec.components.schemas.Capabilities)).toEqual([])
  })
})
