// Calendar-date helpers. Dates in SubSweep are plain "YYYY-MM-DD" strings. "Today" is the user's LOCAL date, not
// UTC, so a renewal reminder at 11pm in a UTC+5:30 timezone is not a day early or late.

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date as YYYY-MM-DD. */
export const localDate = (d: Date = new Date()): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const utcMs = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from `from` to `to` (negative when `to` is earlier). Pure calendar arithmetic, immune to DST. */
export const dayDiff = (from: string, to: string): number => Math.round((utcMs(to) - utcMs(from)) / 86400000);

export const addDays = (iso: string, days: number): string => {
  const d = new Date(utcMs(iso) + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
