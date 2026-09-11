import type { ID, ISODateTime } from './index';

/* The cross-device contract. These shapes exist in Postgres as well as in the
   browser, so field names here match the SQL columns exactly (snake_case is
   mapped at the client boundary in services/cloud). */

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'PAYMENT_FAILED'
  | 'CANCELLED';

export interface CloudOrderLine {
  id: ID;
  orderId: ID;
  productId: ID;
  name: string;
  unitPrice: number;
  qty: number;
  taxRate: number;
  note?: string;
}

export interface CloudOrder {
  id: ID;
  token: string;            // A-07 — what gets called out
  tableCode: string;        // T04
  customerId: ID | null;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  subtotal: number;
  tax: number;
  total: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  billId?: ID;              // set by the till once a local Bill exists
  note?: string;
  createdAt: ISODateTime;
  paidAt?: ISODateTime;
  acceptedAt?: ISODateTime;
  readyAt?: ISODateTime;
  servedAt?: ISODateTime;
  lines: CloudOrderLine[];
}

export interface CloudCustomer {
  id: ID;                   // Supabase auth uid
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;   // false under Google sign-in; the switch for OTP later
}

/** What the customer's phone shows for each status. */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Waiting for payment',
  PAID: 'Payment received',
  ACCEPTED: 'Order accepted',
  PREPARING: 'Being prepared',
  READY: 'Ready',
  SERVED: 'Served',
  PAYMENT_FAILED: 'Payment failed',
  CANCELLED: 'Cancelled',
};
