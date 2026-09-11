import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { useCustomerCart } from '@/features/customer/useCustomerCart';
import { Card } from '@/components/ui';

/* The last thing a diner sees. Deliberately static: no live status, no
   polling, no Supabase call. The webhook already did the only thing that
   matters — the food is on its way — and this screen's only job is to hand
   over the number that gets called out.

   The cart is cleared on mount so a returning diner (a back-button press, a
   re-scan of the same table QR) starts fresh rather than re-paying for what
   they already bought. */

export function ThanksPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const table = params.get('table');
  const clear = useCustomerCart((s) => s.clear);

  useEffect(() => { clear(); }, [clear]);

  return (
    <div className="px-4 py-10 min-h-full flex flex-col items-center justify-center text-center space-y-6">
      <div className="w-14 h-14 rounded-2xl bg-success-bg text-success grid place-items-center">
        <CheckCircle2 size={28} />
      </div>

      <div className="space-y-1.5">
        <h1 className="text-[19px] font-extrabold text-ink">Thank you!</h1>
        <p className="text-[13.5px] text-ink-2">Your payment was received.</p>
      </div>

      {token ? (
        <>
          <Card className="w-full max-w-xs space-y-1 py-6">
            <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wider">Your number</p>
            <p className="text-[56px] leading-tight font-extrabold text-accent tnum">{token}</p>
            {table && <p className="text-[14.5px] font-semibold text-ink-2">Table {table}</p>}
          </Card>
          <p className="text-[13px] text-ink-3 max-w-xs leading-relaxed">
            The kitchen has your order. Listen for your number — {token} — to be called out.
          </p>
        </>
      ) : (
        <Card className="w-full max-w-xs">
          <p className="text-[14px] text-ink">
            Your order is confirmed — please check with the counter for your number.
          </p>
        </Card>
      )}
    </div>
  );
}
