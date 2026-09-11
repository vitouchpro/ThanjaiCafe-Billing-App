import type { OrderStatus } from '@/types/order';

/* The status graph is the spine of the whole feature. Encoding it as data —
   rather than scattered `if` checks — is what guarantees that no code path can
   walk an unpaid order into the kitchen. */

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  AWAITING_PAYMENT: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: [],
  PAYMENT_FAILED: ['CANCELLED'],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Tickets the cooking department should see: paid, and not yet finished. */
export const KITCHEN_VISIBLE: OrderStatus[] = ['PAID', 'ACCEPTED', 'PREPARING', 'READY'];

export const isKitchenVisible = (s: OrderStatus): boolean => KITCHEN_VISIBLE.includes(s);
