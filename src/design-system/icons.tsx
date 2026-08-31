import type { ReactNode, SVGProps } from "react";

export type FlowIconProps = Omit<SVGProps<SVGSVGElement>, "children" | "viewBox"> & {
  size?: number | string;
  title?: string;
};

type IconFrameProps = FlowIconProps & { children: ReactNode };

function IconFrame({ children, className = "", size = 20, title, ...props }: IconFrameProps) {
  return (
    <svg
      {...props}
      className={`ifx-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Product-system glyph; not a replacement for the full logo asset. */
export function FlowlineIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 19V10a5 5 0 0 1 5-5h7" />
      <path data-accent="true" d="M6 12h9" />
      <circle data-accent="true" cx="6" cy="19" r="1.1" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function VehicleIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M3.5 13.5 5 9.2A2.4 2.4 0 0 1 7.3 7.6h9.4A2.4 2.4 0 0 1 19 9.2l1.5 4.3" />
      <path d="M4 13.5h16v4.2a1.3 1.3 0 0 1-1.3 1.3H5.3A1.3 1.3 0 0 1 4 17.7z" />
      <path d="M7 16.2h.01M17 16.2h.01" />
      <path data-accent="true" d="M7 11h10" />
    </IconFrame>
  );
}

export function InventoryIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="3" />
      <path d="M7.5 8h9M7.5 12h6.5M7.5 16h4" />
      <circle data-accent="true" cx="17.5" cy="16" r="1.5" />
    </IconFrame>
  );
}

export function HoldIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 14.5 5.4 10A2.3 2.3 0 0 1 7.6 8.4h5.2" />
      <path d="M4.5 14.5h9.1v4H5.7a1.2 1.2 0 0 1-1.2-1.2z" />
      <circle cx="7" cy="16.6" r=".8" fill="currentColor" stroke="none" />
      <circle data-accent="true" cx="17" cy="11" r="4" />
      <path data-accent="true" d="M15.5 9.5v3M18.5 9.5v3" />
    </IconFrame>
  );
}

export function TransferIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 8h12.5" />
      <path data-accent="true" d="m14 5 3 3-3 3" />
      <path d="M20 16H7.5" />
      <path data-accent="true" d="m10 13-3 3 3 3" />
    </IconFrame>
  );
}

export function RouteIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="5" cy="17.5" r="2" />
      <circle data-accent="true" cx="18.5" cy="6" r="2" />
      <path d="M7 17.5h2.5c5.7 0 1.6-11.5 7-11.5" />
      <path d="m15 15 2.5 2.5L15 20" />
    </IconFrame>
  );
}

export function LocationIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 21s6.5-6.2 6.5-12A6.5 6.5 0 0 0 5.5 9C5.5 14.8 12 21 12 21Z" />
      <circle data-accent="true" cx="12" cy="9" r="2.2" />
    </IconFrame>
  );
}

export function DriverIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c.8-4 3-6 6.5-6s5.7 2 6.5 6" />
      <path data-accent="true" d="M8.2 5.8 12 4l3.8 1.8" />
    </IconFrame>
  );
}

export function SalespersonIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.7-4 2.6-6 5.5-6 2.3 0 4 1.2 4.9 3.5" />
      <path data-accent="true" d="M17 11v7M14.5 13.5 17 11l2.5 2.5" />
    </IconFrame>
  );
}

export function CustomerIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="9.5" cy="8" r="3" />
      <path d="M4 19c.7-4 2.6-6 5.5-6 2.5 0 4.3 1.4 5.2 4" />
      <path data-accent="true" d="M17 8.5h3.5v5H17l-2 2v-7z" />
    </IconFrame>
  );
}

export function CommentIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      <path data-accent="true" d="M7.5 9h9M7.5 13h5.5" />
    </IconFrame>
  );
}

export function AlertIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="m12 3 9 17H3z" />
      <path data-accent="true" d="M12 9v5M12 17.2h.01" />
    </IconFrame>
  );
}

export function PriceChangeIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12.5 4H7L3.5 7.5 12 16l7.5-7.5-4.5-4.5h-2.5Z" />
      <circle cx="8" cy="8.5" r="1" />
      <path data-accent="true" d="M9.5 20h8M15 17.5l2.5 2.5-2.5 2.5" />
    </IconFrame>
  );
}

export function MileageIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M7 18h10" />
      <path data-accent="true" d="m12 15 3.8-5.2" />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function FactoryStickerIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 3.5h9l3 3V20.5H6z" />
      <path d="M15 3.5v4h3" />
      <path data-accent="true" d="M9 11h6M9 14.5h6M9 18h3" />
      <path d="M3.5 6v11" />
    </IconFrame>
  );
}

export function VehicleHistoryIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M5 8a8 8 0 1 1-1 7" />
      <path data-accent="true" d="M5 4v4H1" />
      <path d="M12 7v5l3.5 2" />
    </IconFrame>
  );
}

export function SearchIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path data-accent="true" d="m15.4 15.4 4.6 4.6" />
    </IconFrame>
  );
}

export function SortIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M7 4v16M4 7l3-3 3 3" />
      <path data-accent="true" d="M17 20V4M14 17l3 3 3-3" />
    </IconFrame>
  );
}

export function FilterIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
      <path data-accent="true" d="M7 9h10" />
    </IconFrame>
  );
}

export function ActionsIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle data-accent="true" cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function TimelineIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M7 4v16" />
      <circle cx="7" cy="7" r="2" />
      <circle data-accent="true" cx="7" cy="16" r="2" />
      <path d="M11 7h9M11 16h7" />
    </IconFrame>
  );
}

export function CheckIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path data-accent="true" d="m4 12 5 5L20 6" />
    </IconFrame>
  );
}

export function CloseIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </IconFrame>
  );
}

export function PhotoIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3" y="5" width="18" height="15" rx="3" />
      <circle data-accent="true" cx="9" cy="10" r="2" />
      <path d="m5 18 5-5 3.5 3 2.5-2 3 4" />
    </IconFrame>
  );
}

export function OpenRecordIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M11 5H5v14h14v-6" />
      <path data-accent="true" d="M13 4h7v7M20 4l-9 9" />
    </IconFrame>
  );
}

export function SparkIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path data-accent="true" d="M12 3c.7 4.8 3.2 7.3 8 8-4.8.7-7.3 3.2-8 8-.7-4.8-3.2-7.3-8-8 4.8-.7 7.3-3.2 8-8Z" />
    </IconFrame>
  );
}

export function TowingIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M3 7h11v9H3zM14 11h3l3 3v2h-6" />
      <circle cx="6" cy="18" r="2" />
      <circle data-accent="true" cx="17" cy="18" r="2" />
    </IconFrame>
  );
}

export function SafetyIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3 4.5 6v5.5c0 4.8 3 7.9 7.5 9.5 4.5-1.6 7.5-4.7 7.5-9.5V6z" />
      <path data-accent="true" d="m8.5 12 2.2 2.2 4.8-5" />
    </IconFrame>
  );
}

export function TechnologyIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <rect x="5" y="3" width="14" height="18" rx="3" />
      <path data-accent="true" d="M8.5 7h7v7h-7z" />
      <path d="M10 17h4" />
    </IconFrame>
  );
}

export function ComfortIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M7 5v8c0 3.3 2.7 6 6 6h5" />
      <path d="M7 10h5c2.8 0 5 2.2 5 5v4" />
      <path data-accent="true" d="M10 5c.8 1 1.2 2 0 3M14 5c.8 1 1.2 2 0 3" />
    </IconFrame>
  );
}

export function FeaturePackageIcon(props: FlowIconProps) {
  return (
    <IconFrame {...props}>
      <path d="m4 8 8-4 8 4-8 4z" />
      <path d="M4 8v8l8 4 8-4V8M12 12v8" />
      <path data-accent="true" d="m8 6 8 4" />
    </IconFrame>
  );
}

export const flowIconSet = {
  flowline: FlowlineIcon,
  vehicle: VehicleIcon,
  inventory: InventoryIcon,
  hold: HoldIcon,
  transfer: TransferIcon,
  route: RouteIcon,
  location: LocationIcon,
  driver: DriverIcon,
  salesperson: SalespersonIcon,
  customer: CustomerIcon,
  comment: CommentIcon,
  alert: AlertIcon,
  priceChange: PriceChangeIcon,
  mileage: MileageIcon,
  factorySticker: FactoryStickerIcon,
  vehicleHistory: VehicleHistoryIcon,
  search: SearchIcon,
  sort: SortIcon,
  filter: FilterIcon,
  actions: ActionsIcon,
  timeline: TimelineIcon,
  check: CheckIcon,
  close: CloseIcon,
  photo: PhotoIcon,
  openRecord: OpenRecordIcon,
  spark: SparkIcon,
  towing: TowingIcon,
  safety: SafetyIcon,
  technology: TechnologyIcon,
  comfort: ComfortIcon,
  featurePackage: FeaturePackageIcon,
} as const;

export type FlowIconName = keyof typeof flowIconSet;
