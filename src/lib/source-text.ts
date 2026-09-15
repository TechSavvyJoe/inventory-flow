const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ndash: '–', mdash: '—', bull: '•', reg: '®', trade: '™', copy: '©',
});

/** Decode captured prose for plain-text rendering only; never parse or insert HTML.
 * Keep in sync with extension/sidepanel/lib/source-text.mjs; parity is tested.
 */
export function sourceDisplayText(value?: string | null): string {
  if (typeof value !== 'string') return '';
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp|ndash|mdash|bull|reg|trade|copy);/gi, (entity, code: string) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    if (point < 32 || (point >= 127 && point <= 159) || (point >= 0xd800 && point <= 0xdfff) || point > 0x10ffff) return entity;
    return String.fromCodePoint(point);
  });
}
