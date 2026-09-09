import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleWorkspace } from './VehicleWorkspace';
import type { InventoryVehicle } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function vehicle(): InventoryVehicle {
  return {
    id: '1FTFW1E86HFA48871',
    vin: '1FTFW1E86HFA48871',
    stockNumber: 'W5863Q',
    year: 2017,
    make: 'Ford',
    model: 'F-150',
    trim: 'Lariat',
    price: 20988,
    msrp: 50560,
    mileage: 123328,
    daysListed: 2,
    inventoryDate: '2026-08-29',
    bodyType: 'SuperCrew 4x4',
    drivetrain: '4WD',
    engine: '3.5L V6 EcoBoost',
    transmission: '10-Speed Automatic',
    fuelType: 'Gasoline',
    exteriorColor: 'Black',
    interiorColor: 'Black Leather',
    photoCount: 6,
    publicListing: {
      dataState: 'current',
      isListed: false,
      websiteStatus: 'Not live on website',
      updatedAt: '2026-08-29T23:50:00-04:00',
    },
    dealerOn: {
      dataState: 'stale',
      inStock: true,
      inTransit: false,
      inProduction: false,
      updatedAt: '2026-08-29T23:50:00-04:00',
    },
    dealerMail: {
      dataState: 'current',
      hasActiveHold: true,
      position: 'primary',
      activeRecordCount: 1,
      canViewEvidence: true,
      canManageHold: true,
      updatedAt: '2026-08-29T23:50:00-04:00',
    },
    holdEvidence: [{
      id: 'hold-1',
      position: 'primary',
      salesperson: 'Jamie Howell',
      customerOrReason: 'Customer appointment',
      cdkState: 'STATUS: S',
    }],
    location: {
      homeStore: { id: 'fowlerville', name: 'Fowlerville' },
      sourceReportedStore: { id: 'fowlerville', name: 'Fowlerville' },
    },
    changeSummary: 'Price decreased from $21,988 to $20,988',
    timeline: [{
      id: 'price-change',
      occurredAt: '2026-08-29T21:15:00-04:00',
      title: 'Price changed',
      detail: 'Price decreased from $21,988 to $20,988',
      source: 'public',
    }],
  };
}

