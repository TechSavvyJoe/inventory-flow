import { expect, test } from '@playwright/test'

test('desktop inventory table keeps every heading, identity, and action readable while the page grows naturally', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The production table is replaced by cards on mobile.')

  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: /Howell inventory/i })).toBeVisible({ timeout: 15_000 })

  const pageSize = page.getByLabel('Rows per page')
  await pageSize.selectOption('100')

  const shell = page.locator('.inventory-grid-shell--production-v10')
  const wrapper = shell.locator('.inventory-table-wrap')
  const table = shell.locator('.inventory-table--production-v10')
  const firstRow = table.locator('tbody tr').first()
  await expect(firstRow).toBeVisible()

  const layout = await page.evaluate(() => {
    const shellElement = document.querySelector<HTMLElement>('.inventory-grid-shell--production-v10')!
    const surfaceElement = shellElement.closest<HTMLElement>('.inventory-results-surface')!
    const wrapperElement = shellElement.querySelector<HTMLElement>('.inventory-table-wrap')!
    const tableElement = shellElement.querySelector<HTMLTableElement>('.inventory-table--production-v10')!
    const cells = Array.from(tableElement.querySelectorAll<HTMLElement>('tbody tr:first-child > td'))

    return {
      shellWidth: shellElement.getBoundingClientRect().width,
      surfaceWidth: surfaceElement.getBoundingClientRect().width,
      tableWidth: tableElement.getBoundingClientRect().width,
      wrapperClientHeight: wrapperElement.clientHeight,
      wrapperScrollHeight: wrapperElement.scrollHeight,
      wrapperMaxHeight: getComputedStyle(wrapperElement).maxHeight,
      wrapperOverflowY: getComputedStyle(wrapperElement).overflowY,
      columnWidths: cells.map((cell) => cell.getBoundingClientRect().width),
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      headerLabels: Array.from(tableElement.querySelectorAll<HTMLElement>('thead th')).map((header) => {
        const label = header.querySelector<HTMLElement>('.inventory-sort-header > span:first-child, .inventory-table-actions-heading')
        return label ? {
          text: label.textContent?.trim(),
          clientWidth: label.getBoundingClientRect().width,
          clientHeight: label.getBoundingClientRect().height,
          scrollWidth: label.scrollWidth,
          scrollHeight: label.scrollHeight,
          position: getComputedStyle(label).position,
        } : null
      }),
      identity: (() => {
        const visual = tableElement.querySelector<HTMLElement>('tbody tr:first-child .inventory-vehicle-visual')!
        const copy = tableElement.querySelector<HTMLElement>('tbody tr:first-child .inventory-vehicle-copy')!
        const identity = tableElement.querySelector<HTMLElement>('tbody tr:first-child .inventory-identity-cell')!
        const values = Array.from(identity.querySelectorAll<HTMLElement>('.copyable-value__content'))
        return {
          visual: visual.getBoundingClientRect().toJSON(),
          copy: copy.getBoundingClientRect().toJSON(),
          identity: identity.getBoundingClientRect().toJSON(),
          flexDirection: getComputedStyle(identity).flexDirection,
          alignItems: getComputedStyle(identity).alignItems,
          values: values.map((value) => ({
            clientWidth: value.getBoundingClientRect().width,
            scrollWidth: value.scrollWidth,
          })),
        }
      })(),
      action: (() => {
        const button = tableElement.querySelector<HTMLElement>('tbody tr:first-child .inventory-row-open')!
        const label = button.querySelector<HTMLElement>('.inventory-row-action-label')!
        return {
          text: label.textContent?.trim(),
          clientWidth: label.getBoundingClientRect().width,
          scrollWidth: label.scrollWidth,
        }
      })(),
      separatorWidth: getComputedStyle(cells[0]).borderBottomWidth,
    }
  })

  expect(layout.shellWidth).toBeGreaterThanOrEqual(layout.surfaceWidth - 4)
  expect(layout.tableWidth).toBeGreaterThanOrEqual(1160)
  expect(layout.wrapperMaxHeight).toBe('none')
  expect(layout.wrapperScrollHeight).toBeLessThanOrEqual(layout.wrapperClientHeight + 2)
  expect(layout.wrapperOverflowY).not.toBe('scroll')
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth + 1)

  const totalColumnWidth = layout.columnWidths.reduce((sum, width) => sum + width, 0)
  expect(layout.columnWidths).toHaveLength(6)
  expect(layout.columnWidths[0] / totalColumnWidth).toBeGreaterThan(0.3)
  expect(layout.columnWidths[1] / totalColumnWidth).toBeGreaterThan(0.1)
  expect(layout.columnWidths[2] / totalColumnWidth).toBeGreaterThan(0.15)
  expect(layout.columnWidths[3] / totalColumnWidth).toBeGreaterThan(0.15)
  expect(layout.columnWidths[4] / totalColumnWidth).toBeGreaterThan(0.12)
  expect(layout.columnWidths[5] / totalColumnWidth).toBeGreaterThan(0.13)

  for (const label of layout.headerLabels) {
    expect(label).not.toBeNull()
    expect(label!.position).toBe('static')
    expect(label!.clientWidth).toBeGreaterThan(35)
    expect(label!.scrollWidth).toBeLessThanOrEqual(label!.clientWidth + 1)
    expect(label!.scrollHeight).toBeLessThanOrEqual(label!.clientHeight + 1)
  }
  expect(layout.separatorWidth).toBe('1px')
  expect(layout.identity.flexDirection).toBe('row')
  expect(layout.identity.alignItems).toBe('center')
  expect(layout.identity.copy.x).toBeGreaterThan(layout.identity.visual.right + 7)
  expect(Math.abs(layout.identity.copy.y - layout.identity.visual.y)).toBeLessThanOrEqual(1)
  for (const value of layout.identity.values) {
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1)
  }
  expect(layout.action.text).toBe('View details')
  expect(layout.action.scrollWidth).toBeLessThanOrEqual(layout.action.clientWidth + 1)

  await expect(table.getByRole('columnheader', { name: /Vehicle/i })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: /Price & age/i })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: /Equipment highlights/i })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: /Availability & movement/i })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: /Records/i })).toBeVisible()

  const firstTitle = firstRow.locator('.inventory-vehicle-copy__title > strong')
  const firstDetail = firstRow.locator('.inventory-vehicle-copy__detail')
  const firstCell = firstRow.locator('td').first()
  for (const target of [firstTitle, firstDetail, firstCell]) {
    const fontSize = Number.parseFloat(await target.evaluate((element) => getComputedStyle(element).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(target === firstTitle ? 16 : 13)
  }

  await expect(firstRow.getByRole('button', { name: /Open vehicle details/i })).toContainText('View details')
  await expect(firstRow.getByRole('button', { name: /More actions/i })).toBeVisible()
  await expect(firstRow.getByRole('button', { name: /Open DealerMail for stock/i })).toBeHidden()

  await page.setViewportSize({ width: 1700, height: 950 })
  const wideLayout = await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>('.inventory-grid-shell--production-v10 .inventory-table-wrap')!
    const actionLabel = document.querySelector<HTMLElement>('.inventory-table--production-v10 tbody tr:first-child .inventory-row-action-label')!
    return {
      wrapperClientWidth: wrapper.clientWidth,
      wrapperScrollWidth: wrapper.scrollWidth,
      actionClientWidth: actionLabel.getBoundingClientRect().width,
      actionScrollWidth: actionLabel.scrollWidth,
      hiddenHeaders: Array.from(document.querySelectorAll<HTMLElement>('.inventory-table--production-v10 thead th > .inventory-sort-header-group__controls > .inventory-sort-header > span:first-child'))
        .filter((label) => label.getBoundingClientRect().width <= 1)
        .length,
    }
  })
  expect(wideLayout.wrapperScrollWidth).toBeLessThanOrEqual(wideLayout.wrapperClientWidth + 1)
  expect(wideLayout.actionScrollWidth).toBeLessThanOrEqual(wideLayout.actionClientWidth + 1)
  expect(wideLayout.hiddenHeaders).toBe(0)
})

