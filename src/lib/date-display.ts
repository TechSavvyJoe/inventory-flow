const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Calendar dates are source facts, not UTC instants. Never shift their day. */
function calendarDate(value: string): Date | null | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  const oasis = /^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{4})$/.exec(value);
  const written = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  if (!iso && !us && !oasis && !written) return undefined;
  const year = Number(iso?.[1] ?? us?.[3] ?? oasis?.[3] ?? written?.[3]);
  const monthToken = (oasis?.[2] ?? written?.[1] ?? '').toLowerCase();
  const month = iso ? Number(iso[2]) : us ? Number(us[1]) : months.findIndex(name => name === monthToken || name.slice(0, 3) === monthToken || name === 'september' && monthToken === 'sept') + 1;
  const day = Number(iso?.[3] ?? us?.[2] ?? oasis?.[1] ?? written?.[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/** One numeric display policy; transport/storage and native input values stay ISO. */
export function displayDate(value: string, options: { time?: boolean; timeZone?: string } = {}): string {
  const calendar = calendarDate(value.trim());
  if (calendar === null) return value;
  const timestampDay = /^(\d{4}-\d{2}-\d{2})T/i.exec(value.trim());
  if (timestampDay && calendarDate(timestampDay[1]) === null) return value;
  const date = calendar ?? new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    ...(calendar ? { timeZone: 'UTC' } : options.timeZone ? { timeZone: options.timeZone } : {}),
    ...(!calendar && options.time ? { hour: 'numeric', minute: '2-digit' } as const : {}),
  }).format(date);
}
