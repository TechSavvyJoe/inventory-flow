import {
  ChevronRight,
  Clock3,
  Globe2,
  MapPinned,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { formatNumber } from "./inventory-utils";
import type {
  InventoryDecisionRailProps,
  InventoryMetricKey,
} from "./types";

interface MetricDefinition {
  key: InventoryMetricKey;
  label: string;
  Icon: LucideIcon;
  tone: "blue" | "orange" | "violet" | "red";
}

const METRICS: MetricDefinition[] = [
  { key: "publicUnits", label: "Public units", Icon: Globe2, tone: "blue" },
  { key: "currentHolds", label: "Current holds", Icon: UserRound, tone: "orange" },
  { key: "awayFromHome", label: "Away from home", Icon: MapPinned, tone: "violet" },
  { key: "returnOverdue", label: "Return overdue", Icon: Clock3, tone: "red" },
];

type InteractiveDecisionRailProps = InventoryDecisionRailProps & {
  activeMetric?: InventoryMetricKey | null;
};

export function InventoryDecisionRail({
  metrics,
  onSelect,
  activeMetric = null,
}: InteractiveDecisionRailProps) {
  return (
    <section className="inventory-decision-rail" aria-label="Inventory decisions">
      {METRICS.map(({ key, label, Icon, tone }) => {
        const isActive = activeMetric === key;
        const content = (
          <>
            <span className={`inventory-metric__icon inventory-tone--${tone}`} aria-hidden="true">
              <Icon size={22} strokeWidth={1.75} />
            </span>
            <span className="inventory-metric__copy">
              <span className="inventory-metric__label">{label}</span>
              <strong className="inventory-metric__value">{formatNumber(metrics[key])}</strong>
            </span>
            {onSelect ? (
              isActive ? (
                <X className="inventory-metric__chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <ChevronRight className="inventory-metric__chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
              )
            ) : null}
          </>
        );

        return onSelect ? (
          <button
            className={`inventory-metric inventory-metric--button${isActive ? " is-active" : ""}`}
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={isActive}
            aria-label={`${label}: ${formatNumber(metrics[key])}. ${isActive ? "Filter active; activate to clear" : "Show matching vehicles"}`}
          >
            {content}
          </button>
        ) : (
          <div className="inventory-metric" key={key}>
            {content}
          </div>
        );
      })}
    </section>
  );
}
