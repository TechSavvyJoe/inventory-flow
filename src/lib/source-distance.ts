/**
 * Distances that captured source prose states in kilometres, shown in US miles.
 *
 * Canadian window stickers, Ford OASIS factory-term rows and AutoCheck detail
 * text can print a term or a reading in kilometres, litres per 100 km, or km/h.
 * Staff here read miles, so the US figure leads and the source figure stays
 * beside it as evidence: "3 years / 37,282 mi (60,000 km in the source)".
 *
 * This is presentation only. The captured record keeps the source's own words
 * and units; nothing here is written back to a source, per the read-only
 * evidence rule.
 *
 * Keep in sync with extension/sidepanel/lib/source-distance.mjs; parity is tested.
 */

const MILES_PER_KILOMETRE = 0.621371;
/** Litres per 100 km to miles per US gallon. */
const MPG_PER_L_100KM = 235.214583;

const KILOMETRE_UNIT = String.raw`(?:km|kms|kilometres?|kilometers?)`;
// Metric sources group thousands with a space or a narrow no-break space as
// often as with a comma ("148 000 km"), so all three are read as one figure.
const GROUP_SEPARATOR = String.raw`[,\u0020\u00a0\u202f]`;
const NUMBER = String.raw`\d{1,3}(?:${GROUP_SEPARATOR}\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

// One scan, so the consumption and speed forms are claimed before the bare
// distance form can take the "100 km" out of "9.8 L/100 km".
const KILOMETRE_QUANTITY = new RegExp(
  [
    String.raw`(?<consumption>${NUMBER})\s*(?:L|l|litres?|liters?)\s*\/\s*100\s*${KILOMETRE_UNIT}\b`,
    String.raw`(?<speed>${NUMBER})\s*${KILOMETRE_UNIT}\s*\/\s*h(?:r|our)?\b`,
    String.raw`unlimited\s+${KILOMETRE_UNIT}\b`,
    String.raw`(?<distance>${NUMBER})\s*${KILOMETRE_UNIT}\b`,
  ].join("|"),
  "gi",
);

/** Closes the evidence qualifier, and marks text this helper has already rendered. */
const QUALIFIER_TAIL = " in the source)";

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimalNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function amount(value: string): number {
  return Number(value.replace(/[,\u0020\u00a0\u202f]/g, ""));
}

/**
 * The source text with every kilometre quantity replaced by its US equivalent
 * and one trailing qualifier naming the source figures. Text that states no
 * kilometre quantity is returned unchanged.
 */
export function sourceDistanceText(value?: string | null): string {
  if (typeof value !== "string") return "";
  // Already rendered: the qualifier restates the source figure in kilometres,
  // so a second pass would convert the evidence and nest the parenthetical.
  if (value.includes(QUALIFIER_TAIL)) return value;
  const sources: string[] = [];
  const converted = value.replace(KILOMETRE_QUANTITY, (match, ...rest) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    const remember = (source: string): void => {
      if (!sources.includes(source)) sources.push(source);
    };
    if (groups.consumption !== undefined) {
      const litres = amount(groups.consumption);
      remember(`${decimalNumber.format(litres)} L/100 km`);
      return litres > 0 ? `${wholeNumber.format(MPG_PER_L_100KM / litres)} mpg` : match;
    }
    if (groups.speed !== undefined) {
      const perHour = amount(groups.speed);
      remember(`${wholeNumber.format(perHour)} km/h`);
      return `${wholeNumber.format(perHour * MILES_PER_KILOMETRE)} mph`;
    }
    if (groups.distance === undefined) {
      remember("unlimited km");
      return "unlimited miles";
    }
    const kilometres = amount(groups.distance);
    remember(`${wholeNumber.format(kilometres)} km`);
    return `${wholeNumber.format(kilometres * MILES_PER_KILOMETRE)} mi`;
  });
  return sources.length ? `${converted} (${sources.join(", ")}${QUALIFIER_TAIL}` : converted;
}

/** True when the text states a distance, consumption, or speed in kilometres. */
export function statesKilometres(value?: string | null): boolean {
  return typeof value === "string" && new RegExp(KILOMETRE_QUANTITY.source, "i").test(value);
}
