import { expect, test } from '@playwright/test'

test('scanner is mobile-only and finds vehicles despite conflicting filters', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('maxey-role', 'sales')
    localStorage.setItem('maxey-home-store', 'Howell')
    // A synthetic pending permission request proves the explicit manual path
    // works without relying on the test machine's camera or permission policy.
    let requests = 0
    Object.defineProperty(window, '__syntheticCameraRequests', { get: () => requests })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: () => { requests++; return new Promise(() => {}) },
    } })
  })
  await page.goto('/inventory')
  await expect(page.getByRole('button', { name: /^No hold:/ })).toHaveAttribute('aria-pressed', 'true')
  const trigger = page.getByRole('button', { name: 'Scan vehicle', exact: true })
  if ((page.viewportSize()?.width ?? 0) > 760) {
    await expect(trigger).not.toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Scan vehicle', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __syntheticCameraRequests: number }).__syntheticCameraRequests)).toBe(0)
    return
  }
  await page.getByRole('button', { name: /^Held:/ }).click()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Scan vehicle', exact: true })
  // This suite serves React development mode: StrictMode replays setup after
  // cleanup. The packaged-browser check separately verifies one production open.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __syntheticCameraRequests: number }).__syntheticCameraRequests)).toBe(2)
  await expect(dialog.getByRole('textbox', { name: 'VIN or stock number' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Enter number', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'VIN or stock number' }).fill('DEMO-H02')
  await dialog.getByRole('button', { name: 'Show DEMO-H02 in inventory' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Search inventory' })).toHaveValue('TESTDATAHWELL0002')
  await expect(page.getByText('Showing 1–1 of 1')).toBeVisible()
  // Other specs share the synthetic server and may already have saved this
  // vehicle. Reset only this entry so this flow always exercises a real save.
  const save = page.getByRole('button', { name: 'Save DEMO-H02 to shortlist', exact: true })
  const remove = page.getByRole('button', { name: 'Remove DEMO-H02 from shortlist', exact: true })
  await expect(save.or(remove)).toBeVisible()
  if (await remove.isVisible()) await remove.click()
  await save.click()
  const naming = page.getByRole('dialog', { name: /Save to a customer list|Name this customer list/ })
  await expect(naming.or(remove)).toBeVisible()
  if (await naming.isVisible()) {
    await naming.getByRole('textbox', { name: 'List name', exact: true }).fill('AB · Scanner demo')
    await naming.getByRole('button', { name: 'Save vehicle', exact: true }).click()
    await expect(naming).toBeHidden()
  }
  await expect(page.getByRole('button', { name: 'Remove DEMO-H02 from shortlist', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await trigger.click()
  await expect(dialog.getByRole('textbox', { name: 'VIN or stock number' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Enter number', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'VIN or stock number' }).fill('DEMO-NO-MATCH')
  await expect(dialog.getByText(/No matching vehicle in the loaded inventory/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('combobox', { name: 'Search inventory' })).toHaveValue('TESTDATAHWELL0002')
})
