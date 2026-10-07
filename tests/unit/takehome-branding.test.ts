// @vitest-environment node
// @ts-nocheck -- shared framework-free browser module; fabricated records only.
import { describe, expect, it } from 'vitest'
import { createComparisonPlan } from '../../extension/sidepanel/lib/takehome-comparison.mjs'

const vehicle = (index, storeName) => ({
  vin: `TESTDATASYN${String(index).padStart(6, '0')}`,
  stockNumber: `DEMO-${index}`, name: 'Synthetic vehicle', storeName,
  storeSite: 'example.com', specs: [], highlights: [],
})
const plan = (models, logos = []) => createComparisonPlan(models, {
  wrap: value => String(value).split('\n'),
  logoSources: new Map(models.map((model, index) => [model.vin, logos[index] ?? null])),
})

describe('customer comparison account branding', () => {
  it('retains a supplied dealership name and logo for a same-store comparison', () => {
    const models = [vehicle(1, 'Example Motors'), vehicle(2, 'Example Motors')]
    const logo = { src: '/example-motors.svg', alt: 'Example Motors' }
    expect(plan(models, [logo, logo]).pages[0]).toMatchObject({
      headerStore: 'Example Motors', headerSite: 'example.com', headerLogo: logo,
    })
  })

  it('uses product branding across stores and retains each vehicle store attribution', () => {
    const models = [vehicle(1, 'Example Motors East'), vehicle(2, 'Example Motors West')]
    const page = plan(models, [{ src: '/east.svg' }, { src: '/west.svg' }]).pages[0]
    expect(page).toMatchObject({ headerStore: 'Inventory Flow', headerSite: '', headerLogo: null })
    expect(page.vehicles.map(model => model.storeName)).toEqual(['Example Motors East', 'Example Motors West'])
    expect(page.rows.find(row => row.kind === 'store').cells.map(cell => cell.lines)).toEqual([
      ['Example Motors East'], ['Example Motors West'],
    ])
  })

  it('uses a common logo only when every store explicitly supplies the same asset', () => {
    const models = [vehicle(1, 'Example Motors East'), vehicle(2, 'Example Motors West')]
    const logo = { src: '/example-group.svg', alt: 'Example Group' }
    expect(plan(models, [logo, logo]).pages[0].headerLogo).toEqual(logo)
    expect(plan(models, [logo, null]).pages[0].headerLogo).toBeNull()
  })

  it('does not infer a shared logo from Bob Maxey store names', () => {
    const models = [vehicle(1, 'Bob Maxey Ford of Howell'), vehicle(2, 'Bob Maxey Ford in Fowlerville')]
    const page = plan(models, [{ src: '/bob-maxey-ford.png' }, { src: '/bob-maxey-fowlerville.png' }]).pages[0]
    expect(page).toMatchObject({ headerStore: 'Inventory Flow', headerLogo: null })
  })
})
