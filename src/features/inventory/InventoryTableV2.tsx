import { memo, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowDown, ArrowUp, CarFront, Heart, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";
import { CopyableValue } from "../../components/CopyableValue";
import {
  formatMileage,
  formatMoney,
  resolveCurrentLocation,
  updateMultiSort,
  vehicleDisplayName,
} from "./inventory-utils";
import type {
  InventorySort,
  InventorySortKey,
  InventoryTableProps,
  InventoryVehicle,
} from "./types";
import "./InventoryTableV2.css";

export interface InventoryTableV2Props extends InventoryTableProps {
  onViewVehicle?: (vehicle: InventoryVehicle) => void;
  isShortlisted?: (vehicle: InventoryVehicle) => boolean;
  onToggleShortlist?: (vehicle: InventoryVehicle) => void;
}

interface TableColumn {
  id: string;
  label: string;
  sortKey?: InventorySortKey;
}

const TABLE_COLUMNS: TableColumn[] = [
  { id: "vehicle", label: "Vehicle", sortKey: "vehicle" },
  { id: "identifiers", label: "Stock / VIN", sortKey: "stock" },
  { id: "pricing", label: "Price & Miles", sortKey: "price" },
  { id: "location", label: "Location & Move", sortKey: "currentLocation" },
  { id: "status", label: "Hold & Service", sortKey: "holdStatus" },
  { id: "actions", label: "Actions" },
];

function SortableHeaderCell({
  column,
  sorts,
  onSortChange,
}: {
  column: TableColumn;
  sorts: InventorySort[];
  onSortChange: (sorts: InventorySort[]) => void;
}) {
  const activeSort = column.sortKey
    ? sorts.find((s) => s.key === column.sortKey)
    : undefined;

  const handleClick = (e: ReactMouseEvent) => {
    if (!column.sortKey) return;
    onSortChange(updateMultiSort(sorts, column.sortKey, e.shiftKey));
  };

  const ariaSort = activeSort
    ? activeSort.direction === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      scope="col"
      aria-sort={column.sortKey ? ariaSort : undefined}
      className={`inventory-table-v2-th inventory-table-v2-th--${column.id}`}
    >
      {column.sortKey ? (
        <button
          type="button"
          className="inventory-table-v2-th-btn"
          onClick={handleClick}
          aria-label={`Sort by ${column.label} ${
            activeSort?.direction === "asc" ? "descending" : "ascending"
          }`}
        >
          <span>{column.label}</span>
          <span className="inventory-table-v2-sort-icon" aria-hidden="true">
            {activeSort ? (
              activeSort.direction === "asc" ? (
                <ArrowUp size={13} strokeWidth={2.2} />
              ) : (
                <ArrowDown size={13} strokeWidth={2.2} />
              )
            ) : null}
          </span>
        </button>
      ) : (
        <span>{column.label}</span>
      )}
    </th>
  );
}