describe('dense vehicle workspace', () => {
  it('keeps one app main landmark and exposes only the intentional close control', () => {
    render(
      <main>
        <VehicleWorkspace
          vehicle={vehicle()}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          onClose={vi.fn()}
        />
      </main>,
    );

    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.querySelector('.inventory-workspace-v3-overview__main')?.tagName).toBe('DIV');
    expect(screen.getAllByRole('button', { name: 'Close vehicle details' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy mileage: 123328' })).toHaveLength(2);
    expect(document.querySelector('.inventory-workspace-backdrop')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.inventory-workspace-backdrop')?.tagName).toBe('DIV');
  });

  it('keeps one compact priority toolbar and puts secondary work behind More', () => {
    const documented = vehicle();
    documented.publicListing.listingUrl = 'https://www.bobmaxeyfordhowell.com/vehicle-details?stock=W5863Q';
    documented.autoCheckReport = {
      dataState: 'current',
      url: 'https://www.bobmaxeyfordhowell.com/autocheck.aspx?sv=vehicle-token&ac=report-token',
    };
    documented.windowSticker = {
      dataState: 'current',
      url: 'https://www.bobmaxeyfordhowell.com/api/vhcliaa/inventory/21521/window-sticker?sv=vehicle-token&make=Ford&vehicleType=U',
    };

    render(
      <VehicleWorkspace
        vehicle={documented}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
        onRequestVehicle={vi.fn()}
        onViewVehicle={vi.fn()}
      />,
    );

    const toolbar = screen.getByRole('toolbar', { name: 'Vehicle actions' });
    expect(within(toolbar).getByRole('button', { name: 'DealerMail tools' })).toBeInTheDocument();
    const autoCheckAction = within(toolbar).getByRole('link', {
      name: /Open AutoCheck report for 2017 Ford F-150 Lariat in a new tab/i,
    });
    expect(autoCheckAction).toHaveTextContent('AutoCheck report');
    expect(autoCheckAction.querySelector('.inventory-document-wordmark--autocheck img')).toHaveAttribute(
      'src',
      'https://www.autocheck.com/reportservice/common/img/autocheck-logo.svg',
    );
    const stickerAction = within(toolbar).getByRole('link', {
      name: /Open factory window sticker for 2017 Ford F-150 Lariat in a new tab/i,
    });
    expect(stickerAction).toHaveTextContent('Window sticker');
    expect(stickerAction.querySelector('.inventory-resource-action-mark svg')).toBeInTheDocument();
    expect(within(toolbar).getByRole('link', { name: 'Invoice' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('link', { name: 'OASIS' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-action="dealermail-tools"]')).toHaveLength(1);
    expect(document.querySelector('.inventory-workspace-v3-more')).toHaveTextContent(/More.*Records.*Full record/i);
    expect(document.querySelector('.inventory-workspace-actions')).not.toBeInTheDocument();

    const hero = document.querySelector('.inventory-workspace-hero');
    const tabs = document.querySelector('.inventory-workspace-tabs');
    expect(hero?.nextElementSibling).toHaveClass('inventory-workspace-mobile-status');
    expect(tabs?.parentElement).toHaveClass('inventory-workspace-navigation');
  });

  it('uses record evidence to present plain-language operational status', () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle()}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );

    const primary = screen.getByRole('region', { name: 'Primary operational status' });
    expect(within(primary).getByText('On hold')).toBeInTheDocument();
    expect(within(primary).getByText('Fowlerville')).toBeInTheDocument();

    const sourceStatus = screen.getByRole('region', { name: 'Vehicle record status' });
    const publicSignal = sourceStatus.querySelector('.inventory-workspace-signal--public-listing');
    expect(publicSignal).toHaveTextContent('Not shown online');
    expect(sourceStatus).not.toHaveTextContent(/inventory feed|CDK/i);
    expect(primary).not.toHaveTextContent(/sold|delivered/i);
  });

  it('never leaks private hold or raw CDK evidence when evidence access is restricted', () => {
    const restricted = vehicle();
    restricted.dealerMail.canViewEvidence = false;
    restricted.dealerMail.canManageHold = false;
    restricted.holdEvidence = [{
      id: 'private-hold',
      position: 'primary',
      salesperson: 'Private Salesperson',
      customerOrReason: 'Private Customer Name',
      cdkState: 'PRIVATE RAW CDK',
    }];
    restricted.dealerMailEvidence = { dataState: 'current', comments: [], alerts: [{ text: 'Private vehicle alert' }], history: [] };

    render(
      <VehicleWorkspace
        vehicle={restricted}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );

    expect(document.querySelector('.inventory-workspace-signal--cdk')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Salesperson')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Customer Name')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE RAW CDK')).not.toBeInTheDocument();
    expect(screen.queryByText('Private vehicle alert')).not.toBeInTheDocument();
  });

  it('displays an unheld vehicle alert without a fabricated primary hold', async () => {
    const unheld = vehicle();
    unheld.dealerMail.hasActiveHold = false;
    unheld.dealerMail.activeRecordCount = 0;
    unheld.dealerMail.position = null;
    unheld.holdEvidence = [];
    unheld.dealerMailEvidence = {
      dataState: 'current', comments: [{ text: 'Synthetic inspection note' }], alerts: [{ text: 'Synthetic transport restriction' }],
      history: [{ orderRaw: '1', customerOrReason: 'Synthetic previous reason', statusLabel: 'Not in current live hold set; detail page retains order 1 — review' }],
    };
    render(<VehicleWorkspace vehicle={unheld} homeStore={{ id: 'fowlerville', name: 'Fowlerville' }} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Hold and availability' }));
    expect(screen.getByText('No current DealerMail hold found')).toBeInTheDocument();
    expect(screen.getByText('Synthetic transport restriction')).toBeVisible();
    expect(screen.getByText('Synthetic inspection note')).toBeVisible();
    expect(screen.queryByText('primary hold')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Previous hold records'));
    expect(screen.getByText('Synthetic previous reason')).toBeVisible();
  });

  it('uses an accessible keyboard tab model and retains compatible detail targets', async () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle()}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );

    const overview = screen.getByRole('tab', { name: 'Overview' });
    const hold = screen.getByRole('tab', { name: 'Hold and availability' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => {
      expect(document.querySelector('.inventory-workspace-close')).toHaveFocus();
    });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(hold).toHaveAttribute('aria-selected', 'true');
      expect(hold).toHaveFocus();
      expect(document.querySelector('#inventory-section-hold')).toHaveAttribute('open');
    });
  });

  it('presents movement workflow values as readable labels and gives long mobile facts full width', () => {
    const moving = vehicle();
    moving.movement = {
      state: 'requested',
      requestStatus: 'manager_review',
      custodyStatus: 'at_home_store',
      customerOutcome: 'not_confirmed',
      deliveryConfirmation: 'not_confirmed',
      requestId: 'movement-request-with-a-long-identifier',
      nextAction: 'Home manager confirms the vehicle can be released for transfer',
      overdue: true,
    };

    render(
      <VehicleWorkspace
        vehicle={moving}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        initialTab="movement"
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByRole('tabpanel', { name: 'Location and movement' });
    expect(panel).toHaveTextContent(/Movement state\s*Requested/i);
    expect(panel).toHaveTextContent(/Request status\s*Manager review/i);
    expect(panel).toHaveTextContent(/Customer outcome\s*Not confirmed/i);
    expect(panel).toHaveTextContent(/Delivery confirmation\s*Not confirmed/i);
    expect(within(panel).getByText('Home manager confirms the vehicle can be released for transfer').parentElement)
      .toHaveClass('inventory-workspace-fact--wide-mobile');
    expect(within(panel).getByText('movement-request-with-a-long-identifier').parentElement)
      .toHaveClass('inventory-workspace-fact--wide-mobile');
  });

  it('makes a sparse history feel intentional and keeps source-labelled activity readable', () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle()}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        initialTab="timeline"
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByRole('tabpanel', { name: 'History' });
    expect(within(panel).getByRole('heading', { name: 'Recorded activity' })).toBeInTheDocument();
    expect(within(panel).getByText('1 recorded event')).toBeInTheDocument();
    expect(within(panel).getByText('Price changed').closest('.inventory-timeline__copy')).toBeInTheDocument();
    expect(within(panel).getByText(/Chronological inventory, hold, location, and movement events/i)).toBeInTheDocument();
  });

  it('groups every VIN-linked published equipment item by evidence source without inferring trim equipment', async () => {
    const user = userEvent.setup();
    const equipped = vehicle();
    equipped.features = [
      'Blind Spot Information System',
      'Heated Steering Wheel',
      'Navigation System',
      '20-inch wheels',
      'Integrated Tailgate Step',
      'Unique published accessory',
      'Max Trailer Tow Package',
    ];
    equipped.windowSticker = {
      dataState: 'current',
      equipmentGroup: 'Equipment Group 502A',
      options: ['Max Trailer Tow Package', 'FX4 Off-Road Package'],
      standardEquipment: ['Functional: Rear view camera'],
    };

    render(
      <VehicleWorkspace
        vehicle={equipped}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    const panel = screen.getByRole('tabpanel', { name: 'Equipment' });

    for (const category of [
      'Safety & driver assist',
      'Towing & utility',
      'Comfort',
      'Technology',
      'Packages & special series',
      'Standout upgrades',
      'Other published equipment',
    ]) {
      expect(within(panel).getAllByText(category).length).toBeGreaterThan(0);
    }

    const publishedItems = [
      ...equipped.features,
      equipped.windowSticker.equipmentGroup,
      ...equipped.windowSticker.options!,
      ...equipped.windowSticker.standardEquipment!,
    ];
    for (const item of publishedItems) {
      expect(within(panel).getAllByText(item!).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('button', { name: /Copy factory option/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy factory standard equipment/i })).not.toBeInTheDocument();
    expect(within(panel).getAllByText(/Original window sticker · Option/).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/Published vehicle listing/).length).toBeGreaterThan(0);
    expect(within(panel).getByText('10 VIN-linked items, organized for quick customer questions')).toBeInTheDocument();
    expect(within(panel).getByText(/4 original-sticker items.*7 published-listing items/i)).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Original-sticker configuration' })).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: 'Vehicle specifications' })).not.toBeInTheDocument();
    const prefixedFactoryRow = panel.querySelector(
      'li[title*="Exact published label: Functional: Rear view camera"]',
    );
    expect(prefixedFactoryRow).toBeInTheDocument();
    expect(within(prefixedFactoryRow as HTMLElement).getByText('Rear view camera')).toBeInTheDocument();
    expect(within(prefixedFactoryRow as HTMLElement).getByText('Functional: Rear view camera')).toHaveClass(
      'inventory-sr-only',
    );
    expect(within(prefixedFactoryRow as HTMLElement).getByText(/Original window sticker · Standard.*Functional/i)).toBeInTheDocument();

    const safetySection = panel.querySelector('#inventory-equipment-section-safety');
    expect(safetySection).toHaveAttribute('tabindex', '-1');
    await user.click(within(panel).getByRole('button', { name: /Jump to Safety & driver assist/i }));
    expect(safetySection).toHaveFocus();
    expect(within(panel).getByText(/Nothing is inferred from year or trim/i)).toBeInTheDocument();
  });

  it('surfaces source-labeled AutoCheck and sticker facts with a direct path to full records', async () => {
    const user = userEvent.setup();
    const documented = vehicle();
    documented.autoCheckReport = {
      dataState: 'current',
      score: 89,
      scoreRangeLow: 84,
      scoreRangeHigh: 90,
      ownerCount: 2,
      usage: 'Personal',
      lastReportedOdometer: 122991,
      lastReportedOdometerDate: '2026-08-20',
    };
    documented.windowSticker = {
      dataState: 'current',
      totalMsrp: 50560,
      equipmentGroup: 'Equipment Group 502A',
      options: ['Max Trailer Tow Package', 'FX4 Off-Road Package'],
      standardEquipment: ['Functional: Rear view camera'],
    };

    render(
      <VehicleWorkspace
        vehicle={documented}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );

    const snapshot = screen.getByRole('heading', { name: 'Vehicle record snapshot' }).closest('section');
    expect(snapshot).toHaveTextContent(/AutoCheck score.*89.*range 84–90/i);
    expect(snapshot).toHaveTextContent(/AutoCheck owners.*2 reported/i);
    expect(snapshot).toHaveTextContent(/Sticker MSRP.*50,560 \(original sticker currency; verify\)/i);
    expect(snapshot).toHaveTextContent(/Sticker options.*2 published/i);

    await user.click(within(snapshot as HTMLElement).getByRole('button', { name: /Full records/i }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Record details' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Record details' }).closest('details')).toHaveAttribute('open');
    });
  });

  it('labels vAuto-only and combined configuration sources without overstating factory provenance', async () => {
    const user = userEvent.setup();
    const profiled = vehicle();
    profiled.features = ['Blind Spot Monitor'];
    profiled.factoryEquipment = {
      dataState: 'current',
      isOriginalWindowSticker: false,
      vehicleDescription: '2017 Ford F-150 Lariat SuperCrew 4x4',
      packages: [{ name: 'Safety Package', code: 'PQB' }],
    };

    const { rerender } = render(
      <VehicleWorkspace
        vehicle={profiled}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    expect(screen.getByRole('heading', { name: 'VIN equipment profile' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Factory configuration' })).not.toBeInTheDocument();

    const combined = {
      ...profiled,
      windowSticker: {
        dataState: 'current' as const,
        equipmentGroup: 'Equipment Group 502A',
      },
    };
    rerender(
      <VehicleWorkspace
        vehicle={combined}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'VIN-linked configuration sources' })).toBeInTheDocument();
  });

  it('shows a clear not-published state when no VIN equipment evidence exists', async () => {
    const user = userEvent.setup();
    const noEquipment = vehicle();
    noEquipment.features = [];
    noEquipment.windowSticker = null;

    render(
      <VehicleWorkspace
        vehicle={noEquipment}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    expect(screen.getByText('Equipment not published for this VIN')).toBeInTheDocument();
  });

  it('keeps hold evidence and every DealerMail action in one compact operational surface', () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle()}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        initialTab="hold"
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByRole('tabpanel', { name: 'Hold and availability' });
    const evidence = panel.querySelector('.inventory-hold-evidence-list');
    const caveat = panel.querySelector('#inventory-hold-availability-caveat') as HTMLElement;
    const dealerMailRail = panel.querySelector('.inventory-workspace-dealermail-rail');
    expect(panel.querySelector('.inventory-workspace-hold-center')).toBeInTheDocument();
    expect(panel.querySelector('.inventory-hold-evidence__facts')).toBeInTheDocument();
    expect(evidence?.compareDocumentPosition(dealerMailRail as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(caveat.compareDocumentPosition(dealerMailRail as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(dealerMailRail).toHaveAccessibleDescription(/A hold alone does not mean sold or delivered/i);
    expect(panel.querySelector('.inventory-workspace-hold-context')).toHaveTextContent(
      /Home store.*Fowlerville.*Current location.*Fowlerville.*Online listing.*Not listed online.*Movement.*No movement record/i,
    );
    expect(panel.querySelectorAll('[data-dealermail-intent]')).toHaveLength(6);
    expect(within(panel).getByText('Verify first')).toBeInTheDocument();
    expect(within(panel).getAllByText('W5863Q').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('1FTFW1E86HFA48871').length).toBeGreaterThan(0);
    expect(within(panel).getByRole('button', { name: 'Find Vehicle in DealerMail' })).toHaveAccessibleDescription(
      /Search DealerMail by this exact stock, then verify the VIN and use its native vehicle tools/i,
    );
    expect(within(panel).getByRole('button', { name: 'Add Backup in DealerMail' })).toHaveAccessibleDescription(
      /Review the primary hold before adding a separate backup/i,
    );
  });

  it('turns a missing hold into a compact evidence summary without calling the vehicle available', () => {
    const noHold = vehicle();
    noHold.dealerMail.hasActiveHold = false;
    noHold.dealerMail.position = null;
    noHold.dealerMail.activeRecordCount = 0;
    noHold.holdEvidence = [];
    noHold.movement = null;

    render(
      <VehicleWorkspace
        vehicle={noHold}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        initialTab="hold"
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByRole('tabpanel', { name: 'Hold and availability' });
    const holdCenter = panel.querySelector('.inventory-workspace-hold-center');
    const caveat = panel.querySelector('#inventory-hold-availability-caveat') as HTMLElement;
    const dealerMailRail = panel.querySelector('.inventory-workspace-dealermail-rail');
    expect(holdCenter).toHaveAttribute('data-hold-state', 'no-evidence');
    expect(within(panel).getByRole('heading', { name: 'No current DealerMail hold found' })).toBeInTheDocument();
    expect(within(panel).getByText('No active hold row found')).toBeInTheDocument();
    expect(within(panel).getAllByText('Fowlerville')).toHaveLength(2);
    expect(within(panel).getByText('Not listed online')).toBeInTheDocument();
    expect(within(panel).getByText('Website status: Not live on website · Current')).toBeInTheDocument();
    expect(within(panel).getByText('No movement record')).toBeInTheDocument();
    expect(within(panel).getByText('No transport workflow is attached')).toBeInTheDocument();
    expect(within(panel).getByText(/means only that no active DealerMail hold row was found/i)).toBeInTheDocument();
    expect(caveat.compareDocumentPosition(dealerMailRail as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(dealerMailRail).toHaveAccessibleDescription(/Confirm customer availability and physical custody with the home store/i);
    expect(panel.querySelectorAll('[data-dealermail-intent]')).toHaveLength(4);
    expect(panel.querySelectorAll('[data-action-tone="primary"]')).toHaveLength(1);
    expect(panel.querySelector('[data-dealermail-intent="view-inventory"]')).toHaveAttribute('data-action-tone', 'primary');
  });

  it('keeps a readable equipment preview and reveals every item without per-feature copy controls', async () => {
    const user = userEvent.setup();
    const equipped = vehicle();
    equipped.features = [
      'Blind Spot Information System',
      'Lane Keeping Assist',
      'Automatic Emergency Braking',
      'Rear Cross Traffic Alert',
      'Surround View Camera',
      'Driver Alert System',
      'Traffic Sign Recognition',
    ];

    render(
      <VehicleWorkspace
        vehicle={equipped}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    const panel = screen.getByRole('tabpanel', { name: 'Equipment' });

    expect(panel.querySelector('.inventory-workspace-equipment-layout')).toBeInTheDocument();
    for (const item of equipped.features) {
      expect(within(panel).getAllByText(item).some((element) => element.closest('.inventory-workspace-equipment-group'))).toBe(true);
    }
    const finalItem = within(panel)
      .getAllByText('Traffic Sign Recognition')
      .map((element) => element.closest('li'))
      .find(Boolean) as HTMLElement;
    expect(finalItem).not.toBeVisible();
    const showAll = within(panel).getByRole('button', { name: 'Show all 7 items' });
    expect(showAll).toHaveAttribute('aria-expanded', 'false');
    await user.click(showAll);
    expect(finalItem).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).queryAllByRole('button', { name: /copy/i })).toHaveLength(0);
    expect(within(panel).queryByRole('button', { name: 'Copy all published equipment' })).not.toBeInTheDocument();
    expect(panel.querySelector('.inventory-equipment-group-copy')).not.toBeInTheDocument();
    expect(panel.querySelector('.inventory-equipment-copy-value')).not.toBeInTheDocument();
    expect(panel.querySelector('.inventory-workspace-equipment-group > ul > li > svg')).not.toBeInTheDocument();
    const sourcedTrafficSign = within(panel)
      .getAllByText('Traffic Sign Recognition')
      .map((element) => element.closest('li'))
      .find((element) => element?.hasAttribute('title'));
    expect(sourcedTrafficSign).toHaveAttribute(
      'title',
      'Source: Published vehicle listing',
    );
  });

  it('keeps mobile equipment categories and source context immediate without a duplicate specifications wall', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 620px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const equipped = vehicle();
    equipped.features = ['Blind Spot Information System', 'Max Trailer Tow Package'];

    render(
      <VehicleWorkspace
        vehicle={equipped}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Equipment' }));
    const panel = screen.getByRole('tabpanel', { name: 'Equipment' });
    expect(panel.querySelector('.inventory-workspace-equipment-specifications')).not.toBeInTheDocument();
    expect(within(panel).getByRole('navigation', { name: 'Equipment sections on this vehicle' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Jump to Safety & driver assist/i })).toBeVisible();
    expect(within(panel).getByText(/organized for quick customer questions/i)).toBeVisible();
  });

  it('uses a native mobile disclosure whose visible trigger owns overflow-section selection and focus', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const mobileVehicle = vehicle();
    mobileVehicle.publicListing.listingUrl = 'https://www.bobmaxeyfordinfowlerville.com/vehicle-details?stock=W5863Q';

    render(
      <VehicleWorkspace
        vehicle={mobileVehicle}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        initialTab="hold"
        onClose={vi.fn()}
      />,
    );

    const mobileContext = screen.getByRole('region', { name: /2017 Ford F-150 Lariat vehicle summary/i });
    expect(mobileContext).toBeInTheDocument();
    expect(within(mobileContext).getByRole('button', { name: 'Copy mileage: 123328' })).toBeInTheDocument();
    expect(within(mobileContext).getByRole('button', { name: 'Copy stock number: W5863Q' })).toBeInTheDocument();
    expect(within(mobileContext).getByRole('button', { name: 'Copy VIN: 1FTFW1E86HFA48871' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Current hold and location summary' })).toBeInTheDocument();
    const mobileActions = screen.getByRole('toolbar', { name: 'Mobile vehicle actions' });
    expect(within(mobileActions).getByText('Open listing')).toBeInTheDocument();
    expect(within(mobileActions).getByText('DealerMail')).toBeInTheDocument();
    expect(mobileActions.querySelector('.inventory-workspace-mobile-actions__more > summary')).toHaveAttribute('aria-label', 'More actions');
    expect(document.querySelectorAll('.inventory-workspace-tabs [data-mobile-overflow="true"]')).toHaveLength(0);
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'More vehicle sections' })).not.toBeInTheDocument();

    const moreSections = document.querySelector<HTMLElement>(
      '.inventory-workspace-mobile-section-more > summary',
    );
    expect(moreSections).toHaveAttribute('aria-label', 'More vehicle sections');
    await user.click(moreSections!);
    const additionalSections = screen.getByRole('list', { name: 'Additional vehicle sections' });
    await user.click(within(additionalSections).getByRole('button', { name: 'History' }));

    await waitFor(() => {
      expect(moreSections).toHaveAttribute(
        'aria-label',
        'History section selected; show more vehicle sections',
      );
      expect(moreSections).toHaveAttribute('aria-current', 'page');
      expect(moreSections).toHaveAttribute('id', 'inventory-tab-timeline');
      expect(moreSections).toHaveFocus();
    });
    expect(screen.getByRole('tabpanel', { name: /History section selected/i })).toHaveAttribute(
      'aria-labelledby',
      'inventory-tab-timeline',
    );
  });

  it('uses instant programmatic scrolling when reduced motion is requested', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const equipped = vehicle();
    equipped.features = ['Blind Spot Information System', 'Max Trailer Tow Package'];

    try {
      render(
        <VehicleWorkspace
          vehicle={equipped}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          onClose={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('tab', { name: 'Equipment' }));
      await user.click(screen.getByRole('button', { name: /Jump to Safety & driver assist/i }));
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('routes the mobile DealerMail shortcut through hold evidence instead of skipping to an external action', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 620px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    render(
      <VehicleWorkspace
        vehicle={vehicle()}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );

    const mobileActions = screen.getByRole('toolbar', { name: 'Mobile vehicle actions' });
    await user.click(within(mobileActions).getByRole('button', { name: 'Review hold evidence before DealerMail tools' }));

    const holdTab = screen.getByRole('tab', { name: 'Hold and availability' });
    await waitFor(() => {
      expect(holdTab).toHaveAttribute('aria-selected', 'true');
      expect(holdTab).toHaveFocus();
    });
    expect(screen.getByRole('button', { name: 'Find Vehicle in DealerMail' })).not.toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Hold and availability' }).querySelector('.inventory-hold-evidence-list')).toBeInTheDocument();
  });

  it('gives manual stock guidance when clipboard copying is blocked', async () => {
    const user = userEvent.setup();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ opener: window } as unknown as Window);

    try {
      render(
        <VehicleWorkspace
          vehicle={vehicle()}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          initialTab="hold"
          onClose={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Find Vehicle in DealerMail' }));
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('dealermail.com'),
        '_blank',
        'noopener,noreferrer',
      );
      expect(await screen.findByText(/browser could not copy stock W5863Q/i)).toHaveTextContent(/enter stock W5863Q manually in LAST8 \/ STOCK/i);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('never applies a delayed clipboard result to a different vehicle', async () => {
    const user = userEvent.setup();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let finishCopy: (() => void) | undefined;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
          finishCopy = resolve;
        })),
      },
    });
    vi.spyOn(window, 'open').mockReturnValue({ opener: window } as unknown as Window);

    try {
      const first = vehicle();
      const second = vehicle();
      second.id = '1FTFW1E86HFA48872';
      second.vin = '1FTFW1E86HFA48872';
      second.stockNumber = 'W5864Q';
      const { rerender } = render(
        <VehicleWorkspace
          vehicle={first}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          initialTab="hold"
          onClose={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Find Vehicle in DealerMail' }));
      rerender(
        <VehicleWorkspace
          vehicle={second}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          initialTab="hold"
          onClose={vi.fn()}
        />,
      );
      finishCopy?.();
      await waitFor(() => expect(screen.queryByText(/stock W5863Q was copied/i)).not.toBeInTheDocument());
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