test('narrow desktop keeps the bottom-row More menu outside the table scroller', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop overflow-menu contract.')

  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: /Howell inventory/i })).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Rows per page').selectOption('10')

  const table = page.locator('.inventory-table--production-v10')
  const wrapper = page.locator('.inventory-grid-shell--production-v10 .inventory-table-wrap')

  for (const width of [1280, 1366]) {
    await page.setViewportSize({ width, height: 900 })
    const bottomTrigger = table.getByRole('button', { name: /More actions/i }).last()
    await bottomTrigger.scrollIntoViewIfNeeded()
    await expect(bottomTrigger).toBeVisible()
    await bottomTrigger.click()

    const panelId = await bottomTrigger.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const menu = page.locator(`[id="${panelId}"]`)
    await expect(menu).toBeVisible()
    const firstMenuItem = menu.locator('.inventory-row-more__item').first()
    await expect(firstMenuItem).toBeVisible()
    await firstMenuItem.dispatchEvent('pointerdown')
    await expect(menu).toBeVisible()

    const layout = await menu.evaluate((menuElement) => {
      const wrapperElement = document.querySelector<HTMLElement>('.inventory-grid-shell--production-v10 .inventory-table-wrap')!
      const triggerElement = document.querySelector<HTMLElement>(`[aria-controls="${menuElement.id}"]`)!
      const bounds = menuElement.getBoundingClientRect()
      return {
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        menuBottom: bounds.bottom,
        menuClientHeight: menuElement.clientHeight,
        menuLeft: bounds.left,
        menuPosition: getComputedStyle(menuElement).position,
        menuRight: bounds.right,
        menuScrollHeight: menuElement.scrollHeight,
        menuStoreAccent: getComputedStyle(menuElement).getPropertyValue('--store-accent').trim(),
        menuTop: bounds.top,
        parentTag: menuElement.parentElement?.tagName,
        triggerStoreAccent: getComputedStyle(triggerElement).getPropertyValue('--store-accent').trim(),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        wrapperClientHeight: wrapperElement.clientHeight,
        wrapperClientWidth: wrapperElement.clientWidth,
        wrapperOverflowX: getComputedStyle(wrapperElement).overflowX,
        wrapperOverflowY: getComputedStyle(wrapperElement).overflowY,
        wrapperScrollHeight: wrapperElement.scrollHeight,
        wrapperScrollWidth: wrapperElement.scrollWidth,
      }
    })

    expect(layout.parentTag).toBe('BODY')
    expect(layout.menuPosition).toBe('fixed')
    expect(layout.menuStoreAccent).toBeTruthy()
    expect(layout.menuStoreAccent).toBe(layout.triggerStoreAccent)
    expect(layout.menuLeft).toBeGreaterThanOrEqual(7)
    expect(layout.menuTop).toBeGreaterThanOrEqual(7)
    expect(layout.menuRight).toBeLessThanOrEqual(layout.viewportWidth - 7)
    expect(layout.menuBottom).toBeLessThanOrEqual(layout.viewportHeight - 7)
    expect(layout.menuScrollHeight).toBeLessThanOrEqual(layout.menuClientHeight + 1)
    expect(layout.wrapperOverflowX).toBe('auto')
    expect(layout.wrapperOverflowY).toBe('auto')
    expect(layout.wrapperScrollWidth).toBeGreaterThan(layout.wrapperClientWidth)
    expect(layout.wrapperScrollHeight).toBeLessThanOrEqual(layout.wrapperClientHeight + 2)
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth + 1)

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
})

