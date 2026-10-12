import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import type { Server } from 'node:http'
import type { BootstrapData } from '../../../src/types'
// @ts-expect-error — the synthetic preview server is a plain JavaScript adapter.
import { createExtensionPreviewServer } from '../../../scripts/preview-extension.mjs'

let preview: Server
test.beforeAll(async () => {
  preview = createExtensionPreviewServer({ demoApiPort:4274 })
  await new Promise<void>(resolve => preview.listen(4277, '127.0.0.1', resolve))
})
test.afterAll(async () => { await new Promise<void>((resolve,reject) => preview.close(error => error ? reject(error) : resolve())) })

async function verifyDownload(download: import('@playwright/test').Download, pages?: number) {
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  const bytes = await readFile((await download.path())!)
  expect(bytes.subarray(0,8).toString()).toBe('%PDF-1.7')
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getAuthor()).toBe('Inventory Flow')
  if (pages) expect(pdf.getPageCount()).toBe(pages)
  return pdf
}

async function installNativeShare(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable:true, value:() => true })
    Object.defineProperty(navigator, 'share', { configurable:true, value:async (data:ShareData) => {
      const file = data.files![0]
      ;(window as unknown as { sharedPdf:unknown }).sharedPdf = { name:file.name, type:file.type, header:new TextDecoder().decode((await file.arrayBuffer()).slice(0,8)) }
    } })
  })
}

// Real PDF generation and browser downloads; native sharing is simulated here.
test('app saves and shares an actual PDF with recovery when file sharing is unavailable', async ({ page, browserName }) => {
  await page.addInitScript(() => { localStorage.setItem('maxey-role','sales'); localStorage.setItem('maxey-home-store','Howell') })
  await page.goto('/inventory?scope=group&vin=TESTDATAHWELL0001')
  await expect(page).toHaveTitle('Inventory Flow')
  const workspace = page.getByRole('dialog', { name:/vehicle workspace/ })
  await workspace.getByRole('button', { name:'Take-home page', exact:true }).click()
  const sheet = page.getByRole('dialog', { name:/Take-home page/ })
  const save = sheet.getByRole('button', { name:'Save PDF', exact:true })
  await expect(save).toBeEnabled({ timeout:20000 })
  const download = page.waitForEvent('download')
  await save.click()
  await verifyDownload(await download)
  await installNativeShare(page)
  await sheet.getByRole('button', { name:'Share', exact:true }).click()
  await expect(sheet.getByRole('status')).toHaveText('Shared PDF document')
  expect(await page.evaluate(() => (window as unknown as { sharedPdf:unknown }).sharedPdf)).toMatchObject({ type:'application/pdf', header:'%PDF-1.7' })
  await page.evaluate(() => { Object.defineProperty(navigator,'canShare',{ configurable:true,value:() => false }) })
  const fallback = page.waitForEvent('download')
  await sheet.getByRole('button', { name:'Share', exact:true }).click()
  await verifyDownload(await fallback)
  await expect(sheet.getByRole('status')).toHaveText('PDF saved. Share that file with your customer.')
  await sheet.getByRole('combobox', { name:'Format' }).selectOption('comparison')
  const comparison = sheet.getByRole('article', { name:'Vehicle comparison · Page 1 of 1' })
  await expect(comparison).toBeVisible()
  await expect(comparison.getByRole('img', { name:/Scan to open .* listing/ })).toHaveCount(0)
  await expect(comparison.getByText('Ask dealership', { exact: true })).toHaveCount(1)
  await expect(comparison.getByText('for details', { exact: true })).toHaveCount(1)
  const compared = page.waitForEvent('download')
  await save.click()
  expect((await verifyDownload(await compared, 1)).getPage(0).getSize()).toEqual({width:792,height:612})
  if (browserName === 'chromium') {
    const printed = await PDFDocument.load(await page.pdf({preferCSSPageSize:true,printBackground:true}))
    expect(printed.getPageCount()).toBe(1)
    expect(printed.getPage(0).getSize()).toEqual({width:792,height:612})
  }
  await sheet.getByRole('combobox', { name:'Format' }).selectOption('detailed')
  await expect(save).toBeEnabled()
  if (browserName === 'chromium') {
    const detailedPrint = await PDFDocument.load(await page.pdf({preferCSSPageSize:true,printBackground:true}))
    expect(detailedPrint.getPage(0).getSize()).toEqual({width:612,height:792})
  }
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(workspace).toBeVisible()
})

