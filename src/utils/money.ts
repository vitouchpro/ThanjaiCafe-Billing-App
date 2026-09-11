/* Money helpers.
   Rupee amounts are held as floats in the model but every computation
   routes through paise integers, so 0.1 + 0.2 style drift never reaches a bill. */

export const toPaise = (rupees: number): number => Math.round((rupees || 0) * 100);
export const toRupees = (paise: number): number => paise / 100;

/** Round to 2dp without float tail. */
export const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Whole rupees print without decimals — a menu of ₹25.00 items is noisier
    than one of ₹25 items. Paise show only when there are paise. */
export function formatMoney(n: number, currency = '₹'): string {
  const v = Math.abs(money(n));
  const sign = n < 0 ? '-' : '';
  const hasPaise = Math.round(v * 100) % 100 !== 0;
  return `${sign}${currency}${v.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Always two decimals — for invoices and reports where columns must align. */
export function formatMoneyExact(n: number, currency = '₹'): string {
  const v = Math.abs(money(n));
  const sign = n < 0 ? '-' : '';
  return `${sign}${currency}${v.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact form for KPI tiles and chart axes: ₹8,450 / ₹2.5L / ₹1.5Cr.
    One decimal throughout — these are read at a glance, not reconciled. */
export function formatMoneyShort(n: number, currency = '₹'): string {
  const v = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const trim = (x: number) => String(Number(x.toFixed(1)));
  if (v >= 1_00_00_000) return `${sign}${currency}${trim(v / 1_00_00_000)}Cr`;
  if (v >= 1_00_000) return `${sign}${currency}${trim(v / 1_00_000)}L`;
  return `${sign}${currency}${Math.round(v).toLocaleString('en-IN')}`;
}

export const formatNumber = (n: number): string => n.toLocaleString('en-IN');

export function formatPercent(n: number, digits = 1): string {
  if (!isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** Percent change guarding the divide-by-zero case (no sales yesterday). */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Nearest-rupee rounding for cash tendering. */
export const roundToRupee = (n: number): number => Math.round(n);
