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

function openRecordDetails() {
  fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
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
  it.each([
    ['unknown', 'Waiting for service'], ['needs_service', 'Waiting for service'],
    ['in_service', 'In service'], ['serviced', 'Ready'],
  ] as const)('keeps %s visible in the persistent vehicle navigation', (status, label) => {
    const current = vehicle(1, true);
    current.serviceReadiness = { vin: current.vin, status, version: 1, serviceEnteredAt: '2026-09-13', completedAt: status === 'serviced' ? '2026-09-14' : null, updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage: false };
    render(<VehicleWorkspace vehicle={current} homeStore={{ id: 'Howell', name: 'Howell' }} onClose={vi.fn()} />);
    const operations = screen.getByRole('region', { name: 'Vehicle operational summary' });
    expect(operations).toHaveTextContent(label);
    for (const section of ['Equipment', 'Holds & moves', 'Records']) {
      fireEvent.click(screen.getByRole('tab', { name: section }));
      expect(screen.getByRole('link', { name: `Service: ${label}` })).toBeVisible();
      expect(screen.getByRole('tabpanel', { name: section })).toBeVisible();
    }
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });

  it('combines service status with held inventory, search, and an explicit expansion to other stores', () => {
    const home = vehicle(1, true);
    home.serviceReadiness = { vin: home.vin, status: 'serviced', version: 1, serviceEnteredAt: null, completedAt: '2026-09-14', updatedAt: null, updatedBy: null, updatedByRole: null, updatedAtStore: null, store: 'Howell', canManage: false };
    const other = { ...vehicle(3, true), serviceReadiness: { ...home.serviceReadiness, vin: vehicle(3).vin }, location: { homeStore: { id: 'Lincoln', name: 'Lincoln' } } };
    const unserviced = vehicle(5, true);
    unserviced.serviceReadiness = { ...home.serviceReadiness, vin: unserviced.vin, status: 'needs_service', completedAt: null };
    const { container } = render(<InventoryExperience homeStore={{ id: 'Howell', name: 'Howell' }} vehicles={[home, other, unserviced]} metrics={{ publicUnits: 2, currentHolds: 2, awayFromHome: 0, returnOverdue: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Ready: / }));
    fireEvent.click(screen.getByRole('button', { name: /^Held: / }));
    expect(container.querySelectorAll('.inv-desk-table tbody tr.inv-desk-row')).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: /Search inventory/ }), { target: { value: 'F-150' } });
    const expand = screen.getByRole('button', { name: /1 additional vehicle match at other locations/ });
    fireEvent.click(expand);
    expect(container.querySelectorAll('.inv-desk-table tbody tr.inv-desk-row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Ready: / })).toHaveAttribute('aria-pressed', 'true');
  });

  it('persists the service filter within an employee context and resets for another context', async () => {
    const props = { homeStore: { id: 'Howell', name: 'Howell' }, vehicles: [vehicle(1)], metrics: { publicUnits: 1, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 } };
    const { rerender, unmount } = render(<InventoryExperience {...props} searchPersistenceKey="employee-one:manager:Howell" />);
    fireEvent.click(screen.getByRole('button', { name: /^Ready: / }));
    rerender(<InventoryExperience {...props} searchPersistenceKey="employee-two:sales:Howell" />);
    expect(screen.getByRole('button', { name: /^All service: / })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    render(<InventoryExperience {...props} searchPersistenceKey="employee-one:manager:Howell" />);
    expect(screen.getByRole('button', { name: /^Ready: / })).toHaveAttribute('aria-pressed', 'true');
  });
  it('makes the home count and complete group count unmistakable while staying home-store first', async () => {
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

    expect(screen.getByRole('heading', { name: 'Howell inventory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Howell inventory, 4 of 7 group vehicles' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'All locations, 7 group vehicles' }))

    expect(screen.getByRole('heading', { name: 'All locations inventory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All locations, 7 group vehicles' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('offers the requested row-count increments and keeps the table paged', async () => {
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
    // Paging counts vehicles, independently of their visible source-resource strip.
    expect(document.querySelectorAll('.inv-desk-table tbody tr.inv-desk-row')).toHaveLength(10)
    expect(document.querySelectorAll('.inv-desk-table tbody tr.inv-desk-resource-row')).toHaveLength(10)

    fireEvent.change(rowsSelect, { target: { value: '20' } })
    expect(document.querySelectorAll('.inv-desk-table tbody tr.inv-desk-row')).toHaveLength(20)
    expect(document.querySelectorAll('.inv-desk-table tbody tr.inv-desk-resource-row')).toHaveLength(20)
    expect(screen.getByText('Showing 1–20 of 28')).toBeInTheDocument()
    fireEvent.change(rowsSelect, { target: { value: '100' } })
    expect(document.querySelectorAll('.inv-desk-table tbody tr.inv-desk-row')).toHaveLength(28)
    expect(document.querySelectorAll('.inv-desk-table tbody tr.inv-desk-resource-row')).toHaveLength(28)
    expect(screen.getByText('Showing 1–28 of 28')).toBeInTheDocument()
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

    const firstRow = document.querySelector('.inv-desk-table tbody tr.inv-desk-row') as HTMLTableRowElement
    fireEvent.click(firstRow)
    expect(onSelectVehicle).toHaveBeenCalledWith(heldVehicle)
  })

  it('opens an in-app handoff from a table hold action before any external navigation', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const external = vi.fn()
    const current = vehicle(7)
    render(<InventoryExperience homeStore={{ id: 'Howell', name: 'Howell' }} vehicles={[current]} metrics={{ publicUnits: 1, currentHolds: 0, awayFromHome: 0, returnOverdue: 0 }} onOpenSourceRecord={external} />)
    const row = document.querySelector('.inv-desk-table tbody tr.inv-desk-row') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: /Review DealerMail handoff for stock/ }))
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'Holds & moves' })).toBeVisible())
    expect(screen.getByRole('region', { name: 'DealerMail vehicle tools' })).toHaveTextContent(current.stockNumber)
    expect(screen.getByRole('button', { name: 'Open DealerMail & copy stock' })).toBeVisible()
    expect(openSpy).not.toHaveBeenCalled()
    expect(external).not.toHaveBeenCalled()
  })

  it('offers one honest handoff and copies stock even when noopener returns null', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const current = vehicle(7)
    render(<VehicleWorkspace vehicle={current} homeStore={{ id: 'Howell', name: 'Howell' }} onClose={vi.fn()} />)
    const panel = openDealerMailTools()
    const action = within(panel).getByRole('button', { name: 'Open DealerMail & copy stock' })
    expect(within(panel).getAllByRole('button')).toHaveLength(1)
    expect(panel).toHaveTextContent('the vehicle is not selected automatically')
    expect(panel.querySelector('dl')).toHaveTextContent(current.stockNumber)
    expect(panel.querySelector('dl')).toHaveTextContent(current.vin)
    fireEvent.click(action)
    expect(openSpy).toHaveBeenCalledWith(dealerMailVehicleUrl(current.stockNumber), '_blank', 'noopener,noreferrer')
    expect(writeText).toHaveBeenCalledWith(current.stockNumber)
    expect(writeText.mock.invocationCallOrder[0]).toBeLessThan(openSpy.mock.invocationCallOrder[0])
    expect(fetchSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(within(panel).getByRole('status')).toHaveTextContent('DealerMail tab requested')
      expect(within(panel).getByRole('status')).toHaveTextContent(`Stock ${current.stockNumber} copied`)
      expect(within(panel).getByRole('status')).not.toHaveTextContent('did not open')
      expect(within(panel).getByRole('status')).toHaveTextContent('No DealerMail record was changed')
    })
  })

  it('shows captured comments and alerts together without launching DealerMail', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const current = vehicle(8, true)
    current.dealerMailEvidence = { dataState: 'current', history: [], comments: [{ text: 'Synthetic comment only', author: 'Synthetic reviewer', timestamp: '2026-09-09T10:00:00Z' }], alerts: [{ text: 'Synthetic alert only', author: 'Synthetic manager', timestamp: '2026-09-09T11:00:00Z' }] }
    render(<VehicleWorkspace vehicle={current} homeStore={{ id: 'Howell', name: 'Howell' }} initialTab="hold" onClose={vi.fn()} />)
    expect(screen.getByText('Synthetic comment only')).toBeVisible()
    expect(screen.getByText('Synthetic alert only')).toBeVisible()
    expect(document.querySelector('.inventory-hold-evidence-list')).toBeInTheDocument()
    expect(openSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Saved comments' })).not.toBeInTheDocument()
  })

  it('keeps stale data read-only and requires verification for its one handoff', () => {
    const current = vehicle(9)
    current.dealerMail.dataState = 'stale'
    current.dealerMail.hasActiveHold = null
    render(<VehicleWorkspace vehicle={current} homeStore={{ id: 'Howell', name: 'Howell' }} onClose={vi.fn()} />)
    const panel = openDealerMailTools()
    expect(within(panel).getAllByRole('button')).toHaveLength(1)
    expect(within(panel).getByRole('note')).toHaveTextContent('Hold status is not confirmed')
    expect(panel).toHaveTextContent('Verify the live DealerMail record before acting')
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
    expect(within(screen.getByRole('tabpanel', { name: 'Holds & moves' })).getByText('Last verified salesperson')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('tab', { name: 'Records' }))
    const technicalDetails = screen.getByText('Technical & source details').closest('details')!
    expect(technicalDetails).not.toHaveAttribute('open')
    fireEvent.click(within(technicalDetails).getByText('Technical & source details'))
    expect(technicalDetails).toHaveAttribute('open')
    const disclosure = screen.getByText('Additional record details').closest('summary')
    expect(disclosure).not.toBeNull()
    fireEvent.click(disclosure!)
    const sourceFields = screen.getByRole('group', { name: 'Additional vehicle record details' })
    expect(within(sourceFields).getByText('Current public inventory')).toBeInTheDocument()
    expect(within(sourceFields).getAllByText('Bob Maxey Ford of Howell')).toHaveLength(2)
    expect(within(sourceFields).getByText('21521')).toBeInTheDocument()
    expect(within(sourceFields).getByText('Howell, Ford Detroit')).toBeInTheDocument()
    expect(within(sourceFields).getByText('123456')).toBeInTheDocument()
    expect(within(sourceFields).getByText('Aug 27, 2026')).toBeInTheDocument()
  })

  it('shows a safe link and manual guidance when navigation throws and clipboard is denied', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('blocked') })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const current = vehicle(9)
    render(<VehicleWorkspace vehicle={current} homeStore={{ id: 'Howell', name: 'Howell' }} onClose={vi.fn()} />)
    const panel = openDealerMailTools()
    fireEvent.click(within(panel).getByRole('button', { name: 'Open DealerMail & copy stock' }))
    await waitFor(() => {
      const status = within(panel).getByRole('status')
      expect(status).toHaveTextContent('could not request a new tab')
      expect(status).toHaveTextContent('Stock could not be copied')
      expect(status).toHaveTextContent(current.stockNumber)
      expect(status).toHaveTextContent('copy it manually')
      expect(status).not.toHaveTextContent('was copied')
      expect(within(status).getByRole('link', { name: 'Open DealerMail inventory' })).toHaveAttribute('href', dealerMailVehicleUrl(current.stockNumber))
    })
    expect(panel.querySelector('dd')).toHaveTextContent(current.stockNumber)
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
    expect(document.querySelector('.inventory-dealermail-handoff')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open DealerMail & copy stock' })).not.toBeInTheDocument()
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

  it('opens a focused hold pane with its location context and stable navigation', async () => {
    render(<VehicleWorkspace vehicle={vehicle(12, true)} homeStore={{ id: 'Howell', name: 'Howell' }} onClose={vi.fn()} />)
    const jump = screen.getByRole('tab', { name: 'Holds & moves' })
    expect(jump).toHaveAttribute('aria-controls', 'inventory-section-hold')
    fireEvent.click(jump)
    await waitFor(() => expect(jump).toHaveFocus())
    expect(screen.getByRole('tabpanel', { name: 'Holds & moves' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Location & movement' })).toBeVisible()
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
    // Branded source links are visible in the row; opening one never selects the vehicle.
    const row = document.querySelector('.inv-desk-resource-row') as HTMLElement
    const autoCheckRowLink = within(row).getByRole('link', { name: /open AutoCheck history for VIN/i })
    const stickerRowLink = within(row).getByRole('link', { name: /open sticker for VIN/i })
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
    const documents = openRecordDetails()
    expect(within(documents).getByText('92')).toBeInTheDocument()
    expect(within(documents).getByText('Typical 89–94')).toBeVisible()
    expect(within(documents).getByText('200A')).toBeInTheDocument()
    expect(within(documents).getByText('49,480')).toBeVisible()
    expect(within(documents).getByText('Original sticker amounts · confirm currency on the sticker.')).toBeVisible()
    expect(within(documents).queryByText('$49,480')).not.toBeInTheDocument()
    expect(within(documents).getByRole('heading', { name: 'Full factory equipment & warranty' })).toBeVisible()
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
    const documents = openRecordDetails()
    expect(within(documents).getByRole('link', { name: /open autocheck report/i })).toBeInTheDocument()
    expect(within(documents).getByText(/No AutoCheck history facts were captured/i)).toBeInTheDocument()
    expect(within(documents).queryByText('Not published')).not.toBeInTheDocument()
    expect(within(documents).queryByText(/factory window sticker/i)).not.toBeInTheDocument()
  })
})
