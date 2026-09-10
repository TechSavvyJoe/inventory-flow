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
  it('keeps one app main landmark and one vehicle identity with explicit return controls', () => {
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
    expect(screen.getAllByRole('heading', { name: '2017 Ford F-150 Lariat' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Close vehicle details' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Back to inventory' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy stock number: W5863Q' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy VIN: 1FTFW1E86HFA48871' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Copy mileage: 123328' })).not.toBeInTheDocument();
    expect(document.querySelector('.inventory-workspace-backdrop')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.inventory-workspace-backdrop')?.tagName).toBe('DIV');
  });

  it('keeps one priority toolbar and puts VIN-specific secondary links behind More resources', async () => {
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
    expect(screen.getAllByRole('toolbar')).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: 'DealerMail tools' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('link', { name: /Open AutoCheck report/i })).not.toBeVisible();
    await userEvent.click(within(toolbar).getByText('More resources'));
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
    expect(stickerAction.querySelector('svg')).toBeInTheDocument();
    expect(stickerAction).toHaveAttribute('data-read-only', 'true');
    expect(autoCheckAction).toHaveAttribute('data-read-only', 'true');
    expect(within(toolbar).getByRole('link', { name: 'Invoice' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('link', { name: 'OASIS' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-action="dealermail-tools"]')).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: 'Vehicle records' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Full record' })).toBeInTheDocument();
    expect(document.querySelector('.inventory-workspace-actions')).not.toBeInTheDocument();

    const header = document.querySelector('.vdp-flow-header');
    const tabs = document.querySelector('.inventory-workspace-tabs');
    expect(header?.nextElementSibling).toContainElement(tabs as HTMLElement);
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

    const primary = screen.getByRole('region', { name: 'Vehicle operational summary' });
    expect(within(primary).getByText('On hold')).toBeInTheDocument();
    expect(within(primary).getByText('Fowlerville')).toBeInTheDocument();

    expect(screen.getAllByRole('region', { name: 'Vehicle operational summary' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Some vehicle information needs a fresh check. Review records/i })).toBeInTheDocument();
    expect(primary).not.toHaveTextContent(/inventory feed|CDK/i);
    expect(primary).not.toHaveTextContent(/sold|delivered/i);
  });

  it('shows the gallery and operational summary only in Overview while identity stays available', async () => {
    const user = userEvent.setup();
    render(<VehicleWorkspace vehicle={vehicle()} homeStore={{ id: 'fowlerville', name: 'Fowlerville' }} onClose={vi.fn()} />);
    const gallery = screen.getByRole('region', { name: 'Vehicle photos' });
    const operationalSummary = screen.getByRole('region', { name: 'Vehicle operational summary' });
    expect(gallery).toBeVisible();
    expect(operationalSummary).toBeVisible();

    for (const name of ['Equipment', 'Holds & moves', 'Records']) {
      await user.click(screen.getByRole('tab', { name }));
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      expect(screen.getByRole('tabpanel', { name })).toBeVisible();
      expect(gallery).not.toBeVisible();
      expect(operationalSummary).not.toBeVisible();
      expect(screen.getAllByRole('heading', { name: '2017 Ford F-150 Lariat' })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Copy stock number: W5863Q' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Copy VIN: 1FTFW1E86HFA48871' })).toBeVisible();
    }

    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(gallery).toBeVisible();
    expect(operationalSummary).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'View all equipment' }));
    expect(screen.getByRole('tab', { name: 'Equipment' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps request and track actions in movement context and respects request eligibility', async () => {
    const user = userEvent.setup();
    const onRequestVehicle = vi.fn();
    const onTrackMovement = vi.fn();
    const unit = vehicle();
    const { rerender } = render(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()}
      canRequestVehicle onRequestVehicle={onRequestVehicle} onTrackMovement={onTrackMovement} />);
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Holds & moves' }));
    const movement = screen.getByRole('region', { name: 'Location & movement' });
    await user.click(within(movement).getByRole('button', { name: 'Request vehicle' }));
    expect(onRequestVehicle).toHaveBeenCalledExactlyOnceWith(unit);
    expect(onTrackMovement).not.toHaveBeenCalled();

    rerender(<VehicleWorkspace vehicle={unit} homeStore={unit.location.homeStore} onClose={vi.fn()} canRequestVehicle={false}
      onRequestVehicle={onRequestVehicle} onTrackMovement={onTrackMovement} />);
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    const moving = { ...unit, movement: { state: 'requested', requestId: 'test-move-1' } };
    rerender(<VehicleWorkspace vehicle={moving} homeStore={unit.location.homeStore} onClose={vi.fn()} canRequestVehicle
      onRequestVehicle={onRequestVehicle} onTrackMovement={onTrackMovement} />);
    expect(screen.queryByRole('button', { name: 'Request vehicle' })).not.toBeInTheDocument();
    await user.click(within(movement).getByRole('button', { name: 'Track movement' }));
    expect(onTrackMovement).toHaveBeenCalledExactlyOnceWith(moving);
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
    await userEvent.click(screen.getByRole('tab', { name: 'Holds & moves' }));
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
    const equipment = screen.getByRole('tab', { name: 'Equipment' });
    const hold = screen.getByRole('tab', { name: 'Holds & moves' });
    const records = screen.getByRole('tab', { name: 'Records' });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Equipment', 'Holds & moves', 'Records']);
    expect(overview).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => {
      expect(document.querySelector('.inventory-workspace-close')).toHaveFocus();
    });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(equipment).toHaveAttribute('aria-selected', 'true');
      expect(equipment).toHaveFocus();
    });
    fireEvent.keyDown(equipment, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(hold).toHaveAttribute('aria-selected', 'true');
      expect(hold).toHaveFocus();
      expect(document.querySelector('#inventory-section-hold')).toHaveAttribute('open');
    });
    fireEvent.keyDown(hold, { key: 'End' });
    await waitFor(() => expect(records).toHaveFocus());
    expect(records).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel', { name: 'Records' })).toHaveAttribute('aria-labelledby', records.id);
    fireEvent.keyDown(records, { key: 'Home' });
    await waitFor(() => expect(overview).toHaveFocus());
    fireEvent.keyDown(overview, { key: 'ArrowLeft' });
    await waitFor(() => expect(records).toHaveFocus());
  });

  it('opens a legacy movement target in Holds & moves, focusing readable movement details', async () => {
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

    const panel = screen.getByRole('tabpanel', { name: 'Holds & moves' });
    expect(screen.getByRole('tab', { name: 'Holds & moves' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.querySelector('#inventory-section-movement')).toHaveFocus());
    expect(panel).toHaveTextContent(/Movement state\s*Requested/i);
    expect(panel).toHaveTextContent(/Request status\s*Manager review/i);
    expect(panel).toHaveTextContent(/Customer outcome\s*Not confirmed/i);
    expect(panel).toHaveTextContent(/Delivery confirmation\s*Not confirmed/i);
    expect(within(panel).getByText('Home manager confirms the vehicle can be released for transfer').parentElement)
      .toHaveClass('inventory-workspace-fact--wide-mobile');
    expect(within(panel).getByText('movement-request-with-a-long-identifier').parentElement)
      .toHaveClass('inventory-workspace-fact--wide-mobile');
  });

  it('opens a legacy timeline target in Records and focuses source-labelled activity', async () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle()}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        initialTab="timeline"
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByRole('tabpanel', { name: 'Records' });
    expect(screen.getByRole('tab', { name: 'Records' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.querySelector('#inventory-section-timeline')).toHaveFocus());
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
    const originalBuild = panel.querySelector('#inventory-equipment-configuration')!;
    expect(originalBuild).not.toHaveAttribute('open');
    await user.click(within(panel).getByRole('button', { name: 'Jump to Original build details' }));
    expect(originalBuild).toHaveAttribute('open');
    expect(originalBuild).toHaveFocus();
    expect(within(panel).getByRole('heading', { name: 'Original-sticker configuration' })).toBeVisible();
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
      expect(screen.getByRole('tab', { name: 'Records' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Records' }).closest('details')).toHaveAttribute('open');
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
    await user.click(screen.getByText('Original build details', { selector: 'summary span' }));
    expect(screen.getByRole('heading', { name: 'VIN equipment profile' })).toBeVisible();
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

  it('keeps hold evidence and one truthful DealerMail handoff in one operational surface', () => {
    render(
      <VehicleWorkspace
        vehicle={vehicle()}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        initialTab="hold"
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByRole('tabpanel', { name: 'Holds & moves' });
    const evidence = panel.querySelector('.inventory-hold-evidence-list');
    const caveat = panel.querySelector('#inventory-hold-availability-caveat') as HTMLElement;
    const dealerMailRail = panel.querySelector('.inventory-workspace-dealermail-rail');
    expect(panel.querySelector('.inventory-workspace-hold-center')).toBeInTheDocument();
    expect(panel.querySelector('.inventory-hold-evidence__facts')).toBeInTheDocument();
    expect(evidence?.compareDocumentPosition(dealerMailRail as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(caveat.compareDocumentPosition(dealerMailRail as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(dealerMailRail).toHaveTextContent('the vehicle is not selected automatically');
    expect(panel.querySelector('.inventory-workspace-hold-context')).toHaveTextContent(
      /Home store.*Fowlerville.*Current location.*Fowlerville.*Online listing.*Not listed online.*Movement.*No movement record/i,
    );
    expect(within(dealerMailRail as HTMLElement).getAllByRole('button')).toHaveLength(1);
    expect(within(panel).getByText('Verify full VIN')).toBeInTheDocument();
    expect(within(panel).getAllByText('W5863Q').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('1FTFW1E86HFA48871').length).toBeGreaterThan(0);
    expect(within(panel).getByRole('button', { name: 'Open DealerMail & copy stock' })).toBeVisible();
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

    const panel = screen.getByRole('tabpanel', { name: 'Holds & moves' });
    const holdCenter = panel.querySelector('.inventory-workspace-hold-center');
    const caveat = panel.querySelector('#inventory-hold-availability-caveat') as HTMLElement;
    const dealerMailRail = panel.querySelector('.inventory-workspace-dealermail-rail');
    expect(holdCenter).toHaveAttribute('data-hold-state', 'no-evidence');
    expect(within(panel).getByRole('heading', { name: 'No current DealerMail hold found' })).toBeInTheDocument();
    expect(within(panel).getByText('No active hold row found')).toBeInTheDocument();
    const holdSummary = within(panel).getByRole('region', { name: 'No current DealerMail hold found' });
    expect(within(holdSummary).getAllByText('Fowlerville')).toHaveLength(2);
    expect(within(panel).getByText('Not listed online')).toBeInTheDocument();
    expect(within(panel).getByText('Website status: Not live on website · Current')).toBeInTheDocument();
    expect(within(panel).getByText('No movement record')).toBeInTheDocument();
    expect(within(panel).getByText('No transport workflow is attached')).toBeInTheDocument();
    expect(within(panel).getByText(/means only that no active DealerMail hold row was found/i)).toBeInTheDocument();
    expect(caveat.compareDocumentPosition(dealerMailRail as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(dealerMailRail).toHaveTextContent('the vehicle is not selected automatically');
    expect(within(dealerMailRail as HTMLElement).getAllByRole('button')).toHaveLength(1);
    expect(within(dealerMailRail as HTMLElement).getByRole('button', { name: 'Open DealerMail & copy stock' })).toBeEnabled();
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

  it('uses the same four direct sections and one identity on mobile without a secondary section menu', async () => {
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

    expect(screen.getAllByRole('heading', { name: '2017 Ford F-150 Lariat' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy stock number: W5863Q' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Copy VIN: 1FTFW1E86HFA48871' })).toHaveLength(1);
    expect(screen.getAllByRole('toolbar')).toHaveLength(1);
    expect(screen.getByRole('toolbar', { name: 'Vehicle actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Equipment', 'Holds & moves', 'Records']);
    expect(screen.queryByRole('menu', { name: 'More vehicle sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Additional vehicle sections' })).not.toBeInTheDocument();
    const records = screen.getByRole('tab', { name: 'Records' });
    await user.click(records);
    await waitFor(() => {
      expect(records).toHaveAttribute('aria-selected', 'true');
      expect(records).toHaveFocus();
    });
    expect(screen.getByRole('tabpanel', { name: 'Records' })).toHaveAttribute('aria-labelledby', 'inventory-tab-data');
    expect(screen.getByRole('heading', { name: 'Vehicle history' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Vehicle operational summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Vehicle photos' })).not.toBeInTheDocument();
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

  it('routes the mobile DealerMail shortcut to the local handoff without opening or changing a CRM record', async () => {
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

    const openSpy = vi.spyOn(window, 'open');
    const actions = screen.getByRole('toolbar', { name: 'Vehicle actions' });
    await user.click(within(actions).getByRole('button', { name: 'DealerMail tools' }));

    const holdTab = screen.getByRole('tab', { name: 'Holds & moves' });
    await waitFor(() => {
      expect(holdTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('button', { name: 'Open DealerMail & copy stock' })).toHaveFocus();
    });
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('tabpanel', { name: 'Holds & moves' }).querySelector('.inventory-hold-evidence-list')).toBeInTheDocument();
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
      await user.click(screen.getByRole('button', { name: 'Open DealerMail & copy stock' }));
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('dealermail.com'),
        '_blank',
        'noopener,noreferrer',
      );
      expect(await screen.findByText(/Stock could not be copied/i)).toHaveTextContent(/Select stock W5863Q above and copy it manually/i);
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
      await user.click(screen.getByRole('button', { name: 'Open DealerMail & copy stock' }));
      rerender(
        <VehicleWorkspace
          vehicle={second}
          homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
          initialTab="hold"
          onClose={vi.fn()}
        />,
      );
      finishCopy?.();
      await waitFor(() => expect(screen.queryByText(/Stock W5863Q copied/i)).not.toBeInTheDocument());
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
