import { describe, it, expect } from 'vitest';
import { rememberPrinted, selectOrdersToAutoPrint } from '../useKotAutoPrint';
import type { CloudOrder } from '@/types/order';

const order = (id: string, status: CloudOrder['status'] = 'PAID'): CloudOrder => ({
  id, token: `A-${id}`, tableCode: 'T04', customerId: null,
  customerName: '', customerPhone: '', status,
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-10T10:00:00Z', lines: [],
});

describe('selectOrdersToAutoPrint', () => {
  it('prints nothing on the first load: what is already on the board is handled', () => {
    expect(selectOrdersToAutoPrint([order('1'), order('2')], new Set(), true)).toEqual([]);
  });

  it('prints a new paid order once', () => {
    const printed = new Set<string>();
    expect(selectOrdersToAutoPrint([order('1')], printed, false).map((o) => o.id)).toEqual(['1']);
    printed.add('1');
    expect(selectOrdersToAutoPrint([order('1')], printed, false)).toEqual([]);
  });

  it('also prints an order another till already moved to ACCEPTED', () => {
    expect(selectOrdersToAutoPrint([order('1', 'ACCEPTED')], new Set(), false).map((o) => o.id)).toEqual(['1']);
  });

  it('never prints an order that is already being prepared, ready or unpaid', () => {
    const list = [order('1', 'PREPARING'), order('2', 'READY'), order('3', 'AWAITING_PAYMENT'), order('4', 'CANCELLED')];
    expect(selectOrdersToAutoPrint(list, new Set(), false)).toEqual([]);
  });
});

describe('rememberPrinted', () => {
  it('appends new ids without duplicates', () => {
    expect(rememberPrinted(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps only the most recent entries', () => {
    expect(rememberPrinted(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd']);
  });
});