test('mobile inventory cards remain ordered, legible, and free of horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only inventory card contract.')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: /Howell inventory/i })).toBeVisible({ timeout: 15_000 })

  const toolbarLayout = await page.evaluate(() => {
    const sort = document.querySelector<HTMLElement>('.inventory-sort-composer__trigger')!
    const sortLabel = sort.querySelector<HTMLElement>('.inventory-sort-composer__mobile-label')!
    const sortValue = sort.querySelector<HTMLElement>('span:not(.inventory-sort-composer__mobile-label) strong')!
    const pageSize = document.querySelector<HTMLElement>('.inventory-page-size')!
    const rowsLabel = pageSize.querySelector<HTMLElement>('span')!
    const rowsSelect = pageSize.querySelector<HTMLSelectElement>('select')!
    const sortBounds = sort.getBoundingClientRect()
    const pageSizeBounds = pageSize.getBoundingClientRect()
    const rowsLabelBounds = rowsLabel.getBoundingClientRect()
    const rowsSelectBounds = rowsSelect.getBoundingClientRect()
    const rowsSelectStyle = getComputedStyle(rowsSelect)
    const selectedOptionText = rowsSelect.options[rowsSelect.selectedIndex]?.text ?? rowsSelect.value
    const textCanvas = document.createElement('canvas')
    const textContext = textCanvas.getContext('2d')!
    textContext.font = `${rowsSelectStyle.fontWeight} ${rowsSelectStyle.fontSize} ${rowsSelectStyle.fontFamily}`
    const rowsSelectValueWidth = textContext.measureText(selectedOptionText).width
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      pageSizeBorder: getComputedStyle(pageSize).borderTopWidth,
      pageSizeLeft: pageSizeBounds.left,
      pageSizeRight: pageSizeBounds.right,
      rowsLabelFontSize: Number.parseFloat(getComputedStyle(rowsLabel).fontSize),
      rowsLabelRight: rowsLabelBounds.right,
      rowsLabelText: rowsLabel.textContent?.trim(),
      rowsSelectClientWidth: rowsSelect.clientWidth,
      rowsSelectFontSize: Number.parseFloat(getComputedStyle(rowsSelect).fontSize),
      rowsSelectLeft: rowsSelectBounds.left,
      rowsSelectValue: rowsSelect.value,
      rowsSelectValueWidth,
      sortBorder: getComputedStyle(sort).borderTopWidth,
      sortLabelFontSize: Number.parseFloat(getComputedStyle(sortLabel).fontSize),
      sortLabelText: sortLabel.textContent?.trim(),
      sortRight: sortBounds.right,
      sortValueClientWidth: sortValue.clientWidth,
      sortValueScrollWidth: sortValue.scrollWidth,
      sortWidth: sortBounds.width,
    }
  })

  expect(toolbarLayout.sortLabelText).toBe('Sort')
  expect(toolbarLayout.rowsLabelText).toBe('Rows')
  expect(toolbarLayout.sortBorder).toBe('1px')
  expect(toolbarLayout.pageSizeBorder).toBe('1px')
  expect(toolbarLayout.pageSizeLeft - toolbarLayout.sortRight).toBeGreaterThanOrEqual(7)
  expect(toolbarLayout.rowsSelectLeft - toolbarLayout.rowsLabelRight).toBeGreaterThanOrEqual(1)
  expect(toolbarLayout.sortWidth).toBeGreaterThan(150)
  expect(toolbarLayout.sortValueScrollWidth).toBeLessThanOrEqual(toolbarLayout.sortValueClientWidth + 1)
  expect(toolbarLayout.rowsSelectClientWidth).toBeGreaterThanOrEqual(52)
  expect(toolbarLayout.rowsSelectClientWidth - toolbarLayout.rowsSelectValueWidth).toBeGreaterThanOrEqual(34)
  expect(toolbarLayout.sortLabelFontSize).toBeGreaterThanOrEqual(12)
  expect(toolbarLayout.rowsLabelFontSize).toBeGreaterThanOrEqual(12)
  expect(toolbarLayout.rowsSelectFontSize).toBeGreaterThanOrEqual(13)
  expect(toolbarLayout.rowsSelectValue).toBe('25')
  expect(toolbarLayout.pageSizeRight).toBeLessThanOrEqual(toolbarLayout.documentClientWidth)
  expect(toolbarLayout.documentScrollWidth).toBeLessThanOrEqual(toolbarLayout.documentClientWidth + 1)

  const list = page.locator('.inventory-mobile-list').first()
  const firstCard = list.locator('.inventory-mobile-row').first()
  await expect(list).toBeVisible()
  await expect(firstCard).toBeVisible()

  const layout = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.inventory-mobile-row')!
    const title = card.querySelector<HTMLElement>('.inventory-mobile-row__title strong')!
    const specification = card.querySelector<HTMLElement>('.inventory-mobile-row__specification')!
    const hold = card.querySelector<HTMLElement>('.inventory-mobile-hold strong')!
    const cardRect = card.getBoundingClientRect()
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      titleSize: Number.parseFloat(getComputedStyle(title).fontSize),
      specificationSize: Number.parseFloat(getComputedStyle(specification).fontSize),
      holdSize: Number.parseFloat(getComputedStyle(hold).fontSize),
    }
  })

  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.cardLeft).toBeGreaterThanOrEqual(0)
  expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.titleSize).toBeGreaterThanOrEqual(16)
  expect(layout.specificationSize).toBeGreaterThanOrEqual(13)
  expect(layout.holdSize).toBeGreaterThanOrEqual(13)
  await firstCard.locator('.inventory-mobile-row__open').click()
  await expect(page.locator('.inventory-workspace')).toBeVisible()
})
