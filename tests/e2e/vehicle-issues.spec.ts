import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'manager')
    localStorage.setItem('maxey-home-store', 'Howell')
  })
})

test('reports, assigns, and manager-confirms a vehicle issue through the real demo HTTP routes', async ({ page }, testInfo) => {
  const vin = testInfo.project.name === 'mobile' ? 'TESTDATAHWELL0002' : 'TESTDATAHWELL0001'
  await page.goto(`/inventory?scope=group&vin=${vin}`)

  const workspace = page.getByRole('dialog', { name: /vehicle workspace/ })
  await expect(workspace).toBeVisible({ timeout: 15_000 })
  await workspace.getByRole('button', { name: 'Report issue', exact: true }).click()

  const report = page.getByRole('dialog', { name: 'Report a vehicle issue' })
  await expect(report).toBeVisible()
  await report.getByLabel('Category').selectOption('cleaning')
  await report.getByLabel('Priority').selectOption('urgent')
  await report.getByLabel('What needs attention?').fill('Synthetic lot check found mud on the driver door.')
  await report.getByLabel(/Photos/).setInputFiles('public/demo-vehicles/f150.jpg')
  await expect(report.getByAltText('Selected issue photo 1')).toBeVisible()
  await report.getByRole('button', { name: 'Report issue', exact: true }).click()

  await expect(report).toBeHidden()
  await expect(workspace.getByRole('tab', { name: 'Issues' })).toHaveAttribute('aria-selected', 'true')
  const detail = workspace.getByRole('region', { name: 'Vehicle issue details' })
  await expect(detail.getByText('Cleaning issue')).toBeVisible()
  await expect(detail.getByText('Photos (1)', { exact: true })).toBeVisible()

  await detail.getByLabel('Action').selectOption('assign')
  await detail.getByLabel('Assign to').fill('Synthetic detail team')
  await detail.getByRole('button', { name: 'Assign', exact: true }).click()
  await expect(detail.getByText('Issue updated.')).toBeVisible()
  await expect(detail).toContainText('Synthetic detail team')

  await detail.getByLabel('Action').selectOption('complete')
  await detail.getByLabel('Completion note').fill('Synthetic manager inspected the cleaned door in person.')
  await detail.getByRole('button', { name: 'Confirm completion', exact: true }).click()
  await expect(detail.getByText('Completion confirmed.')).toBeVisible()
  await expect(detail.getByText('Completed', { exact: true })).toBeVisible()
})
