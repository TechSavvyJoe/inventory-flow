import { expect, test, type Page } from '@playwright/test'

// Pinned visual baseline. See playwright.visual.config.ts for why this only
// means anything compared against itself inside the CI container.
//
// Fixed to the synthetic fixture's frozen instant (fixtures/synthetic-release.mjs
// SYNTHETIC_NOW) so every relative-time and "today" label renders the same
// text on every run, in every timezone the suite is ever run from.
const SYNTHETIC_NOW = new Date('2026-08-30T10:15:00-04:00')
const VIN = 'TESTDATAHWELL0001'

async function freeze(page: Page) {
  await page.clock.setFixedTime(SYNTHETIC_NOW)
}

async function signInAs(page: Page, role: 'sales' | 'manager' | 'group_manager', homeStore = 'Howell') {
  await page.addInitScript(([r, s]) => {
    window.localStorage.setItem('maxey-role', r as string)
    window.localStorage.setItem('maxey-home-store', s as string)
  }, [role, homeStore])
}

async function settle(page: Page) {
  await expect(page.locator('main')).toBeVisible()
  await page.waitForLoadState('networkidle')
}

function snapshot(page: Page, name: string) {
  // Photos are illustrative synthetic assets swapped in by
  // fixtures/synthetic-photos.mjs and are not the thing this gate protects;
  // masking them keeps the pinned baseline about layout and CSS, not image
  // bytes. Animations are frozen so a mid-transition frame never gets pinned.
  return expect(page).toHaveScreenshot(name, {
    mask: [page.locator('img')],
    animations: 'disabled',
    fullPage: false,
  })
}

test.describe('inventory', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'sales')
    await freeze(page)
  })

  test('inventory list', async ({ page }) => {
    await page.goto('/inventory')
    await settle(page)
    await expect(page.getByRole('heading', { name: /inventory$/i })).toBeVisible()
    await snapshot(page, 'inventory-list.png')
  })

  test('inventory filters open', async ({ page }) => {
    await page.goto('/inventory')
    await settle(page)
    await page.getByRole('button', { name: /^Filters/ }).click()
    await expect(page.locator('.inventory-filter-panel')).toBeVisible()
    await snapshot(page, 'inventory-filters-open.png')
  })

  test('vehicle workspace overview', async ({ page }) => {
    await page.goto(`/inventory?scope=group&vin=${VIN}&tab=overview`)
    await expect(page.getByRole('dialog')).toBeVisible()
    await settle(page)
    await snapshot(page, 'vehicle-workspace-overview.png')
  })

  test('vehicle workspace holds and moves', async ({ page }) => {
    await page.goto(`/inventory?scope=group&vin=${VIN}&tab=hold`)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Holds & moves', selected: true })).toBeVisible()
    await settle(page)
    await snapshot(page, 'vehicle-workspace-holds.png')
  })
})

test.describe('moves', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'manager')
    await freeze(page)
  })

  test('moves list', async ({ page }) => {
    await page.goto('/transfers')
    await settle(page)
    await expect(page.getByRole('heading', { name: 'Vehicle moves' })).toBeVisible()
    await snapshot(page, 'moves-list.png')
  })

  test('moves tracker', async ({ page }) => {
    await page.goto('/transfers')
    await settle(page)
    const firstMove = page.locator('.transfer-list-item').first()
    await firstMove.waitFor()
    await firstMove.click()
    await expect(page.locator('#transfer-detail-workspace')).toBeVisible()
    await settle(page)
    await snapshot(page, 'moves-tracker.png')
  })
})

test.describe('service', () => {
  test('service status', async ({ page }) => {
    await signInAs(page, 'manager')
    await freeze(page)
    await page.goto('/service')
    await settle(page)
    await expect(page.getByRole('heading', { name: 'Service status' })).toBeVisible()
    await snapshot(page, 'service.png')
  })
})

test.describe('admin', () => {
  test('control center', async ({ page }) => {
    await signInAs(page, 'group_manager')
    await freeze(page)
    await page.goto('/admin')
    await settle(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Control center' })).toBeVisible()
    await snapshot(page, 'admin.png')
  })
})
