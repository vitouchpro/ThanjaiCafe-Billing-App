/* Razorpay Checkout runs in a script we load on demand — never bundled, so the
   till never ships payment-gateway code it does not use.

   Nothing here decides whether a payment succeeded. The handler callback only
   tells the UI to start waiting; the truth arrives at the verify-payment
   webhook, and the phone learns about it over realtime. */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface CheckoutInput {
  keyId: string;
  razorpayOrderId: string;
  amount: number;        // paise, as returned by the server
  businessName: string;
  token: string;
  // No sign-in, so nothing is known about the diner ahead of time — Razorpay
  // asks for name/phone/email itself. Optional only so a caller that somehow
  // has one of these (not this app, today) is free to prefill it.
  name?: string;
  phone?: string;
  email?: string;
}

export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  prefill: { name?: string; contact?: string; email?: string };
  theme: { color: string };
}

export const checkoutOptions = (i: CheckoutInput): RazorpayOptions => ({
  key: i.keyId,
  order_id: i.razorpayOrderId,
  amount: i.amount,
  currency: 'INR',
  name: i.businessName,
  description: `Order ${i.token}`,
  prefill: { name: i.name, contact: i.phone, email: i.email },
  theme: { color: '#6b3f22' },
});

export function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment page'));
    document.head.appendChild(s);
  });
}

export async function openCheckout(
  input: CheckoutInput,
  onDismiss: () => void,
): Promise<void> {
  await loadRazorpayScript();
  const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay;
  new Razorpay({
    ...checkoutOptions(input),
    modal: { ondismiss: onDismiss },
    handler: () => { /* success is confirmed by the webhook, not here */ },
  }).open();
}
