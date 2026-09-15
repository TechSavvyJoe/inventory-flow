import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { Clock3, CornerDownLeft, Search, Sparkles, X } from "lucide-react";
import {
  buildInventorySearchIndex,
  rankInventorySearch,
  type InventorySearchMatch,
} from "./inventory-search";
import { formatMileage, formatMoney, vehicleDisplayName } from "./inventory-utils";
import type { InventoryVehicle } from "./types";

const RECENT_SEARCH_LIMIT = 7;

interface InventoryPredictiveSearchProps {
  vehicles: InventoryVehicle[];
  value: string;
  onChange: (value: string) => void;
  onSelectVehicle: (vehicle: InventoryVehicle) => void;
  id: string;
  persistenceKey: string;
  placeholder?: string;
}

function readRecentSearches(key: string): string[] {
  try {
    const stored = window.sessionStorage.getItem(key);
    const value: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [];
  } catch {
    return [];
  }
}

function writeRecentSearches(key: string, searches: string[]): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(searches));
  } catch {
    // Search still works when private browsing or policy disables storage.
  }
}

function resultIdentity(match: InventorySearchMatch): string {
  const vehicle = match.vehicle;
  const vinTail = vehicle.vin.slice(-8);
  return `${vehicle.stockNumber} · VIN …${vinTail}`;
}

