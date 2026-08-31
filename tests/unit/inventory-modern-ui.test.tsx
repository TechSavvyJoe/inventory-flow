import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InventoryExperience } from '../../src/features/inventory/InventoryExperience'
import { InventoryTable } from '../../src/features/inventory/InventoryTable'
import { VehicleWorkspace } from '../../src/features/inventory/VehicleWorkspace'
import type { InventoryVehicle } from '../../src/features/inventory/types'
import { dealerMailInteractiveVehicleUrl } from '../../src/features/inventory/vehicle-document-utils'

const dealerMailVehicleUrl = (stock: string) =>
  dealerMailInteractiveVehicleUrl(stock)!

function openDealerMailTools() {
  fireEvent.click(screen.getByRole('button', { name: 'DealerMail tools' }))
  return screen.getByRole('region', { name: 'DealerMail vehicle tools' })
}

function openSourceDetails() {
  fireEvent.click(screen.getByRole('tab', { name: 'Source details' }))
  return screen.getByRole('region', { name: 'Vehicle documents' })
}

function vehicle(index: number, held = false): InventoryVehicle {
  const vin = `1FTFW1E8${String(index).padStart(9, '0')}`
  return {
    id: vin,
    vin,
    stockNumber: `HT${String(index).padStart(4, '0')}`,
    year: 2024,
    make: 'Ford',
    model: index % 2 ? 'F-150' : 'Explorer',
    trim: 'XLT',
    price: 32000 + index,
    mileage: 21000 + index,
    daysListed: index,
    engine: '2.7L V6 EcoBoost',
    transmission: '10-Speed Automatic',
    drivetrain: '4WD',
    bodyType: 'Crew Cab',
    changeSummary: index === 1 ? 'Price changed today' : null,
    publicListing: { dataState: 'current', isListed: true },
    dealerOn: { dataState: 'current', inStock: true, inTransit: false, inProduction: false },
    dealerMail: {
      dataState: 'current',
      hasActiveHold: held,
      activeRecordCount: held ? 1 : 0,
      canViewEvidence: true,
      canManageHold: true,
    },
    holdEvidence: held
      ? [{ id: `${vin}-hold`, position: 'primary', salesperson: 'Alex M.', customerOrReason: 'Customer appointment' }]
      : [],
    location: { homeStore: { id: 'Howell', name: 'Howell' } },
  }
}

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('manager-friendly inventory UI', () => {
  it('makes the home count and complete group count unmistakable while staying home-store first', async () => {
    const user = userEvent.setup()
    const vehicles = Array.from({ length: 7 }, (_, index) => vehicle(index + 1))
    for (const otherStoreVehicle of vehicles.slice(4)) {
      otherStoreVehicle.location.homeStore = { id: 'ford-detroit', name: 'Ford Detroit' }
    }

    render(
      <InventoryExperience
        homeStore={{ id: 'Howell', name: 'Howell' }}
        vehicles={vehicles}
        metrics={{ publicUnits: 4, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
      />,
    )

    expect(screen.getByText(/Showing 4 of 7 group vehicles in Howell\./)).toBeInTheDocument()
    expect(screen.getByText('4 shown · 4 of 7 group')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Howell inventory, 4 of 7 group vehicles' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'All locations, 7 group vehicles' }))

    expect(screen.getByText(/Showing all 7 group vehicles across four locations\./)).toBeInTheDocument()
    expect(screen.getByText('7 shown · 7 group')).toBeInTheDocument()
  })

  it('offers the requested row-count increments and keeps the table paged', async () => {
    const user = userEvent.setup()
    render(
      <InventoryExperience
        homeStore={{ id: 'Howell', name: 'Howell' }}
        vehicles={Array.from({ length: 28 }, (_, index) => vehicle(index + 1))}
        metrics={{ publicUnits: 28, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }}
      />,
    )

    const rowsSelect = screen.getByLabelText('Rows per page')
    expect(within(rowsSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '10', '15', '20', '25', '50', '100',
    ])
    expect(document.querySelectorAll('.inventory-table--vehicle-first tbody tr')).toHaveLength(10)

    await user.selectOptions(rowsSelect, '20')
    expect(document.querySelectorAll('.inventory-table--vehicle-first tbody tr')).toHaveLength(20)
    expect(screen.getByText('Showing 1–20 of 28')).toBeInTheDocument()
  })

  it('makes the full vehicle row tactile and emphasizes plain-language hold status', () => {
    const onSelectVehicle = vi.fn()
    const heldVehicle = vehicle(1, true)
    render(
      <InventoryTable
        vehicles={[heldVehicle, vehicle(2)]}
        sorts={[{ key: 'vehicle', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={onSelectVehicle}
      />,
    )

    expect(screen.getAllByText('Held · Alex M.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No current hold').length).toBeGreaterThan(0)
    expect(screen.queryByText(/DealerOn/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Public listing/i)).not.toBeInTheDocument()

    const firstRow = document.querySelector('.inventory-table--vehicle-first tbody tr') as HTMLTableRowElement
    fireEvent.click(firstRow)
    expect(onSelectVehicle).toHaveBeenCalledWith(heldVehicle)
  })

  it('opens the complete interactive DealerMail inventory and copies the exact stock for a confirmed unheld vehicle', async () => {
    const popup = { opener: window } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const availableVehicle = vehicle(7)

    render(
      <VehicleWorkspace
        vehicle={availableVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )

    const actionPanel = openDealerMailTools()
    const expectedActions = [
      'Find Vehicle in DealerMail',
      'Place Hold in DealerMail',
      'Comments in DealerMail',
      'Alerts in DealerMail',
    ]
    for (const action of expectedActions) {
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Add Backup in DealerMail' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review / Change Hold in DealerMail' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review / Remove Hold in DealerMail' })).not.toBeInTheDocument()
    const preflight = document.querySelector('.inventory-dealermail-actions__preflight') as HTMLElement
    expect(preflight).toHaveTextContent(availableVehicle.stockNumber)
    expect(preflight).toHaveTextContent(availableVehicle.vin)
    expect(preflight).toHaveTextContent('LAST8 / STOCK')
    expect(screen.getByText(/Opens DealerMail/i)).toHaveTextContent('complete interactive inventory screen')
    expect(actionPanel).toHaveClass('inventory-dealermail-actions--full-width')
    expect(actionPanel.closest('details')).toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Find Vehicle in DealerMail' })).toBeVisible()
    expect(document.querySelector('.inventory-workspace-actions')).toBeNull()

    for (const action of expectedActions) {
      fireEvent.click(screen.getByRole('button', { name: action }))
    }
    expect(openSpy).toHaveBeenCalledTimes(expectedActions.length)
    for (const call of openSpy.mock.calls) {
      expect(call).toEqual([dealerMailVehicleUrl(availableVehicle.stockNumber), '_blank'])
    }
    expect(openSpy.mock.calls.flat().join(' ')).toContain('selectedStore=26,25,27,95')
    expect(openSpy.mock.calls.flat().join(' ')).not.toContain('byItem=')
    expect(openSpy.mock.calls.flat().join(' ')).not.toContain('V2_inventory_USED_hold_edit.asp')
    expect(openSpy.mock.calls.flat().join(' ')).not.toContain('print_hold')
    expect(writeText).toHaveBeenCalledTimes(expectedActions.length)
    expect(writeText).toHaveBeenLastCalledWith(availableVehicle.stockNumber)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(popup.opener).toBeNull()
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('complete four-store inventory page')
      expect(screen.getByRole('status')).toHaveTextContent('was copied')
      expect(screen.getByRole('status')).toHaveTextContent('Alerts in DealerMail')
      expect(screen.getByRole('status')).toHaveTextContent('was not performed automatically')
      expect(screen.getByRole('status')).toHaveTextContent(availableVehicle.vin)
      expect(screen.getByRole('status')).toHaveTextContent('No hold, backup, comment, alert, change, or removal was performed here')
    })
  })

  it('shows held-unit backup and review intents in the compact hold workspace', async () => {
    const popup = { opener: window } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const heldVehicle = vehicle(8, true)
    heldVehicle.publicListing.listingUrl = 'https://www.bobmaxeyfordhowell.com/used/example'

    render(
      <VehicleWorkspace
        vehicle={heldVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        canRequestVehicle
        onClose={vi.fn()}
        onRequestVehicle={vi.fn()}
        onViewVehicle={vi.fn()}
        onOpenListing={vi.fn()}
      />,
    )

    openDealerMailTools()
    const expectedActions = [
      'Find Vehicle in DealerMail',
      'Add Backup in DealerMail',
      'Comments in DealerMail',
      'Alerts in DealerMail',
      'Review / Change Hold in DealerMail',
      'Review / Remove Hold in DealerMail',
    ]
    for (const action of expectedActions) {
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Place Hold in DealerMail' })).not.toBeInTheDocument()
    expect(document.querySelector('.inventory-workspace-actions')).toBeNull()
    const moreMenu = screen.getByText('More').closest('summary')
    expect(moreMenu).not.toBeNull()
    fireEvent.click(moreMenu!)
    expect(screen.getByRole('button', { name: 'Request vehicle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Full record' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review / Remove Hold in DealerMail' }))
    expect(openSpy).toHaveBeenCalledWith(dealerMailVehicleUrl(heldVehicle.stockNumber), '_blank')
    expect(openSpy.mock.calls.flat().join(' ')).toContain('selectedStore=26,25,27,95')
    expect(openSpy.mock.calls.flat().join(' ')).not.toContain('byItem=')
    expect(openSpy.mock.calls.flat().join(' ')).not.toContain('V2_inventory_USED_hold_edit.asp')
    expect(fetchSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Review / Remove Hold in DealerMail')
      expect(screen.getByRole('status')).toHaveTextContent('was not performed automatically')
      expect(screen.getByRole('status')).toHaveTextContent('Nothing was removed here')
    })
  })

  it('limits stale or unknown hold data to verification-safe DealerMail intents', () => {
    const staleVehicle = vehicle(9)
    staleVehicle.dealerMail.dataState = 'stale'
    staleVehicle.dealerMail.hasActiveHold = null

    render(
      <VehicleWorkspace
        vehicle={staleVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )

    openDealerMailTools()
    expect(screen.getByRole('button', { name: 'Find Vehicle in DealerMail' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comments in DealerMail' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alerts in DealerMail' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Place Hold in DealerMail' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Backup in DealerMail' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review / Change Hold in DealerMail' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review / Remove Hold in DealerMail' })).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Hold status is not confirmed')
    expect(screen.getByRole('note')).toHaveTextContent('until the DealerMail record is verified')
  })

  it('shows stale hold evidence as last verified without implying a current hold or availability', () => {
    const staleVehicle = vehicle(19, true)
    staleVehicle.dealerMail.dataState = 'stale'
    staleVehicle.dealerMail.hasActiveHold = null
    staleVehicle.dealerMail.position = null
    staleVehicle.holdEvidence = [{
      id: `${staleVehicle.vin}-last-verified-primary`,
      dataState: 'stale',
      position: 'primary',
      lifecycleStatus: 'last_verified_active',
      salesperson: 'Example Salesperson',
      customerOrReason: 'Example reason',
      holdDate: '2026-08-29',
      expectedDeliveryDate: '2026-09-02',
      commentFlag: true,
      comments: [{ text: 'Example comment' }],
    }]

    render(
      <VehicleWorkspace
        vehicle={staleVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        initialTab="hold"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Last verified primary hold')).toBeInTheDocument()
    expect(screen.getAllByText('Current state unverified — confirm in DealerMail').length).toBeGreaterThan(0)
    expect(screen.getByText('Last verified salesperson')).toBeInTheDocument()
    expect(screen.getByText('Last verified customer / reason')).toBeInTheDocument()
    expect(screen.getByText('Last verified comments & alerts')).toBeInTheDocument()
    expect(document.querySelector('.inventory-hold-evidence__stale-note')).toHaveTextContent('does not confirm a current hold, release, sale, delivery, or availability')
    expect(screen.queryByText('No current DealerMail hold found')).not.toBeInTheDocument()
  })

  it('keeps the complete public scan provenance available in the vehicle details without cluttering the table', () => {
    const scannedVehicle = vehicle(20)
    scannedVehicle.dataStatus = 'Current public inventory'
    scannedVehicle.location.sourceReportedStore = { id: 'howell-public', name: 'Howell' }
    scannedVehicle.publicScan = {
      actualLocation: 'Bob Maxey Ford of Howell',
      locationCity: 'Howell',
      dealerLocationId: 21521,
      dealerName: 'Bob Maxey Ford of Howell',
      vehicleId: 123456,
      genericColor: 'Blue',
      sourceSites: ['Howell', 'Ford Detroit'],
      sourceCount: 2,
      firstSeen: '2026-08-27',
      lastSeen: '2026-08-30',
    }

    render(
      <VehicleWorkspace
        vehicle={scannedVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Source details' }))
    const disclosure = screen.getByText('Full public inventory scan').closest('summary')
    expect(disclosure).not.toBeNull()
    fireEvent.click(disclosure!)
    const sourceFields = screen.getByRole('group', { name: 'Full public inventory scan source fields' })
    expect(within(sourceFields).getByText('Current public inventory')).toBeInTheDocument()
    expect(within(sourceFields).getAllByText('Bob Maxey Ford of Howell')).toHaveLength(2)
    expect(within(sourceFields).getByText('21521')).toBeInTheDocument()
    expect(within(sourceFields).getByText('Howell, Ford Detroit')).toBeInTheDocument()
    expect(within(sourceFields).getByText('123456')).toBeInTheDocument()
    expect(within(sourceFields).getByText('Aug 27, 2026')).toBeInTheDocument()
  })

  it('reports a blocked DealerMail tab without claiming the requested action opened or ran', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const availableVehicle = vehicle(9)

    render(
      <VehicleWorkspace
        vehicle={availableVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )

    openDealerMailTools()
    fireEvent.click(screen.getByRole('button', { name: 'Place Hold in DealerMail' }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('did not open')
    expect(alert).toHaveTextContent('Place Hold in DealerMail')
    expect(alert).toHaveTextContent('was not performed')
    expect(alert).toHaveTextContent(availableVehicle.stockNumber)
    expect(alert).toHaveTextContent(availableVehicle.vin)
    expect(alert).toHaveTextContent('No hold, backup, comment, alert, change, or removal was performed here')
    expect(alert).not.toHaveTextContent(/opened to|were preselected/i)
    const manualLink = within(alert).getByRole('link', { name: /open dealermail inventory/i })
    expect(manualLink).toHaveAttribute('href', dealerMailVehicleUrl(availableVehicle.stockNumber))
    expect(manualLink.getAttribute('href')).toContain('selectedStore=26,25,27,95')
    expect(manualLink.getAttribute('href')).not.toContain('byItem=')
    expect(openSpy.mock.calls.flat().join(' ')).toContain('selectedStore=26,25,27,95')
    expect(openSpy.mock.calls.flat().join(' ')).not.toContain('byItem=')
  })

  it('keeps the full DealerMail search workflow usable when clipboard access is denied', async () => {
    const popup = { opener: window } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(popup)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('clipboard denied')) },
    })
    const heldVehicle = vehicle(10, true)

    render(
      <VehicleWorkspace
        vehicle={heldVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )

    openDealerMailTools()
    fireEvent.click(screen.getByRole('button', { name: 'Comments in DealerMail' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('complete four-store inventory page')
      expect(screen.getByRole('status')).toHaveTextContent(heldVehicle.stockNumber)
      expect(screen.getByRole('status')).toHaveTextContent(heldVehicle.vin)
      expect(screen.getByRole('status')).toHaveTextContent('Comments in DealerMail')
      expect(screen.getByRole('status')).toHaveTextContent('was not performed automatically')
      expect(screen.getByRole('status')).toHaveTextContent('enter stock')
      expect(screen.getByRole('status')).toHaveTextContent('LAST8 / STOCK')
      expect(screen.getByRole('status')).not.toHaveTextContent('was copied')
    })
  })

  it('does not expose DealerMail hold tools to a role without management access', () => {
    const restrictedVehicle = vehicle(11, true)
    restrictedVehicle.dealerMail.canManageHold = false
    restrictedVehicle.dealerMail.canViewEvidence = false
    restrictedVehicle.holdEvidence = []

    render(
      <VehicleWorkspace
        vehicle={restrictedVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        initialTab="hold"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Hold details are restricted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /in DealerMail$|Find Vehicle in DealerMail/i })).not.toBeInTheDocument()
    expect(document.querySelector('.inventory-dealermail-actions')).not.toBeInTheDocument()
  })

  it('keeps photo thumbnails as tactile buttons rather than overriding their semantics', () => {
    const picturedVehicle = vehicle(10)
    picturedVehicle.imageUrls = [
      'https://www.bobmaxeyfordhowell.com/inventoryphotos/example/1.jpg',
      'https://www.bobmaxeyfordhowell.com/inventoryphotos/example/2.jpg',
    ]

    render(
      <VehicleWorkspace
        vehicle={picturedVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )

    const firstThumbnail = screen.getByRole('button', { name: 'Show vehicle photo 1' })
    const secondThumbnail = screen.getByRole('button', { name: 'Show vehicle photo 2' })
    expect(firstThumbnail).not.toHaveAttribute('role')
    expect(secondThumbnail).not.toHaveAttribute('role')
  })

  it('makes hold, location, and movement signals tactile shortcuts to their full details', async () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle(12, true)}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )

    const holdSignal = document.querySelector('.inventory-workspace-signal--hold') as HTMLButtonElement
    const locationSignal = document.querySelector('.inventory-workspace-signal--location') as HTMLButtonElement
    expect(holdSignal.tagName).toBe('BUTTON')
    expect(holdSignal).toHaveAttribute('aria-controls', 'inventory-section-hold')
    expect(locationSignal.tagName).toBe('BUTTON')
    expect(locationSignal).toHaveAttribute('aria-controls', 'inventory-section-movement')

    fireEvent.click(holdSignal)
    await waitFor(() => {
      expect(document.querySelector('#inventory-section-hold')).toHaveAttribute('open')
      expect(holdSignal).toHaveAttribute('aria-expanded', 'true')
    })

    fireEvent.click(locationSignal)
    await waitFor(() => {
      expect(document.querySelector('#inventory-section-movement')).toHaveAttribute('open')
      expect(locationSignal).toHaveAttribute('aria-expanded', 'true')
    })
  })

  it('opens exact official document links from the row and presents parsed facts progressively', () => {
    const onSelectVehicle = vi.fn()
    const documentedVehicle = vehicle(13)
    documentedVehicle.autoCheckReport = {
      url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token',
      dataState: 'current',
      score: 92,
      scoreRangeLow: 89,
      scoreRangeHigh: 94,
      checks: [{ label: 'Accident / Damage', status: 'No Issue', detail: 'No accidents reported' }],
    }
    documentedVehicle.windowSticker = {
      url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U',
      dataState: 'current',
      equipmentGroup: '200A',
      totalMsrp: 49480,
      options: ['Active Comfort Package — $3,145.00'],
      standardEquipment: ['Functional: Rear view camera'],
      warranty: ['3YR/36,000 BUMPER / BUMPER'],
    }

    const table = render(
      <InventoryTable
        vehicles={[documentedVehicle]}
        sorts={[{ key: 'vehicle', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectVehicle={onSelectVehicle}
      />,
    )
    const autoCheckRowLink = screen.getByRole('link', { name: /open autocheck report/i })
    const stickerRowLink = screen.getByRole('link', { name: /open window sticker/i })
    expect(autoCheckRowLink).toHaveAttribute('href', documentedVehicle.autoCheckReport.url)
    expect(stickerRowLink).toHaveAttribute('href', documentedVehicle.windowSticker.url)
    fireEvent.click(autoCheckRowLink)
    expect(onSelectVehicle).not.toHaveBeenCalled()
    table.unmount()

    render(
      <VehicleWorkspace
        vehicle={documentedVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )
    const documents = openSourceDetails()
    expect(within(documents).getByText('92')).toBeInTheDocument()
    expect(within(documents).getByText('89–94')).toBeInTheDocument()
    expect(within(documents).getByText('200A')).toBeInTheDocument()
    expect(within(documents).getByText('$49,480')).toBeInTheDocument()
    const fullFactoryDetails = within(documents).getByText('Full factory equipment & warranty').closest('summary')
    expect(fullFactoryDetails).not.toBeNull()
    fireEvent.click(fullFactoryDetails!)
    expect(within(documents).getByText('Functional: Rear view camera')).toBeInTheDocument()
    expect(within(documents).getByText('3YR/36,000 BUMPER / BUMPER')).toBeInTheDocument()
  })

  it('keeps a verified official link useful when its summary is incomplete without filling the card with fake facts', () => {
    const linkOnlyVehicle = vehicle(14)
    linkOnlyVehicle.autoCheckReport = {
      url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token',
      dataState: 'incomplete',
    }
    render(
      <VehicleWorkspace
        vehicle={linkOnlyVehicle}
        homeStore={{ id: 'Howell', name: 'Howell' }}
        onClose={vi.fn()}
      />,
    )
    const documents = openSourceDetails()
    expect(within(documents).getByRole('link', { name: /open autocheck report/i })).toBeInTheDocument()
    expect(within(documents).getByText(/no summary facts were safely captured/i)).toBeInTheDocument()
    expect(within(documents).queryByText('Not published')).not.toBeInTheDocument()
    expect(within(documents).queryByText(/factory window sticker/i)).not.toBeInTheDocument()
  })
})
