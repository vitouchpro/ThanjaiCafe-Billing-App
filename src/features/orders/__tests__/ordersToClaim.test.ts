import { describe, it, expect } from 'vitest';
import { ordersToClaim } from '../useOrderIntake';
import type { CloudOrder } from '@/types/order';

const order = (id: string, status: CloudOrder['status']): CloudOrder => ({
  id, token: `A-${id}`, tableCode: 'T04', customerId: null,
  customerName: '', customerPhone: '', status,
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-10T10:00:00Z', lines: [],
});

describe('ordersToClaim', () => {
  const list = [order('1', 'PAID'), order('2', 'ACCEPTED'), order('3', 'PREPARING'), order('4', 'AWAITING_PAYMENT')];

  it('claims only PAID orders when this device is a till', () => {
    expect(ordersToClaim(list, true).map((o) => o.id)).toEqual(['1']);
  });

  it('claims nothing when this device does not bill, so a kitchen tablet never writes a bill', () => {
    expect(ordersToClaim(list, false)).toEqual([]);
  });

  it('never claims an unpaid order', () => {
    expect(ordersToClaim([order('9', 'AWAITING_PAYMENT'), order('8', 'PAYMENT_FAILED')], true)).toEqual([]);
  });
});
