import { expect, type Page } from '@playwright/test'

export async function chooseInventoryView(page: Page, value: 'all' | 'held' | 'no-hold' | 'offsite') {
  const select = page.getByRole('combobox', { name: 'Inventory quick view', exact: true })
  if ((page.viewportSize()?.width ?? 0) <= 760) {
    await expect(select).toBeVisible()
    await select.selectOption(value)
    await expect(select).toHaveValue(value)
  } else {
    const labels = { all: /^All:/, held: /^Held:/, 'no-hold': /^No hold:/, offsite: /^(?:Offsite|Away from home):/ }
    await page.getByRole('button', { name: labels[value] }).click()
  }
}
