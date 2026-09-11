import type { ISODate, ISODateTime } from '@/types';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/** Local-date key. Never use toISOString() here — it shifts to UTC and
    silently files a 1 AM IST bill under the previous day. */
export function dateKey(d: Date | string = new Date()): ISODate {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const now = (): ISODateTime => new Date().toISOString();

export function parseKey(key: ISODate): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/** Week starting Monday (Indian retail convention). */
export function startOfWeek(d: Date): Date {
  const c = startOfDay(d);
  const day = c.getDay();
  return addDays(c, day === 0 ? -6 : 1 - day);
}

export const endOfWeek = (d: Date): Date => endOfDay(addDays(startOfWeek(d), 6));
export const startOfMonth = (d: Date): Date => startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
export const endOfMonth = (d: Date): Date => endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));

export const formatDate = (d: Date | string): string => {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
};

export const formatDateShort = (d: Date | string): string => {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]}`;
};

export const formatDayName = (d: Date | string): string => {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return DAYS[dt.getDay()];
};

export const formatDayShort = (d: Date | string): string => {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return DAYS_SHORT[dt.getDay()];
};

export const formatMonthYear = (d: Date): string => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export function formatTime(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  let h = dt.getHours();
  const m = String(dt.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function formatHour(h: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh} ${ampm}`;
}

/** "2 min ago" / "8:42 PM" */
export function relativeTime(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - dt.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 6) return `${hrs} hr ago`;
  return formatTime(dt);
}

export const isSameDay = (a: Date | string, b: Date | string): boolean => dateKey(a) === dateKey(b);

export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let c = startOfDay(from);
  const end = startOfDay(to);
  while (c <= end) {
    out.push(new Date(c));
    c = addDays(c, 1);
  }
  return out;
}
