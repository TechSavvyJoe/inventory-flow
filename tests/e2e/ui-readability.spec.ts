import { expect, test, type Page } from '@playwright/test'

const coreRoutes = ['/inventory', '/transfers', '/attention', '/overview', '/service', '/updates'] as const

type ReadabilityViolation = {
  fontSize: number
  selector: string
  text: string
}

type ContrastViolation = {
  contrast: number
  foreground: string
  background: string
  selector: string
  text: string
}

async function collectReadabilityViolations(page: Page) {
  return page.evaluate<ReadabilityViolation[]>(() => {
    const main = document.querySelector('main')
    if (!main) return [{ fontSize: 0, selector: 'main', text: 'Missing main landmark' }]

    const violations = new Map<string, ReadabilityViolation>()
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()

    while (node) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const element = node.parentElement

      if (text && element) {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const isHiddenUtility = element.closest(
          '[hidden], [aria-hidden="true"], .sr-only, .visually-hidden, script, style, template',
        )
        const fontSize = Number(style.fontSize.replace('px', ''))

        if (
          !isHiddenUtility &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 &&
          rect.width > 1 &&
          rect.height > 1 &&
          Number.isFinite(fontSize) &&
          fontSize < 12
        ) {
          const selector = [
            element.tagName.toLowerCase(),
            element.id ? `#${element.id}` : '',
            ...Array.from(element.classList)
              .slice(0, 3)
              .map((className) => `.${className}`),
          ].join('')
          const key = `${selector}|${text.slice(0, 80)}`
          violations.set(key, { fontSize, selector, text: text.slice(0, 120) })
        }
      }

      node = walker.nextNode()
    }

    return Array.from(violations.values()).slice(0, 25)
  })
}

async function collectContrastViolations(page: Page) {
  return page.evaluate<ContrastViolation[]>(() => {
    type Rgba = [number, number, number, number]
    const main = document.querySelector('main')
    if (!main) return [{ contrast: 0, foreground: 'unknown', background: 'unknown', selector: 'main', text: 'Missing main landmark' }]

    function parseColor(value: string): Rgba | null {
      if (value === 'transparent') return [0, 0, 0, 0]
      const match = value.match(/^([a-z-]+)\((.*)\)$/i)
      if (!match) throw new Error(`Unsupported computed color syntax: ${value}`)
      const [, functionName, body] = match
      let colorSpace: string | undefined
      let components = body.trim()
      if (functionName === 'color') {
        const space = components.match(/^([a-z-]+)\s+/i)
        if (!space) throw new Error(`Missing color space in computed color: ${value}`)
        colorSpace = space[1]!.toLowerCase()
        components = components.slice(space[0].length)
        if (!['srgb', 'srgb-linear'].includes(colorSpace)) throw new Error(`Unsupported computed color space: ${colorSpace}`)
      } else if (!['rgb', 'rgba'].includes(functionName!.toLowerCase())) {
        throw new Error(`Unsupported computed color function: ${functionName}`)
      }

      const [channelText, alphaText] = components.split('/')
      const tokens = channelText!.replace(/,/g, ' ').trim().split(/\s+/)
      const legacyAlpha = !alphaText && tokens.length === 4 ? tokens.pop() : undefined
      const channels = tokens
      if (channels.length !== 3) throw new Error(`Expected three channels in computed color: ${value}`)
      const channelScale = colorSpace ? 1 : 255
      const parseChannel = (channel: string) => {
        const percentage = channel.endsWith('%')
        const raw = Number.parseFloat(channel)
        if (!Number.isFinite(raw)) throw new Error(`Invalid computed color channel: ${channel}`)
        return percentage ? (raw / 100) * channelScale : raw
      }
      const alphaToken = alphaText?.trim() ?? legacyAlpha ?? '1'
      const alphaValue = Number.parseFloat(alphaToken)
      if (!Number.isFinite(alphaValue)) throw new Error(`Invalid computed color alpha: ${alphaToken}`)
      const alpha = alphaToken.endsWith('%') ? alphaValue / 100 : alphaValue
      const rgb = channels.map(parseChannel)
      if (colorSpace === 'srgb-linear') {
        return [
          ...rgb.map(channel => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055) * 255),
          alpha,
        ] as Rgba
      }
      return [rgb[0]! * (colorSpace ? 255 : 1), rgb[1]! * (colorSpace ? 255 : 1), rgb[2]! * (colorSpace ? 255 : 1), alpha]
    }

    function composite(foreground: Rgba, background: Rgba): Rgba {
      const alpha = foreground[3] + background[3] * (1 - foreground[3])
      if (alpha === 0) return [0, 0, 0, 0]
      return [
        (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ]
    }

    function luminance(color: Rgba) {
      const channels = color.slice(0, 3).map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }

    function backgroundFor(element: Element): Rgba {
      const ancestry: Element[] = []
      let current: Element | null = element
      while (current) {
        ancestry.unshift(current)
        current = current.parentElement
      }

      return ancestry.reduce<Rgba>((background, ancestor) => {
        const layer = parseColor(getComputedStyle(ancestor).backgroundColor)
        return layer && layer[3] > 0 ? composite(layer, background) : background
      }, [255, 255, 255, 1])
    }

    const violations = new Map<string, ContrastViolation>()
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()

    while (node) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const element = node.parentElement

      if (text && element) {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const isHiddenUtility = element.closest(
          '[hidden], [aria-hidden="true"], [disabled], .sr-only, .visually-hidden, script, style, template',
        )
        const foreground = parseColor(style.color)
        const background = backgroundFor(element)

        if (
          !isHiddenUtility &&
          foreground &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 &&
          rect.width > 1 &&
          rect.height > 1
        ) {
          const renderedForeground = composite(foreground, background)
          const light = Math.max(luminance(renderedForeground), luminance(background))
          const dark = Math.min(luminance(renderedForeground), luminance(background))
          const contrast = (light + 0.05) / (dark + 0.05)
          const fontSize = Number(style.fontSize.replace('px', ''))
          const fontWeight = Number(style.fontWeight) || 400
          const minimum = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5

          if (contrast + 0.01 < minimum) {
            const selector = [
              element.tagName.toLowerCase(),
              element.id ? `#${element.id}` : '',
              ...Array.from(element.classList)
                .slice(0, 3)
                .map((className) => `.${className}`),
            ].join('')
            const key = `${selector}|${text.slice(0, 80)}`
            violations.set(key, {
              contrast: Number(contrast.toFixed(2)),
              foreground: style.color,
              background: `rgb(${background[0].toFixed(2)} ${background[1].toFixed(2)} ${background[2].toFixed(2)})`,
              selector,
              text: text.slice(0, 120),
            })
          }
        }
      }

      node = walker.nextNode()
    }

    return Array.from(violations.values()).slice(0, 25)
  })
}

