/** Contact-pattern guard for app-owned employee notes; callers validate text shape. */
export function employeeNoteHasContactInformation(note) {
  if (/@|https?:\/\/|www\./i.test(note)) return true
  // Operational dates and prices are useful in notes. Count phone-like runs,
  // rather than adding every unrelated digit in the note.
  const operationalText = note
    .replace(/\b(?:\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])|(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-]\d{2}(?:\d{2})?)\b/g, ' ')
    .replace(/(?:\$\s*|\bUSD\s+)\d[\d,]*(?:\.\d{1,2})?/gi, ' ')
  return [...operationalText.matchAll(/\+?\d[\d().\s-]*\d/g)]
    .some(match => (match[0].match(/\d/g)?.length ?? 0) >= 7)
}
