import { describe, it, expect } from 'vitest';
import { kotHtml } from '../kot';
import type { CloudOrder } from '@/types/order';

const order = (over: Partial<CloudOrder> = {}): CloudOrder => ({
  id: 'o1', token: 'A-07', tableCode: 'T04', customerId: 'u1',
  customerName: 'Priya', customerPhone: '9876543210', status: 'PAID',
  subtotal: 95, tax: 4.75, total: 99.75,
  createdAt: '2026-09-08T10:00:00Z', paidAt: '2026-09-08T10:01:00Z',
  lines: [
    { id: 'l1', orderId: 'o1', productId: 'p1', name: 'Filter Coffee', unitPrice: 25, qty: 2, taxRate: 5 },
    { id: 'l2', orderId: 'o1', productId: 'p2', name: 'Vadai', unitPrice: 15, qty: 3, taxRate: 5, note: 'no chutney' },
  ],
  ...over,
});

describe('kotHtml', () => {
  it('shows the customer name and contact number', () => {
    const html = kotHtml(order(), 'THANJAI CAFE');
    expect(html).toContain('Priya');
    expect(html).toContain('9876543210');
  });

  it('leads with the token and the table', () => {
    const html = kotHtml(order(), 'THANJAI CAFE');
    expect(html).toContain('A-07');
    expect(html).toContain('T04');
  });

  it('lists every item with its quantity', () => {
    const html = kotHtml(order(), 'THANJAI CAFE');
    expect(html).toContain('Filter Coffee');
    expect(html).toContain('2');
    expect(html).toContain('Vadai');
    expect(html).toContain('3');
  });

  it('shows a line note the kitchen must act on', () => {
    expect(kotHtml(order(), 'THANJAI CAFE')).toContain('no chutney');
  });

  it('carries no prices — the kitchen does not need the money', () => {
    const html = kotHtml(order(), 'THANJAI CAFE');
    expect(html).not.toContain('99.75');
    expect(html).not.toContain('₹');
  });

  it('refuses to render a docket for an unpaid order', () => {
    expect(() => kotHtml(order({ status: 'AWAITING_PAYMENT' }), 'X'))
      .toThrow(/paid/i);
    expect(() => kotHtml(order({ status: 'PAYMENT_FAILED' }), 'X'))
      .toThrow(/paid/i);
  });

  it('escapes a name that would otherwise inject markup', () => {
    const html = kotHtml(order({ customerName: '<script>x</script>' }), 'X');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