function VehicleRow({
  vehicle,
  isSelected,
  canRequest,
  shortlisted,
  onSelectVehicle,
  onTrackMovement,
  onRequestVehicle,
  onViewVehicle,
  onToggleShortlist,
}: {
  vehicle: InventoryVehicle;
  isSelected: boolean;
  canRequest: boolean;
  shortlisted: boolean;
  onSelectVehicle: (vehicle: InventoryVehicle) => void;
  onTrackMovement?: (vehicle: InventoryVehicle) => void;
  onRequestVehicle?: (vehicle: InventoryVehicle) => void;
  onViewVehicle?: (vehicle: InventoryVehicle) => void;
  onToggleShortlist?: (vehicle: InventoryVehicle) => void;
}) {
  const location = useMemo(() => resolveCurrentLocation(vehicle), [vehicle]);
  const thumbnail = vehicle.imageUrl || vehicle.imageUrls?.[0] || null;

  const hasRecall = Boolean(
    vehicle.fordOasis?.openFieldServiceActions &&
      vehicle.fordOasis.openFieldServiceActions.length > 0,
  );

  const holdSalesperson = vehicle.holdEvidence?.[0]?.salesperson;
  const isHeld = Boolean(vehicle.dealerMail?.hasActiveHold);

  const serviceStatus = vehicle.serviceReadiness?.status ?? "needs_service";

  const handleRowClick = () => {
    onSelectVehicle(vehicle);
  };

  return (
    <tr
      className={`inventory-table-v2-row${isSelected ? " is-selected" : ""}`}
      data-vehicle-id={vehicle.id}
      data-vin={vehicle.vin}
    >
      {/* 1. Vehicle info */}
      <td className="inventory-table-v2-td inventory-table-v2-td--vehicle">
        <div className="inv-v2-vehicle-cell">
          <div className="inv-v2-vehicle-thumb">
            {thumbnail ? (
              <img src={thumbnail} alt="" loading="lazy" />
            ) : (
              <CarFront size={24} aria-hidden="true" />
            )}
          </div>
          <div className="inv-v2-vehicle-details">
            <button
              type="button"
              className="inv-v2-title-btn"
              onClick={handleRowClick}
              aria-label={`View ${vehicleDisplayName(vehicle)}`}
            >
              {vehicleDisplayName(vehicle)}
            </button>
            <span className="inv-v2-vehicle-sub">
              {[
                vehicle.exteriorColor,
                vehicle.engine,
                vehicle.transmission,
                vehicle.drivetrain,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
      </td>

      {/* 2. Stock / VIN chips */}
      <td className="inventory-table-v2-td inventory-table-v2-td--identifiers">
        <div className="inv-v2-id-cell">
          <span className="inv-v2-id-chip">
            <CopyableValue label="Stock" text={vehicle.stockNumber} compact>
              #{vehicle.stockNumber}
            </CopyableValue>
          </span>
          <span className="inv-v2-id-chip">
            <CopyableValue label="VIN" text={vehicle.vin} compact>
              {vehicle.vin}
            </CopyableValue>
          </span>
        </div>
      </td>

      {/* 3. Pricing & Mileage */}
      <td className="inventory-table-v2-td inventory-table-v2-td--pricing">
        <div className="inv-v2-pricing-cell">
          <span className="inv-v2-price">{formatMoney(vehicle.price)}</span>
          {vehicle.msrp && vehicle.msrp !== vehicle.price ? (
            <span className="inv-v2-msrp">MSRP {formatMoney(vehicle.msrp)}</span>
          ) : null}
          <span className="inv-v2-miles">
            {formatMileage(vehicle.mileage)}
            {vehicle.daysListed != null ? ` · ${vehicle.daysListed}d` : ""}
          </span>
        </div>
      </td>

      {/* 4. Location & Movement */}
      <td className="inventory-table-v2-td inventory-table-v2-td--location">
        <div className="inv-v2-location-cell">
          <span className="inv-v2-store-name">{location.label}</span>
          {vehicle.movement?.state ? (
            <span className="inv-v2-move-pill">
              {vehicle.movement.state === "in_transit"
                ? "In Transit"
                : vehicle.movement.state === "requested"
                  ? "Move Requested"
                  : vehicle.movement.state}
            </span>
          ) : null}
        </div>
      </td>

      {/* 5. Status Badges */}
      <td className="inventory-table-v2-td inventory-table-v2-td--status">
        <div className="inv-v2-status-cell">
          {isHeld ? (
            <span className="inventory-v2-badge inventory-v2-badge--hold">
              Hold{holdSalesperson ? `: ${holdSalesperson}` : ""}
            </span>
          ) : (
            <span className="inventory-v2-badge inventory-v2-badge--available">
              Available
            </span>
          )}

          {serviceStatus === "serviced" ? (
            <span className="inventory-v2-badge inventory-v2-badge--serviced">
              Ready
            </span>
          ) : serviceStatus === "in_service" ? (
            <span className="inventory-v2-badge inventory-v2-badge--in-service">
              In Service
            </span>
          ) : (
            <span className="inventory-v2-badge inventory-v2-badge--needs-service">
              Needs Service
            </span>
          )}

          {hasRecall ? (
            <span className="inventory-v2-badge inventory-v2-badge--recall">
              <ShieldAlert size={12} aria-hidden="true" /> Recall
            </span>
          ) : null}
        </div>
      </td>

      {/* 6. Quick Actions */}
      <td className="inventory-table-v2-td inventory-table-v2-td--actions">
        <div className="inv-v2-actions-cell">
          {onToggleShortlist ? (
            <motion.button
              type="button"
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.9 }}
              className={`inv-v2-action-btn inv-v2-action-shortlist${shortlisted ? " is-active" : ""}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onToggleShortlist(vehicle);
              }}
              title={shortlisted ? "Remove from customer interest" : "Mark as customer interest"}
              aria-label={shortlisted ? `Remove ${vehicle.stockNumber} from shortlist` : `Add ${vehicle.stockNumber} to shortlist`}
              aria-pressed={shortlisted}
              style={{
                color: shortlisted ? "var(--ifx-danger, var(--v10-red))" : undefined,
              }}
            >
              <Heart size={15} fill={shortlisted ? "currentColor" : "none"} />
            </motion.button>
          ) : null}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="inv-v2-action-btn inv-v2-action-view"
            onClick={() => {
              onViewVehicle ? onViewVehicle(vehicle) : onSelectVehicle(vehicle);
            }}
            title="Open Vehicle Details"
            aria-label={`View details for ${vehicle.stockNumber}`}
          >
            View
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="inv-v2-action-btn inv-v2-action-move"
            onClick={() => {
              onTrackMovement ? onTrackMovement(vehicle) : onSelectVehicle(vehicle);
            }}
            title="Track or schedule vehicle movement"
            aria-label={`Move vehicle ${vehicle.stockNumber}`}
          >
            Move
          </motion.button>

          <motion.button
            type="button"
            whileHover={canRequest ? { scale: 1.05 } : undefined}
            whileTap={canRequest ? { scale: 0.95 } : undefined}
            disabled={!canRequest}
            className="inv-v2-action-btn inv-v2-action-request"
            onClick={() => {
              if (!canRequest) return;
              onRequestVehicle
                ? onRequestVehicle(vehicle)
                : onSelectVehicle(vehicle);
            }}
            title={
              canRequest
                ? "Request vehicle transfer"
                : "Transfer request not available"
            }
            aria-label={`Request transfer for ${vehicle.stockNumber}`}
          >
            Request
          </motion.button>
        </div>
      </td>
    </tr>
  );
}

export const InventoryTableV2 = memo(function InventoryTableV2({
  vehicles,
  selectedVehicleId,
  sorts,
  onSortChange,
  onSelectVehicle,
  canRequestVehicle,
  onRequestVehicle,
  onTrackMovement,
  onViewVehicle,
  isShortlisted,
  onToggleShortlist,
}: InventoryTableV2Props) {
  return (
    <div className="inventory-table-v2-wrapper">
      <div className="inventory-table-v2-container">
        <table
          className="inventory-table-v2"
          role="table"
          aria-label="Inventory vehicles"
        >
          <colgroup>
            <col className="inventory-table-v2-col inventory-table-v2-col--vehicle" />
            <col className="inventory-table-v2-col inventory-table-v2-col--identifiers" />
            <col className="inventory-table-v2-col inventory-table-v2-col--pricing" />
            <col className="inventory-table-v2-col inventory-table-v2-col--location" />
            <col className="inventory-table-v2-col inventory-table-v2-col--status" />
            <col className="inventory-table-v2-col inventory-table-v2-col--actions" />
          </colgroup>
          <thead>
            <tr>
              {TABLE_COLUMNS.map((col) => (
                <SortableHeaderCell
                  key={col.id}
                  column={col}
                  sorts={sorts}
                  onSortChange={onSortChange}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 ? (
              <tr>
                <td
                  colSpan={TABLE_COLUMNS.length}
                  className="inventory-table-v2-empty"
                >
                  No vehicles to display
                </td>
              </tr>
            ) : (
              vehicles.map((vehicle) => {
                const canRequest =
                  typeof canRequestVehicle === "function"
                    ? canRequestVehicle(vehicle)
                    : (canRequestVehicle ?? true);

                return (
                  <VehicleRow
                    key={vehicle.id || vehicle.vin}
                    vehicle={vehicle}
                    isSelected={
                      selectedVehicleId === vehicle.id ||
                      selectedVehicleId === vehicle.vin
                    }
                    canRequest={Boolean(canRequest)}
                    shortlisted={isShortlisted ? isShortlisted(vehicle) : false}
                    onSelectVehicle={onSelectVehicle}
                    onTrackMovement={onTrackMovement}
                    onRequestVehicle={onRequestVehicle}
                    onViewVehicle={onViewVehicle}
                    onToggleShortlist={onToggleShortlist}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});
