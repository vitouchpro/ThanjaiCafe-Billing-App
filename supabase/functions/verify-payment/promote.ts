/* Pure pieces of the webhook, kept apart from Deno.serve so they can be tested.

   The promotion itself (draft → PAID order + its lines, in one transaction)
   lives in the database as promote_paid_order(); see apply-migrations-4.sql. */

export type PaymentEvent =
  | { kind: 'captured'; razorpayOrderId: string; razorpayPaymentId: string; amountPaise: number }
  | { kind: 'failed'; razorpayOrderId: string }
  | { kind: 'ignored' };

/** Reads the Razorpay webhook body. Only call this after the signature passed. */
export function parsePaymentEvent(raw: string): PaymentEvent {
  let event: { event?: string; payload?: { payment?: { entity?: Record<string, unknown> } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return { kind: 'ignored' };
  }

  const payment = event?.payload?.payment?.entity;
  const orderId = typeof payment?.order_id === 'string' ? payment.order_id : '';
  if (!payment || !orderId) return { kind: 'ignored' };

  if (event.event === 'payment.failed') return { kind: 'failed', razorpayOrderId: orderId };

  if (event.event === 'payment.captured') {
    const paymentId = typeof payment.id === 'string' ? payment.id : '';
    const amount = Number(payment.amount);
    // Razorpay sends the amount in integer paise.
    if (!paymentId || !Number.isInteger(amount) || amount <= 0) return { kind: 'ignored' };
    return { kind: 'captured', razorpayOrderId: orderId, razorpayPaymentId: paymentId, amountPaise: amount };
  }

  return { kind: 'ignored' };
}

export type PromotionOutcome = 'promoted' | 'already_processed' | 'no_draft' | 'amount_mismatch' | 'no_lines';

export interface WebhookReply {
  status: number;
  body: string;
  /** Money was taken but no order was made: a person must reconcile it. */
  needsReconciliation: boolean;
}

/* Razorpay retries any non-2xx. Retrying only helps for transient failures,
   so every outcome the database has decided on is a 200 — a retry would get
   the same answer — and only an unknown outcome (or a thrown RPC) is a 500. */
export function replyFor(outcome: string | null | undefined): WebhookReply {
  switch (outcome) {
    case 'promoted':
      return { status: 200, body: 'ok', needsReconciliation: false };
    case 'already_processed':
      return { status: 200, body: 'already processed', needsReconciliation: false };
    case 'no_draft':
      return { status: 200, body: 'no draft', needsReconciliation: true };
    case 'amount_mismatch':
      return { status: 200, body: 'amount mismatch', needsReconciliation: true };
    case 'no_lines':
      return { status: 200, body: 'draft has no lines', needsReconciliation: true };
    default:
      return { status: 500, body: 'promotion failed', needsReconciliation: false };
  }
}
