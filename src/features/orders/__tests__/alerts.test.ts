import { describe, it, expect } from 'vitest';
import { newlyArrived } from '../useOrderAlerts';
import type { CloudOrder } from '@/types/order';

const order = (id: string, status: CloudOrder['status'] = 'PAID'): CloudOrder => ({
  id, token: `A-${id}`, tableCode: 'T04', customerId: 'u1',
  customerName: 'Priya', customerPhone: '9876543210', status,
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-10T10:00:00Z', lines: [],
});

describe('newlyArrived', () => {
  it('reports an order that was not there before', () => {
    expect(newlyArrived([], [order('o1')]).map((o) => o.id)).toEqual(['o1']);
  });

  it('stays silent when nothing changed', () => {
    const same = [order('o1')];
    expect(newlyArrived(same, same)).toEqual([]);
  });

  it('does not re-announce an order that only changed status', () => {
    expect(newlyArrived([order('o1', 'PAID')], [order('o1', 'PREPARING')])).toEqual([]);
  });

  it('announces only the new one when others are already known', () => {
    const before = [order('o1')];
    const after = [order('o1'), order('o2')];
    expect(newlyArrived(before, after).map((o) => o.id)).toEqual(['o2']);
  });

  it('never announces an unpaid order', () => {
    expect(newlyArrived([], [order('o1', 'AWAITING_PAYMENT')])).toEqual([]);
    expect(newlyArrived([], [order('o1', 'PAYMENT_FAILED')])).toEqual([]);
  });

  it('says nothing on the very first load', () => {
    // A till opening in the morning must not chime once per order left on the
    // board from last night. `previous === null` means "we had not looked yet".
    expect(newlyArrived(null, [order('o1'), order('o2')])).toEqual([]);
  });
});
