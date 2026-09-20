import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CarFront, ChevronUp, Heart, Trash2, X } from "lucide-react";
import { formatMoney } from "./inventory-utils";
import type { ShortlistEntry } from "./useCustomerShortlist";
import type { InventoryVehicle } from "./types";

export interface CustomerShortlistDrawerProps {
  entries: ShortlistEntry[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onSelectVehicle?: (vehicle: { id: string }) => void;
}

export function CustomerShortlistDrawer({
  entries,
  onRemove,
  onClear,
  onSelectVehicle,
}: CustomerShortlistDrawerProps) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="shortlist-drawer"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", damping: 22, stiffness: 260 }}
        style={{
          position: "fixed",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9000,
          width: "min(720px, calc(100vw - 32px))",
          background: "var(--v10-surface, #fff)",
          border: "1px solid var(--v10-border, #e2e2e2)",
          borderBottom: "none",
          borderRadius: "12px 12px 0 0",
          boxShadow: "0 -4px 24px rgb(0 0 0 / 12%)",
          overflow: "hidden",
        }}
      >
        {/* Collapsed Bar */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: "12px 16px",
            background: "linear-gradient(135deg, var(--v10-blue, #2563eb) 0%, #7c3aed 100%)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 700,
            gap: "8px",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Heart size={16} fill="currentColor" />
            Customer Interest ({entries.length} vehicle{entries.length !== 1 ? "s" : ""})
          </span>
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronUp size={18} />
          </motion.span>
        </button>

        {/* Expanded Content */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
            >
              <div style={{ padding: "12px 16px 16px" }}>
                {/* Header row */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontWeight: 700,
                      color: "var(--v10-support, #666)",
                    }}
                  >
                    Compare Vehicles
                  </span>
                  <button
                    type="button"
                    onClick={onClear}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--v10-red, #dc2626)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px 8px",
                      borderRadius: "4px",
                    }}
                  >
                    <Trash2 size={12} /> Clear All
                  </button>
                </div>

                {/* Vehicle Cards */}
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    overflowX: "auto",
                    paddingBottom: "4px",
                  }}
                >
                  {entries.map((entry, idx) => (
                    <motion.div
                      key={entry.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ delay: idx * 0.03 }}
                      style={{
                        flex: "0 0 auto",
                        width: "156px",
                        background: "var(--v10-surface-subtle, #f8f8f8)",
                        border: "1px solid var(--v10-border, #e2e2e2)",
                        borderRadius: "8px",
                        overflow: "hidden",
                        cursor: "pointer",
                        position: "relative",
                      }}
                      onClick={() => onSelectVehicle?.({ id: entry.id })}
                    >
                      {/* Thumbnail */}
                      <div
                        style={{
                          height: "80px",
                          background: "var(--v10-surface-subtle, #f0f0f0)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                      >
                        {entry.imageUrl ? (
                          <img
                            src={entry.imageUrl}
                            alt=""
                            loading="lazy"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <CarFront
                            size={28}
                            style={{
                              color: "var(--v10-support, #999)",
                            }}
                          />
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ padding: "8px 10px" }}>
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "var(--v10-ink-strong, #111)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {entry.displayName}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--v10-support, #666)",
                            marginTop: "2px",
                          }}
                        >
                          #{entry.stockNumber}
                          {entry.exteriorColor
                            ? ` · ${entry.exteriorColor}`
                            : ""}
                        </div>
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "var(--v10-blue, #2563eb)",
                            marginTop: "4px",
                          }}
                        >
                          {entry.price != null
                            ? formatMoney(entry.price)
                            : "Call for price"}
                        </div>
                      </div>

                      {/* Remove button */}
                      <button
                        type="button"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          onRemove(entry.id);
                        }}
                        title="Remove from shortlist"
                        aria-label={`Remove ${entry.displayName} from shortlist`}
                        style={{
                          position: "absolute",
                          top: "4px",
                          right: "4px",
                          width: "22px",
                          height: "22px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "50%",
                          border: "none",
                          background: "rgb(0 0 0 / 50%)",
                          color: "#fff",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
