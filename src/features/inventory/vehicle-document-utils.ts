const OFFICIAL_BOB_MAXEY_HOSTS = new Set([
  "www.bobmaxeyfordhowell.com",
  "www.bobmaxeyfordinfowlerville.com",
  "www.bobmaxeyford.com",
  "www.bobmaxeylincoln.com",
]);

const WINDOW_STICKER_PATH = /^\/api\/vhcliaa\/inventory\/[0-9]{1,8}\/window-sticker$/i;
const VAUTO_FACTORY_EQUIPMENT_HOST = "assets.cai-media-management.com";
const VAUTO_FACTORY_EQUIPMENT_PATH =
  /^\/window-stickers\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|pdf)$/i;

export const DEALERMAIL_INVENTORY_SEARCH_BASE_URL =
  "https://www.dealermail.com/prospect_manager/V2_inventory_search_CRM_USED_NEW.asp";
export const DEALERMAIL_INTERACTIVE_INVENTORY_URL =
  `${DEALERMAIL_INVENTORY_SEARCH_BASE_URL}?selectedStore=26,25,27,95`;

const FORD_INVOICE_BASE_URL =
  "https://fordvisions.dealerconnection.com/vinv/GetInvoice.aspx";
const FORD_OASIS_BASE_URL =
  "https://www.fordtechservice.dealerconnection.com/oasis/Index";
const FORD_SERVICE_HISTORY_BASE_URL =
  "https://www.fordtechservice.dealerconnection.com/VehicleService/Index";

export type VehicleDocumentKind = "autocheck" | "window-sticker";
export type AutoCheckResultTone = "clear" | "review" | "unknown";

export function dealerMailInteractiveVehicleUrl(
  stockNumber: string | null | undefined,
): string | null {
  // Both DealerMail's hold-edit endpoint and its `?byItem=` response are HTML
  // fragments that depend on the surrounding inventory screen for scripts,
  // dialogs, and permissions. Opening either fragment as a top-level page makes
  // its Hold, Comments, Alert, CDK, and other buttons inert. Open the complete
  // four-store inventory screen instead. The click handler copies this sanitized
  // stock so the user can paste it into DealerMail's own LAST8 / STOCK search.
  const stock = stockNumber?.trim().replace(/\W/g, "");
  return stock ? DEALERMAIL_INTERACTIVE_INVENTORY_URL : null;
}

