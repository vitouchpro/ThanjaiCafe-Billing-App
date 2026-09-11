import { describe, it, expect } from 'vitest';
import {
  dateKey, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  addDays, eachDay, formatHour, isSameDay, formatTime,
} from '../date';
import { formatMoney, formatMoneyShort, pctChange, money } from '../money';

describe('dateKey', () => {
  it('uses local time, not UTC', () => {
    // A bill rung up just after midnight IST must file under that day.
    // toISOString() would roll it back to the previous date.
    const justAfterMidnight = new Date(2026, 7, 26, 0, 30);
    expect(dateKey(justAfterMidnight)).toBe('2026-08-26');

    const lateEvening = new Date(2026, 7, 26, 23, 45);
    expect(dateKey(lateEvening)).toBe('2026-08-26');
  });

  it('pads single-digit months and days', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('week boundaries', () => {
  it('starts the week on Monday', () => {
    // 26 Aug 2026 is a Wednesday.
    const wed = new Date(2026, 7, 26);
    expect(dateKey(startOfWeek(wed))).toBe('2026-08-24'); // Monday
    expect(dateKey(endOfWeek(wed))).toBe('2026-08-30');   // Sunday
  });

  it('treats Sunday as the end of the week it closes, not the start of a new one', () => {
    const sunday = new Date(2026, 7, 30);
    expect(sunday.getDay()).toBe(0);
    expect(dateKey(startOfWeek(sunday))).toBe('2026-08-24');
  });
});

describe('month boundaries', () => {
  it('spans the whole month', () => {
    const d = new Date(2026, 7, 15);
    expect(dateKey(startOfMonth(d))).toBe('2026-08-01');
    expect(dateKey(endOfMonth(d))).toBe('2026-08-31');
  });

  it('handles February in a leap year', () => {
    expect(dateKey(endOfMonth(new Date(2028, 1, 10)))).toBe('2028-02-29');
  });
});

describe('addDays and eachDay', () => {
  it('crosses month boundaries', () => {
    expect(dateKey(addDays(new Date(2026, 7, 31), 1))).toBe('2026-09-01');
    expect(dateKey(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31');
  });

  it('enumerates an inclusive range', () => {
    const days = eachDay(new Date(2026, 7, 24), new Date(2026, 7, 30));
    expect(days).toHaveLength(7);
    expect(dateKey(days[0])).toBe('2026-08-24');
    expect(dateKey(days[6])).toBe('2026-08-30');
  });

  it('returns a single day when the range is one day', () => {
    expect(eachDay(new Date(2026, 7, 26), new Date(2026, 7, 26))).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('formats hours in 12-hour clock with noon and midnight correct', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(17)).toBe('5 PM');
  });

  it('formats times without a 0 hour', () => {
    expect(formatTime(new Date(2026, 7, 26, 0, 5))).toBe('12:05 AM');
    expect(formatTime(new Date(2026, 7, 26, 20, 42))).toBe('8:42 PM');
  });

  it('compares days ignoring the clock', () => {
    expect(isSameDay(new Date(2026, 7, 26, 1), new Date(2026, 7, 26, 23))).toBe(true);
    expect(isSameDay(new Date(2026, 7, 26), new Date(2026, 7, 27))).toBe(false);
  });
});

describe('money formatting', () => {
  it('drops decimals for whole rupees but keeps paise when present', () => {
    expect(formatMoney(25)).toBe('₹25');
    expect(formatMoney(25.5)).toBe('₹25.50');
    expect(formatMoney(1234.05)).toBe('₹1,234.05');
  });

  it('uses the Indian digit grouping', () => {
    expect(formatMoney(248500)).toBe('₹2,48,500');
  });

  it('handles negatives and zero', () => {
    expect(formatMoney(-10)).toBe('-₹10');
    expect(formatMoney(0)).toBe('₹0');
  });

  it('abbreviates large amounts for KPI tiles', () => {
    expect(formatMoneyShort(8450)).toBe('₹8,450');
    expect(formatMoneyShort(248500)).toBe('₹2.5L');
    expect(formatMoneyShort(15000000)).toBe('₹1.5Cr');
    // A round figure should not carry a pointless ".0".
    expect(formatMoneyShort(200000)).toBe('₹2L');
    expect(formatMoneyShort(-99)).toBe('-₹99');
  });
});

describe('pctChange', () => {
  it('computes ordinary changes', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(90, 100)).toBeCloseTo(-10);
  });

  it('returns null when there is no baseline to compare against', () => {
    // Showing "+∞%" or "+100%" against a day with no sales would be a lie.
    expect(pctChange(500, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
  });
});

describe('money rounding', () => {
  it('removes float representation error', () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(1.005)).toBe(1.01);
    expect(money(19.999)).toBe(20);
  });
});