// A route with nothing to render passes these checks vacuously. Seed the one
// record that makes /transfers show its tracker, timeline and status lanes,
// so the check measures the text a dealership user actually sees.
test.beforeAll(async ({ request, baseURL }) => {
  const response = await request.post('/api/transfers', {
    headers: { 'x-inventory-demo-role': 'manager', 'x-inventory-demo-store': 'Howell', 'x-inventory-demo-user': 'Synthetic readability manager', origin: new URL(baseURL!).origin, 'idempotency-key': 'synthetic-readability-seed' },
    data: { vin: 'TESTDATAFWELL0002', neededBy: '2026-08-31T16:00:00Z', returnDueAt: '2026-09-01T16:00:00Z', reason: 'Synthetic readability seed', returnRequired: true },
  })
  // Both projects use the isolated synthetic ledger. The other viewport
  // project may already have created this same idempotent demonstration move.
  const body = await response.text()
  expect(response.ok() || body.includes('ACTIVE_TRANSFER_EXISTS'), body).toBe(true)
})

for (const route of coreRoutes) {
  test(`${route} keeps visible operational text readable and the page contained`, async ({ page }) => {
    // Measure the settled state. The selected scope button cross-fades text
    // and background over 160ms once bootstrap lands; sampled mid-transition
    // under a parallel run, white-on-pale-blue read as a 1.1:1 contrast
    // failure that the finished interface does not have.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    if (route === '/overview') {
      // /overview is manager-only (see tests/e2e/overview.spec.ts); without a
      // seeded role the visit redirects to /attention and this route's own
      // content is never checked.
      await page.addInitScript(() => {
        localStorage.setItem('maxey-role', 'group_manager')
        localStorage.setItem('maxey-home-store', 'Howell')
      })
    }
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()
    // A role redirect would let this pass while measuring a different page.
    await expect(page).toHaveURL(new RegExp(`${route}(\\?|$)`))
    // Measure the loaded page, not the loading one. Primary actions are
    // disabled (and so skipped) until bootstrap lands, which let a fast load
    // pass while a slow one measured the real controls.
    await page.waitForLoadState('networkidle')

    const violations = await collectReadabilityViolations(page)
    expect(violations, `Visible text below the 12px readability floor on ${route}`).toEqual([])

    const contrastViolations = await collectContrastViolations(page)
    expect(contrastViolations, `Visible text below the WCAG contrast floor on ${route}`).toEqual([])

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
    expect(pageOverflow, `Document-level horizontal overflow on ${route}`).toBe(false)
  })
}

// A generic hover used to replace the selected navy fill but leave white text.
test('selected service scope remains readable while hovered', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/service')
  const allStores = page.getByRole('button', { name: 'All stores', exact: true })
  await allStores.click()
  await expect(allStores).toHaveAttribute('aria-pressed', 'true')
  await allStores.hover()
  expect(await collectContrastViolations(page)).toEqual([])
})
