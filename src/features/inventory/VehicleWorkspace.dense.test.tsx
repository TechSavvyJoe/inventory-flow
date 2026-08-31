import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleWorkspace } from './VehicleWorkspace';
import type { InventoryVehicle } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    expect(within(toolbar).getByRole('link', { name: 'AutoCheck' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('link', { name: 'Sticker' })).toBeInTheDocument();
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

  it('keeps hold, public listing, location, feed, and raw CDK evidence separate', () => {
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

    const sourceStatus = screen.getByRole('region', { name: 'Source and system status' });
    const publicSignal = sourceStatus.querySelector('.inventory-workspace-signal--public-listing');
    const feedSignal = sourceStatus.querySelector('.inventory-workspace-signal--dealeron');
    const cdkSignal = sourceStatus.querySelector('.inventory-workspace-signal--cdk');
    expect(publicSignal).toHaveTextContent('Not listed on website');
    expect(feedSignal).toHaveTextContent('Feed status unverified');
    expect(cdkSignal).toHaveTextContent('STATUS: S');
    expect(cdkSignal).toHaveTextContent('business mapping is not validated');
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

    render(
      <VehicleWorkspace
        vehicle={restricted}
        homeStore={{ id: 'fowlerville', name: 'Fowlerville' }}
        onClose={vi.fn()}
      />,
    );

    const cdkSignal = document.querySelector('.inventory-workspace-signal--cdk');
    expect(cdkSignal).toHaveTextContent('Restricted');
    expect(cdkSignal).toHaveTextContent('not visible for this role');
    expect(screen.queryByText('Private Salesperson')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Customer Name')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE RAW CDK')).not.toBeInTheDocument();
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

    expect(within(panel).getByText('Safety & driver assist')).toBeInTheDocument();
    expect(within(panel).getByText('Towing & utility')).toBeInTheDocument();
    expect(within(panel).getByText('Comfort')).toBeInTheDocument();
    expect(within(panel).getByText('Technology')).toBeInTheDocument();
    expect(within(panel).getByText('Packages & special series')).toBeInTheDocument();
    expect(within(panel).getByText('Standout upgrades')).toBeInTheDocument();
    expect(within(panel).getByText('Other published equipment')).toBeInTheDocument();

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
    expect(within(panel).getAllByText('Factory option').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Inventory listing').length).toBeGreaterThan(0);
    expect(within(panel).getByText(/Nothing is inferred from year or trim/i)).toBeInTheDocument();
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
    expect(panel.querySelector('.inventory-workspace-hold-center')).toBeInTheDocument();
    expect(panel.querySelector('.inventory-hold-evidence__facts')).toBeInTheDocument();
    expect(panel.querySelector('.inventory-workspace-hold-context')).toHaveTextContent(
      /Home store.*Fowlerville.*Current location.*Fowlerville.*Online listing.*Not listed online.*Movement.*No movement record/i,
    );
    expect(panel.querySelectorAll('[data-dealermail-intent]')).toHaveLength(6);
    expect(within(panel).getByText('Verify first')).toBeInTheDocument();
    expect(within(panel).getAllByText('W5863Q').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('1FTFW1E86HFA48871').length).toBeGreaterThan(0);
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
    expect(holdCenter).toHaveAttribute('data-hold-state', 'no-evidence');
    expect(within(panel).getByRole('heading', { name: 'No current DealerMail hold found' })).toBeInTheDocument();
    expect(within(panel).getByText('No active hold row found')).toBeInTheDocument();
    expect(within(panel).getAllByText('Fowlerville')).toHaveLength(2);
    expect(within(panel).getByText('Not listed online')).toBeInTheDocument();
    expect(within(panel).getByText('Website status: Not live on website · Current')).toBeInTheDocument();
    expect(within(panel).getByText('No movement record')).toBeInTheDocument();
    expect(within(panel).getByText('No transport workflow is attached')).toBeInTheDocument();
    expect(within(panel).getByText(/means only that no active DealerMail hold row was found/i)).toBeInTheDocument();
    expect(panel.querySelectorAll('[data-dealermail-intent]')).toHaveLength(4);
    expect(panel.querySelectorAll('[data-action-tone="primary"]')).toHaveLength(1);
    expect(panel.querySelector('[data-dealermail-intent="view-inventory"]')).toHaveAttribute('data-action-tone', 'primary');
  });

  it('shows every equipment item immediately with one top-level copy action', async () => {
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
    expect(within(panel).queryByText('2 more')).not.toBeInTheDocument();
    expect(within(panel).getAllByRole('button', { name: /copy/i })).toHaveLength(1);
    expect(within(panel).getByRole('button', { name: 'Copy all published equipment' })).toBeInTheDocument();
    expect(panel.querySelector('.inventory-equipment-group-copy')).not.toBeInTheDocument();
    expect(panel.querySelector('.inventory-equipment-copy-value')).not.toBeInTheDocument();
    const sourcedTrafficSign = within(panel)
      .getAllByText('Traffic Sign Recognition')
      .map((element) => element.closest('li'))
      .find((element) => element?.hasAttribute('title'));
    expect(sourcedTrafficSign).toHaveAttribute(
      'title',
      'Source: Inventory listing',
    );
  });

  it('exposes the mobile context, combined status, three actions, and four-tab overflow architecture', () => {
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

    expect(screen.getByRole('region', { name: /2017 Ford F-150 Lariat vehicle summary/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Current hold and location summary' })).toBeInTheDocument();
    const mobileActions = screen.getByRole('toolbar', { name: 'Mobile vehicle actions' });
    expect(within(mobileActions).getByText('Open listing')).toBeInTheDocument();
    expect(within(mobileActions).getByText('DealerMail')).toBeInTheDocument();
    expect(mobileActions.querySelector('.inventory-workspace-mobile-actions__more > summary')).toHaveAttribute('aria-label', 'More actions');
    expect(document.querySelectorAll('.inventory-workspace-tabs [data-mobile-overflow="true"]')).toHaveLength(2);
    expect(document.querySelector('.inventory-workspace-mobile-section-more > summary')).toHaveAttribute('aria-label', 'More vehicle sections');
    expect(document.querySelector('.inventory-workspace-mobile-section-more')).toHaveTextContent(/History.*Sources/i);
  });

  it('gives manual stock guidance when clipboard copying is blocked', async () => {
    const user = userEvent.setup();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    });
    vi.spyOn(window, 'open').mockReturnValue({ opener: window } as unknown as Window);

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
