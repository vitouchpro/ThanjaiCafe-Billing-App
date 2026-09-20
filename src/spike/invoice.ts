/* Invoice numbering: one series per device per financial year.
   Format {device}/{fy}/{seq}, e.g. T1/2627/000123. GST expects at most 16
   characters (CA to confirm), so the formatter refuses anything longer. */

const IST = 'Asia/Kolkata';
export const MAX_INVOICE_LENGTH = 16;

interface Parts { year: number; month: number; day: number; hour: number }

function istParts(date: Date): Parts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

export function financialYear(date: Date): string {
  const { year, month } = istParts(date);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

export function formatInvoiceNo(deviceCode: string, fy: string, seq: number): string {
  if (!/^[A-Z0-9]{1,4}$/.test(deviceCode)) throw new Error(`Invalid device code: ${deviceCode}`);
  if (!/^\d{4}$/.test(fy)) throw new Error(`Invalid financial year: ${fy}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999) throw new Error(`Invoice sequence out of range: ${seq}`);
  const no = `${deviceCode}/${fy}/${String(seq).padStart(6, '0')}`;
  if (no.length > MAX_INVOICE_LENGTH) throw new Error(`Invoice number too long: ${no}`);
  return no;
}

/** Trading date in IST. Hours before `cutoverHour` belong to the previous day. */
export function businessDate(date: Date, cutoverHour = 0): string {
  const { year, month, day } = istParts(new Date(date.getTime() - cutoverHour * 3_600_000));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
