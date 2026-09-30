import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import type { Server } from 'node:http'
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
test('app saves and shares an actual PDF with recovery when file sharing is unavailable', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('maxey-role','sales'); localStorage.setItem('maxey-home-store','Howell') })
  await page.goto('/inventory?scope=group&vin=TESTDATAHWELL0001')
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
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(workspace).toBeVisible()
})

test('companion exports one branded PDF containing both customer vehicles', async ({ page }) => {
  await page.goto('http://127.0.0.1:4277/sidepanel/index.html')
  await page.evaluate(() => {
    const common = { stockNumber:'DEMO-H01', storeName:'Bob Maxey Ford of Howell', price:32000, mileage:12000, photos:['/demo-vehicles/f150.jpg'], brand:{ src:'../brands/bob-maxey-ford.png' }, specs:[['Engine','3.5L EcoBoost']], highlights:['Heated seats'], equipment:['Heated seats'], listingUrl:'https://example.com/synthetic' }
    localStorage.setItem('ifx.takehome:pdf-test', JSON.stringify({version:2,listLabel:'Synthetic vehicle choices',models:[{ ...common, vin:'TESTDATASYN000001',name:'2024 Ford F-150' },{ ...common,vin:'TESTDATASYN000002',name:'2024 Ford Escape' }]}))
  })
  await page.goto('http://127.0.0.1:4277/sidepanel/print.html#pdf-test')
  await expect(page.getByRole('button', { name:'Save PDF', exact:true })).toBeEnabled({timeout:20000})
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name:'Save PDF', exact:true }).click()
  const pdf = await verifyDownload(await download,2)
  expect(pdf.getTitle()).toBe('Synthetic vehicle choices')
  await installNativeShare(page)
  await page.getByRole('button', { name:'Share', exact:true }).click()
  await expect(page.getByRole('status')).toHaveText('Shared PDF document')
  expect(await page.evaluate(() => (window as unknown as { sharedPdf:unknown }).sharedPdf)).toMatchObject({ name:'synthetic-vehicle-choices.pdf',type:'application/pdf',header:'%PDF-1.7' })
})