test('app creates a listing QR for an explicitly listed nonreserved synthetic VIN', async ({ page }) => {
  // SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS: the route injects a valid
  // synthetic identifier and URL into the isolated demo response only.
  const fixtureVin = 'TESTDATAHWELL0001'
  const syntheticVin = 'Z9ZTEST0000000001'
  const listingUrl = 'https://example.com/synthetic-inventory/f150'
  expect(syntheticVin).toHaveLength(17)
  expect(syntheticVin).toMatch(/^[A-HJ-NPR-Z0-9]{17}$/)

  await page.addInitScript(() => { localStorage.setItem('maxey-role','sales'); localStorage.setItem('maxey-home-store','Howell') })
  let externalListingRequests = 0
  await page.route('https://example.com/**', async route => {
    externalListingRequests += 1
    await route.abort()
  })
  await page.route('**/api/bootstrap?**', async route => {
    expect(route.request().method()).toBe('GET')
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const payload = await response.json() as BootstrapData
    expect(payload.vehicles.every(vehicle => vehicle.vin.startsWith('TESTDATA'))).toBe(true)
    const vehicle = payload.vehicles.find(candidate => candidate.vin === fixtureVin)
    expect(vehicle).toBeTruthy()
    vehicle!.vin = syntheticVin
    vehicle!.listingUrl = listingUrl
    await route.fulfill({ response, json:payload })
  })

  await page.goto(`/inventory?scope=group&vin=${syntheticVin}`)
  const workspace = page.getByRole('dialog', { name:/vehicle workspace/ })
  await workspace.getByRole('button', { name:'Take-home page', exact:true }).click()
  const sheet = page.getByRole('dialog', { name:/Take-home page/ })
  await sheet.getByRole('combobox', { name:'Format' }).selectOption('comparison')
  const comparison = sheet.getByRole('article', { name:'Vehicle comparison · Page 1 of 1' })
  const qr = comparison.getByRole('img', { name:/Scan to open .* listing/ })
  await expect(qr).toBeVisible()
  await expect(qr).toHaveAttribute('src', /^data:image\/svg\+xml,/)
  await expect(comparison.getByRole('link', { name:/Open .* listing/ })).toHaveAttribute('href', listingUrl)
  expect(externalListingRequests).toBe(0)
})

test('companion exports one branded PDF containing both customer vehicles', async ({ page }) => {
  await page.goto('http://127.0.0.1:4277/sidepanel/index.html')
  await page.evaluate(() => {
    const common = { stockNumber:'DEMO-H01', storeName:'Bob Maxey Ford of Howell', price:32000, mileage:12000, photos:['/demo-vehicles/f150.jpg'], brand:{ src:'../brands/bob-maxey-ford.png' }, specs:[['Engine','3.5L EcoBoost']], highlights:['Heated seats'], equipment:['Heated seats'], listingUrl:'https://example.com/synthetic' }
    localStorage.setItem('ifx.takehome:pdf-test', JSON.stringify({version:2,listLabel:'Synthetic vehicle choices',models:[{ ...common, vin:'TESTDATASYN000001',name:'2024 Ford F-150' },{ ...common,vin:'TESTDATASYN000002',name:'2024 Ford Escape' }]}))
  })
  await page.goto('http://127.0.0.1:4277/sidepanel/print.html#pdf-test')
  await expect(page).toHaveTitle('Synthetic vehicle choices')
  await expect(page.getByRole('button', { name:'Save PDF', exact:true })).toBeEnabled({timeout:20000})
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name:'Save PDF', exact:true }).click()
  const pdf = await verifyDownload(await download,2)
  expect(pdf.getTitle()).toBe('Synthetic vehicle choices')
  await installNativeShare(page)
  await page.getByRole('button', { name:'Share', exact:true }).click()
  await expect(page.getByRole('status')).toHaveText('Shared PDF document')
  expect(await page.evaluate(() => (window as unknown as { sharedPdf:unknown }).sharedPdf)).toMatchObject({ name:'synthetic-vehicle-choices.pdf',type:'application/pdf',header:'%PDF-1.7' })
  await page.getByRole('combobox', { name:'Format' }).selectOption('comparison')
  await expect(page).toHaveTitle('Inventory Flow vehicle comparison')
  const comparison = page.getByRole('article', { name:'Vehicle comparison · Page 1 of 1' })
  await expect(comparison).toContainText('2024 Ford F-150')
  await expect(comparison).toContainText('2024 Ford Escape')
  await expect(comparison).not.toContainText('Synthetic vehicle choices')
  const compared = page.waitForEvent('download')
  await page.getByRole('button', { name:'Save PDF', exact:true }).click()
  expect((await verifyDownload(await compared, 1)).getTitle()).toBe('Inventory Flow vehicle comparison')
  await page.getByRole('button', { name:'Share', exact:true }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { sharedPdf:unknown }).sharedPdf)).toMatchObject({ name:'inventory-flow-vehicle-comparison.pdf',type:'application/pdf',header:'%PDF-1.7' })
  await page.getByRole('combobox', { name:'Format' }).selectOption('detailed')
  await expect(comparison).toBeHidden()
  await expect(page.getByRole('heading', {name:'2024 Ford F-150',exact:true})).toBeVisible()
})
