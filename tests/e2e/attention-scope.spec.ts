import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true })

async function fullScreenshotLabelPixels(page: Page, selector: string) {
  const label = page.locator(selector)
  const box = await label.boundingBox()
  expect(box).not.toBeNull()

  const screenshot = await page.screenshot()
  return page.evaluate(async ({ box, png }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)

    const x = Math.floor(box!.x)
    const y = Math.floor(box!.y)
    const width = Math.max(1, Math.ceil(box!.width))
    const height = Math.max(1, Math.ceil(box!.height))
    const pixels = context.getImageData(x, y, width, height).data
    const buckets = new Map<string, number>()

    for (let index = 0; index < pixels.length; index += 4) {
      const key = `${Math.round(pixels[index] / 16)},${Math.round(pixels[index + 1] / 16)},${Math.round(pixels[index + 2] / 16)}`
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }

    const dominantChannels = [...buckets.entries()].sort((left, right) => right[1] - left[1])[0][0]
      .split(',')
      .map((value) => Number(value) * 16)
    let contrastingPixels = 0

    for (let index = 0; index < pixels.length; index += 4) {
      const distance = Math.abs(pixels[index] - dominantChannels[0])
        + Math.abs(pixels[index + 1] - dominantChannels[1])
        + Math.abs(pixels[index + 2] - dominantChannels[2])
      if (distance > 120) contrastingPixels += 1
    }

    return { contrastingPixels, height, width }
  }, { box, png: screenshot.toString('base64') })
}

test('Attention store scope keeps both labels readable on mobile and in forced colors', async ({ page }) => {
  await page.goto('/attention')

  const scope = page.getByRole('group', { name: 'Queue location scope' })
  const home = scope.getByRole('button', { name: 'Howell' })
  const allStores = scope.getByRole('button', { name: 'All stores' })

  await expect(home).toBeVisible()
  await expect(home).toHaveText('Howell')
  await expect(home).toHaveAttribute('aria-pressed', 'true')
  await expect(allStores).toBeVisible()
  await expect(allStores).toHaveAttribute('aria-pressed', 'false')

  const paintedHome = await fullScreenshotLabelPixels(page, '.ops-scope-switch button[aria-pressed="true"] > span')
  expect(paintedHome.contrastingPixels).toBeGreaterThan(60)

  await allStores.click()
  await expect(home).toHaveAttribute('aria-pressed', 'false')
  await expect(allStores).toHaveAttribute('aria-pressed', 'true')

  await page.emulateMedia({ forcedColors: 'active' })
  await expect(home).toBeVisible()
  await expect(home).toHaveText('Howell')
  await expect(allStores).toBeVisible()
  await expect(allStores).toHaveText('All stores')
  const selectedColors = await allStores.evaluate((element) => {
    const buttonStyle = getComputedStyle(element)
    const labelStyle = getComputedStyle(element.querySelector('span')!)
    return {
      background: buttonStyle.backgroundColor,
      foreground: buttonStyle.color,
      textFill: labelStyle.webkitTextFillColor,
    }
  })
  expect(selectedColors.foreground).not.toBe(selectedColors.background)
  expect(selectedColors.textFill).toBe(selectedColors.foreground)
})
