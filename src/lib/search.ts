// The shared search matcher: normalization, per-field term scoring and the
// field-list check every page search uses. Inventory's ranked index
// (src/features/inventory/inventory-search.ts) builds on the same pieces, so a
// stock number, "F150" for "F-150", "$51,800" or a slightly misspelled trim
// match the same way everywhere. User input is never treated as a pattern.

const JOINER_PUNCTUATION = /([a-z0-9])[-‐‑‒–—/_.',](?=[a-z0-9])/gi;
const DIACRITICS = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;

export interface SearchField {
  label: string;
  literal: string;
  folded: string;
  tokens: string[];
  priority: number;
  identifier: boolean;
  displaySafe: boolean;
}

export interface SearchFieldInput {
  label: string;
  value: unknown;
  priority?: number;
  identifier?: boolean;
  displaySafe?: boolean;
}

export interface SearchTerm {
  raw: string;
  folded: string;
  literalOnly: boolean;
}

export function literalSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLocaleLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Creates a forgiving comparison form without ever interpreting user input as
 * a regular expression or wildcard. Punctuation joining letters/numbers is
 * folded so F-150/F150 and 42,810/42810 behave the same.
 */
export function foldSearchText(value: unknown): string {
  let folded = literalSearchText(value).replace(/[$£€]/g, "");
  // A second pass handles adjacent punctuation sequences predictably.
  for (let pass = 0; pass < 2; pass += 1) folded = folded.replace(JOINER_PUNCTUATION, "$1");
  return folded.replace(NON_ALPHANUMERIC, " ").trim();
}

function fieldTokens(folded: string): string[] {
  return [...new Set(folded.split(" ").filter(Boolean))];
}

export function addSearchField(target: SearchField[], input: SearchFieldInput): void {
  if (input.value === null || input.value === undefined) return;
  const raw = String(input.value).trim();
  if (!raw) return;
  const literal = literalSearchText(raw);
  const folded = foldSearchText(raw);
  if (!literal && !folded) return;
  target.push({
    label: input.label,
    literal,
    folded,
    tokens: fieldTokens(folded),
    priority: input.priority ?? 0,
    identifier: input.identifier ?? false,
    displaySafe: input.displaySafe ?? true,
  });
}

export function parseSearchTerms(query: string): SearchTerm[] {
  return literalSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const folded = foldSearchText(raw);
      return { raw, folded, literalOnly: folded.length === 0 };
    });
}

function editDistance(left: string, right: string, maximum: number): number {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

function fuzzyThreshold(term: string): number {
  if (term.length < 4 || /\d/.test(term) || !/[a-z]/.test(term)) return 0;
  return term.length >= 7 ? 2 : 1;
}

export function scoreSearchTerm(field: SearchField, term: SearchTerm): number {
  if (term.literalOnly) {
    return field.literal.includes(term.raw) ? 98 + field.priority : -1;
  }

  if (field.literal === term.raw) return 176 + field.priority;
  if (field.folded === term.folded) return 168 + field.priority;
  if (field.identifier && field.folded.startsWith(term.folded)) return 158 + field.priority;
  if (field.identifier && field.folded.includes(term.folded)) return 148 + field.priority;
  if (field.tokens.includes(term.folded)) return 138 + field.priority;
  if (field.folded.startsWith(term.folded)) return 126 + field.priority;
  if (field.folded.includes(term.folded)) return 104 + field.priority;
  if (field.literal.includes(term.raw)) return 96 + field.priority;

  const threshold = fuzzyThreshold(term.folded);
  if (threshold === 0) return -1;
  let bestDistance = threshold + 1;
  for (const token of field.tokens) {
    if (Math.abs(token.length - term.folded.length) > threshold) continue;
    bestDistance = Math.min(bestDistance, editDistance(token, term.folded, threshold));
    if (bestDistance === 1) break;
  }
  return bestDistance <= threshold ? 70 - bestDistance * 12 + field.priority : -1;
}

/**
 * Applies the inventory search engine's token, punctuation, and typo matching
 * to an explicit set of fields from another authorized view.
 */
export function searchFieldsMatch(query: string, values: readonly unknown[]): boolean {
  if (!query.trim()) return true;
  const fields: SearchField[] = [];
  for (const value of values) addSearchField(fields, { label: "Search", value });
  return parseSearchTerms(query).every((term) => fields.some((field) => scoreSearchTerm(field, term) >= 0));
}