function normalizedVin(value: string | null | undefined): string | null {
  const vin = value?.trim().toUpperCase();
  return vin && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

/**
 * Mirrors DealerMail's working Ford/Lincoln INVOICE destination. The target is
 * read-only, but DealerConnection can require its own authorized sign-in.
 */
export function fordInvoiceUrl(vinValue: string | null | undefined): string | null {
  const vin = normalizedVin(vinValue);
  if (!vin) return null;
  const url = new URL(FORD_INVOICE_BASE_URL);
  url.searchParams.set("v", vin);
  url.searchParams.set("n", ",");
  url.searchParams.set("pa", "00000");
  url.searchParams.set("p", "");
  url.searchParams.set("ct", "USA");
  return url.href;
}

/** Same-origin private copy captured by the daily exact-VIN invoice pull. */
export function savedFordInvoiceUrl(vinValue: string | null | undefined): string | null {
  const vin = normalizedVin(vinValue);
  return vin ? `/api/vehicles/${encodeURIComponent(vin)}/invoice` : null;
}

/** Same-origin private, printable copy of the VIN-linked vAuto equipment label. */
export function savedVautoEquipmentPdfUrl(vinValue: string | null | undefined): string | null {
  const vin = normalizedVin(vinValue);
  return vin ? `/api/vehicles/${encodeURIComponent(vin)}/equipment-pdf` : null;
}

/**
 * Mirrors DealerMail's working OASIS destination for an exact Ford/Lincoln VIN.
 * The target is read-only, but DealerConnection can require its own sign-in.
 */
export function fordOasisUrl(vinValue: string | null | undefined): string | null {
  const vin = normalizedVin(vinValue);
  if (!vin) return null;
  const url = new URL(FORD_OASIS_BASE_URL);
  url.searchParams.set("vin", vin);
  return url.href;
}

/** Opens the read-only Ford PTS Retail Service Repair History for an exact VIN. */
export function fordServiceHistoryUrl(vinValue: string | null | undefined): string | null {
  const vin = normalizedVin(vinValue);
  if (!vin) return null;
  const url = new URL(FORD_SERVICE_HISTORY_BASE_URL);
  url.searchParams.set("VIN", vin);
  return url.href;
}

/**
 * Accepts only the read-only CAI PDF or image produced by vAuto's Factory Equipment
 * view. This is an informational equipment label, not an original Monroney
 * window sticker.
 */
export function vautoFactoryEquipmentUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const decodedSegments = decodeURIComponent(parsed.pathname).split("/");
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.toLowerCase() !== VAUTO_FACTORY_EQUIPMENT_HOST ||
      !VAUTO_FACTORY_EQUIPMENT_PATH.test(parsed.pathname) ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      decodedSegments.includes("..")
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

const CLEAR_AUTOCHECK_STATUSES = new Set([
  "clean",
  "clean title",
  "pass",
  "passed",
  "no issue",
  "no issues",
  "no issue reported",
  "no issues reported",
  "no accident",
  "no accidents",
  "no accident reported",
  "no accidents reported",
  "no open recalls",
]);

const CLEAR_AUTOCHECK_PATTERNS = [
  /^no (?:accidents?|damage|accidents? or damage) (?:reported|found|indicated)$/,
  /^no (?:open )?recalls?(?: (?:reported|found|indicated))?$/,
  /^no (?:title brands?|odometer problems?|structural damage|frame damage) (?:reported|found|indicated)$/,
] as const;

function normalizeAutoCheckStatus(status: string | null | undefined): string {
  return status
    ?.trim()
    .toLowerCase()
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ") ?? "";
}

export function autoCheckResultTone(status: string | null | undefined): AutoCheckResultTone {
  const normalized = normalizeAutoCheckStatus(status);
  if (!normalized || normalized === "not reported" || normalized === "not available") {
    return "unknown";
  }
  return CLEAR_AUTOCHECK_STATUSES.has(normalized) ||
    CLEAR_AUTOCHECK_PATTERNS.some((pattern) => pattern.test(normalized))
    ? "clear"
    : "review";
}

function hasExactlyOneNonEmptyValue(url: URL, key: string): boolean {
  const values = url.searchParams.getAll(key);
  return values.length === 1 && Boolean(values[0]?.trim());
}

export function officialVehicleDocumentUrl(
  value: string | null | undefined,
  kind: VehicleDocumentKind,
  listingUrl?: string | null,
): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const decodedSegments = decodeURIComponent(parsed.pathname).split("/");
    if (
      parsed.protocol !== "https:" ||
      !OFFICIAL_BOB_MAXEY_HOSTS.has(host) ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      decodedSegments.includes("..")
    ) {
      return null;
    }
    if (listingUrl) {
      const listing = new URL(listingUrl);
      if (listing.protocol !== "https:" || listing.hostname.toLowerCase() !== host) return null;
    }

    const keys = [...parsed.searchParams.keys()];
    if (kind === "autocheck") {
      if (
        parsed.pathname.toLowerCase() !== "/autocheck.aspx" ||
        keys.length !== 2 ||
        !hasExactlyOneNonEmptyValue(parsed, "sv") ||
        !hasExactlyOneNonEmptyValue(parsed, "ac")
      ) {
        return null;
      }
      if (keys.some((key) => key !== "sv" && key !== "ac")) return null;
    } else {
      const allowed = new Set(["sv", "make", "vehicleType", "dealerCode"]);
      if (
        !WINDOW_STICKER_PATH.test(parsed.pathname) ||
        keys.some((key) => !allowed.has(key)) ||
        keys.length < 3 ||
        keys.length > 4 ||
        !hasExactlyOneNonEmptyValue(parsed, "sv") ||
        !hasExactlyOneNonEmptyValue(parsed, "make") ||
        !hasExactlyOneNonEmptyValue(parsed, "vehicleType") ||
        parsed.searchParams.getAll("dealerCode").length > 1
      ) {
        return null;
      }
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/** A valid endpoint is not a usable sticker when Ford returned a placeholder. */
export function availableWindowStickerUrl(
  sticker: { url?: string | null; dataState?: string | null } | null | undefined,
  listingUrl?: string | null,
): string | null {
  if (sticker && ["incomplete", "unavailable", "unknown"].includes(sticker.dataState ?? "")) return null;
  return officialVehicleDocumentUrl(sticker?.url, "window-sticker", listingUrl);
}
