import { describe, it, expect } from 'vitest';
import { businessDate, financialYear, formatInvoiceNo } from '../invoice';

describe('financialYear (India, April to March, IST)', () => {
  it('names a September date in the year that started the previous April', () => {
    expect(financialYear(new Date('2026-09-20T10:00:00Z'))).toBe('2627');
  });
  it('is still the old year at 23:59:59 IST on 31 March', () => {
    expect(financialYear(new Date('2026-03-31T18:29:59Z'))).toBe('2526');
  });
  it('rolls over at midnight IST on 1 April', () => {
    expect(financialYear(new Date('2026-03-31T18:30:00Z'))).toBe('2627');
  });
});

describe('formatInvoiceNo', () => {
  it('formats device/fy/sequence and stays within 16 characters', () => {
    const no = formatInvoiceNo('T1', '2627', 123);
    expect(no).toBe('T1/2627/000123');
    expect(no.length).toBeLessThanOrEqual(16);
  });
  it('accepts the longest legal shape', () => {
    expect(formatInvoiceNo('ABCD', '2627', 999999)).toBe('ABCD/2627/999999');
  });
  it('rejects a bad device code, sequence or year', () => {
    expect(() => formatInvoiceNo('t1', '2627', 1)).toThrow();
    expect(() => formatInvoiceNo('ABCDE', '2627', 1)).toThrow();
    expect(() => formatInvoiceNo('T1', '2627', 0)).toThrow();
    expect(() => formatInvoiceNo('T1', '2627', 1_000_000)).toThrow();
    expect(() => formatInvoiceNo('T1', '26', 1)).toThrow();
  });
});

describe('businessDate', () => {
  it('uses the IST calendar date', () => {
    expect(businessDate(new Date('2026-09-20T10:00:00Z'))).toBe('2026-09-20');
  });
  it('puts a 02:30 IST bill on the next calendar day with no cut-over', () => {
    expect(businessDate(new Date('2026-09-20T21:00:00Z'))).toBe('2026-09-21');
  });
  it('keeps a 02:30 IST bill on the previous trading day with a 4-hour cut-over', () => {
    expect(businessDate(new Date('2026-09-20T21:00:00Z'), 4)).toBe('2026-09-20');
  });
});
