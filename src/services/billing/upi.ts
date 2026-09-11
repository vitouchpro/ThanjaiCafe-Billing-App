import { qrToDataUrl } from './qr';
import { money } from '@/utils/money';

/* UPI deep link (NPCI spec). Any UPI app resolves this into a prefilled
   payment to the shop. */

export interface UpiParams {
  pa: string;   // payee VPA
  pn: string;   // payee name
  am: number;   // amount
  tn?: string;  // transaction note
  tr?: string;  // transaction reference
}

export function upiUri({ pa, pn, am, tn, tr }: UpiParams): string {
  const q = new URLSearchParams({
    pa: pa || 'merchant@upi',
    pn: pn || 'Merchant',
    am: money(am).toFixed(2),
    cu: 'INR',
  });
  if (tn) q.set('tn', tn);
  if (tr) q.set('tr', tr);
  return `upi://pay?${q.toString()}`;
}

export const upiQrDataUrl = (uri: string): string => qrToDataUrl(uri);