export function InventoryPredictiveSearch({
  vehicles,
  value,
  onChange,
  onSelectVehicle,
  id,
  persistenceKey,
  placeholder = "Search stock, VIN, vehicle, feature, salesperson, or hold…",
}: InventoryPredictiveSearchProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const hintId = useId();
  const [popupOpen, setPopupOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const index = useMemo(() => buildInventorySearchIndex(vehicles), [vehicles]);
  const matches = useMemo(() => rankInventorySearch(index, value, 8), [index, value]);

  useEffect(() => {
    const validRecents = readRecentSearches(persistenceKey)
      .filter((recent) => rankInventorySearch(index, recent, 1).length > 0)
      .slice(0, RECENT_SEARCH_LIMIT);
    setRecentSearches(validRecents);
  }, [index, persistenceKey]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [value]);

  useEffect(() => {
    const query = value.trim().toLocaleLowerCase();
    if (!query || matches.length !== 1) return;

    const exactVehicleIdentifier = [matches[0].vehicle.vin, matches[0].vehicle.stockNumber]
      .some((identifier) => identifier.toLocaleLowerCase() === query);

    // Once a manager has entered an exact stock or VIN, the filtered row is
    // the clearest next target. Leaving a popover over that row on a phone
    // made its normal “Open details” action impossible to reach.
    if (exactVehicleIdentifier) {
      setPopupOpen(false);
      setActiveIndex(-1);
    }
  }, [matches, value]);

  const hasQuery = Boolean(value.trim());
  const optionsLength = hasQuery ? matches.length : recentSearches.length;
  const expanded = popupOpen && (hasQuery || recentSearches.length > 0);
  const activeOptionId =
    expanded && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  const remember = (query: string) => {
    const clean = query.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!clean || rankInventorySearch(index, clean, 1).length === 0) return;
    setRecentSearches((current) => {
      const next = [clean, ...current.filter((item) => item.toLocaleLowerCase() !== clean.toLocaleLowerCase())]
        .slice(0, RECENT_SEARCH_LIMIT);
      writeRecentSearches(persistenceKey, next);
      return next;
    });
  };

  const selectMatch = (match: InventorySearchMatch) => {
    remember(value);
    setPopupOpen(false);
    setActiveIndex(-1);
    onSelectVehicle(match.vehicle);
  };

  const selectRecent = (recent: string) => {
    onChange(recent);
    setPopupOpen(true);
    setActiveIndex(-1);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setPopupOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (optionsLength === 0) return;
      event.preventDefault();
      setPopupOpen(true);
      setActiveIndex((current) => {
        if (event.key === "ArrowDown") return current >= optionsLength - 1 ? 0 : current + 1;
        return current <= 0 ? optionsLength - 1 : current - 1;
      });
      return;
    }
    if (event.key === "Enter") {
      if (activeIndex >= 0) {
        event.preventDefault();
        if (hasQuery) {
          const match = matches[activeIndex];
          if (match) selectMatch(match);
        } else {
          const recent = recentSearches[activeIndex];
          if (recent) selectRecent(recent);
        }
      } else if (hasQuery) {
        remember(value);
        setPopupOpen(false);
      }
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
      setPopupOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="inventory-predictive-search" ref={rootRef} onBlur={handleBlur}>
      <div className="inventory-primary-search">
        <Search size={19} strokeWidth={1.75} aria-hidden="true" />
        <label className="inventory-sr-only" htmlFor={id}>Search inventory</label>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-describedby={hintId}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setPopupOpen(true);
          }}
          onFocus={() => setPopupOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setPopupOpen(true);
              inputRef.current?.focus();
            }}
            aria-label="Clear inventory search"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <span className="inventory-sr-only" id={hintId}>
        Search supports partial stock and VIN, multiple terms, punctuation variants, and common spelling mistakes. Use the arrow keys to review suggestions, Enter to choose, and Escape to close.
      </span>

      {expanded ? (
        <div className="inventory-search-popover">
          <div className="inventory-search-popover__heading">
            <span>
              {hasQuery ? (
                <><Sparkles size={14} aria-hidden="true" /> Best matches</>
              ) : (
                <><Clock3 size={14} aria-hidden="true" /> Recent searches</>
              )}
            </span>
            {hasQuery ? <small aria-live="polite">{matches.length} suggested</small> : null}
          </div>
          <ul id={listboxId} role="listbox" aria-label={hasQuery ? "Inventory suggestions" : "Recent inventory searches"}>
            {hasQuery ? matches.map((match, optionIndex) => {
              const vehicle = match.vehicle;
              const labels = match.matchedLabels.length
                ? match.matchedLabels.join(" · ")
                : "Vehicle details match";
              return (
                <li
                  id={`${listboxId}-option-${optionIndex}`}
                  key={vehicle.id}
                  role="option"
                  aria-selected={optionIndex === activeIndex}
                  className={optionIndex === activeIndex ? "is-active" : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(optionIndex)}
                  onClick={() => selectMatch(match)}
                >
                  <span className="inventory-search-result__vehicle">
                    <strong>{vehicleDisplayName(vehicle)}</strong>
                    <small>{resultIdentity(match)} · {vehicle.location.homeStore.name}</small>
                  </span>
                  <span className="inventory-search-result__numbers">
                    <strong>{formatMoney(vehicle.price)}</strong>
                    <small>{formatMileage(vehicle.mileage)}</small>
                  </span>
                  <span className="inventory-search-result__why">{labels}</span>
                  <CornerDownLeft size={15} aria-hidden="true" />
                </li>
              );
            }) : recentSearches.map((recent, optionIndex) => (
              <li
                id={`${listboxId}-option-${optionIndex}`}
                key={recent}
                role="option"
                className={`inventory-search-recent${optionIndex === activeIndex ? " is-active" : ""}`}
                aria-selected={optionIndex === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(optionIndex)}
                onClick={() => selectRecent(recent)}
              >
                <Clock3 size={15} aria-hidden="true" />
                <span className="inventory-search-recent-label">{recent}</span>
                <CornerDownLeft size={15} aria-hidden="true" />
              </li>
            ))}
          </ul>
          {hasQuery && matches.length === 0 ? (
            <p className="inventory-search-popover__empty">
              No inventory match. Try fewer words, a partial VIN, or a nearby spelling.
            </p>
          ) : null}
          {hasQuery && matches.length > 0 ? (
            <p className="inventory-search-popover__footer">
              Every word must match. Results include the vehicle, hold, location, and transfer details available to your role.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
