/** Public AutoCheck facts only, with no inference of condition or availability. */
export function customerHistorySummary(history) {
  if (!history || !['current', 'stale'].includes(history.dataState)) return null;
  const checks = history.checks ?? [];
  const clean = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const values = check => {
    const seen = new Set();
    return [clean(check.status), clean(check.detail)].filter(value => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const reading = check => values(check).join(' · ') || null;
  const titleCheck = checks.find(item => /(?:^|\b)(?:state )?title\b/i.test(item.label ?? ''));
  const accidentCheck = checks.find(item => /accident|damage/i.test(item.label ?? ''));
  const title = titleCheck ? reading(titleCheck) : null;
  const accident = accidentCheck ? reading(accidentCheck) : null;

  const shownChecks = new Set([titleCheck, accidentCheck].filter(Boolean));
  const normalized = value => value.trim().toLowerCase().replace(/[.,;:]+$/g, '').replace(/\s+/g, ' ');
  const clearReading = value => /^(?:clear|normal|passed|not reported|not available|none reported|nothing reported|no issues?(?: found| reported)?|no problems?(?: found| reported)?|(?:no|zero|0)\b.*\b(?:reported|found|indicated|detected|recorded|present)|(?:no|zero|0)\s+(?:issues?|problems?|records?|events?|claims?|loss(?:es)?|total loss(?:es)?|accidents?|damage|discrepanc(?:y|ies)|rollbacks?))$/.test(normalized(value));
  const materialLabel = label => /\b(?:insurance(?:[- ]loss| claim)|total loss|odometer (?:discrepancy|rollback)|mileage (?:discrepancy|rollback)|auction|adverse history|structural|frame damage|salvage|rebuilt|flood|lemon|buyback|theft|stolen)\b/i.test(label);
  const adverseReading = value => /\b(?:total loss|insurance[- ]loss|insurance claim|odometer (?:discrepancy|rollback)|mileage (?:discrepancy|rollback)|rollback|not actual(?: mileage)?|auction(?: record| event)?|salvage|rebuilt|flood|lemon|buyback|structural|frame damage|theft|stolen|adverse|warning|alert|problem|issue|damage|accident|branded? title)\b/i.test(value);
  const reportedReading = value => /(?:\b[1-9]\d*\s+(?:records?|events?|incidents?|claims?)\b|\b(?:reported|found|detected|recorded|announced)\b)/i.test(value)
    || /^(?:yes|present|positive|failed|review(?: required)?)$/.test(normalized(value));
  const adverseChecks = checks.filter(check => {
    if (shownChecks.has(check)) return false;
    const label = clean(check.label);
    const readings = values(check);
    if (!label || !readings.length) return false;
    return readings.some(value => !clearReading(value) && adverseReading(value))
      || materialLabel(label) && readings.some(value => !clearReading(value) && reportedReading(value));
  });
  return [
    Number.isFinite(history.score) ? `AutoCheck score ${history.score}` : null,
    Number.isFinite(history.ownerCount) ? `${history.ownerCount} owner${history.ownerCount === 1 ? '' : 's'} reported` : null,
    title ? `Title: ${title}` : null,
    accident ? `Accident / damage: ${accident}` : null,
    ...adverseChecks.map(check => `${clean(check.label)}: ${reading(check)}`),
  ].filter(Boolean).join(' · ') || null;
}
