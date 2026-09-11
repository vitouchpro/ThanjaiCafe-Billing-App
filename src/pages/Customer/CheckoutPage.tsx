import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Minus, Plus, ShoppingBag, TriangleAlert, X } from 'lucide-react';
import { useCustomerCart, cartTotals, MAX_QTY, type CartItem } from '@/features/customer/useCustomerCart';
import { supabase, isCloudConfigured } from '@/services/cloud/client';
import { fetchPublishedMenu, type MenuRow } from '@/services/cloud/menu';
import { openCheckout } from '@/services/cloud/razorpay';
import { Button, Card, EmptyState, Spinner } from '@/components/ui';
import { formatMoney } from '@/utils/money';

/* The last screen before money moves.

   The cart store deliberately does not reconcile a sold-out item or a price
   change — that is this page's job, and it happens right before payment so
   the check is as fresh as it can be. Anything wrong with the cart BLOCKS
   the pay button; it never silently charges more than the diner saw.

   There is no sign-in and nothing is typed here — the owner does not want
   the customer's Google details. The order is identified only by the table
   scanned and the token called out after payment. */

type MenuCheck =
  | { status: 'checking' }
  | { status: 'error'; message: string }
  | { status: 'clean' }
  | {
      status: 'issues';
      removed: { id: string; name: string }[];
      changed: { id: string; name: string; oldPrice: number; newPrice: number }[];
    };

type PayState = { status: 'idle' } | { status: 'paying' } | { status: 'confirming' } | { status: 'error'; message: string };

export function CheckoutPage() {
  if (!isCloudConfigured()) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<TriangleAlert size={24} />}
          title="Online ordering is unavailable"
          description="This cafe hasn't set up online ordering yet. Please order at the counter."
        />
      </div>
    );
  }
  return <CheckoutContent />;
}

function CheckoutContent() {
  const navigate = useNavigate();
  const { items, tableCode, setQty, remove } = useCustomerCart();

  const [menuCheck, setMenuCheck] = useState<MenuCheck>({ status: 'checking' });
  const [acknowledgedPrices, setAcknowledgedPrices] = useState(false);

  const checkMenu = useCallback(() => {
    if (items.length === 0) return;
    setMenuCheck({ status: 'checking' });
    setAcknowledgedPrices(false);
    fetchPublishedMenu()
      .then((rows) => {
        const byId = new Map<string, MenuRow>(rows.map((r) => [r.id, r]));
        const removed: { id: string; name: string }[] = [];
        const changed: { id: string; name: string; oldPrice: number; newPrice: number }[] = [];
        for (const item of items) {
          const live = byId.get(item.id);
          if (!live || !live.available) {
            removed.push({ id: item.id, name: item.name });
          } else if (live.price !== item.price) {
            changed.push({ id: item.id, name: item.name, oldPrice: item.price, newPrice: live.price });
          }
        }
        setMenuCheck(
          removed.length || changed.length
            ? { status: 'issues', removed, changed }
            : { status: 'clean' },
        );
      })
      .catch((err: unknown) => {
        setMenuCheck({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not check the menu',
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  useEffect(() => { checkMenu(); }, [checkMenu]);

  const [pay, setPay] = useState<PayState>({ status: 'idle' });

  const totals = useMemo(() => cartTotals(items), [items]);

  if (items.length === 0) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<ShoppingBag size={24} />}
          title="Your order is empty"
          description="Add something from the menu to get started."
          action={<Link to={tableCode ? `/order?t=${tableCode}` : '/order'}><Button variant="primary">Back to menu</Button></Link>}
        />
      </div>
    );
  }

  const cartBlocked = menuCheck.status === 'issues';
  const priceAckNeeded = menuCheck.status === 'issues' && menuCheck.changed.length > 0 && menuCheck.removed.length === 0;
  const menuClearedForPayment = menuCheck.status === 'clean' || (priceAckNeeded && acknowledgedPrices);
  const canPay = !!supabase && menuClearedForPayment;

  const handlePay = async () => {
    if (!supabase) return;
    setPay({ status: 'paying' });
    try {
      const { data, error } = await supabase.functions.invoke('create-order', {
        body: {
          tableCode,
          lines: items.map((i: CartItem) => ({ productId: i.id, qty: i.qty, note: i.note })),
        },
      });
      if (error) {
        let message = error instanceof Error ? error.message : 'Could not create the order';
        if (error instanceof FunctionsHttpError) {
          try {
            const body = await error.context.json();
            if (typeof body?.error === 'string') message = body.error;
          } catch {
            // fall back to the generic message above
          }
        }
        throw new Error(message);
      }
      const result = data as {
        draftId: string; token: string; tableCode: string;
        razorpayOrderId: string; amount: number; currency: string; keyId: string;
      };

      setPay({ status: 'confirming' });
      await openCheckout(
        {
          keyId: result.keyId,
          razorpayOrderId: result.razorpayOrderId,
          amount: result.amount,
          businessName: import.meta.env.VITE_CAFE_NAME || 'THANJAI CAFE',
          token: result.token,
        },
        () => setPay({ status: 'idle' }),
      );
      navigate(`/order/thanks?token=${encodeURIComponent(result.token)}&table=${encodeURIComponent(result.tableCode)}`);
    } catch (err) {
      setPay({ status: 'error', message: err instanceof Error ? err.message : 'Could not start the payment' });
    }
  };

  return (
    <div className="px-4 py-4 pb-32 space-y-4">
      <h1 className="text-[17px] font-bold text-ink">Your order</h1>

      <Card className="divide-y divide-line">
        {items.map((item) => (
          <CartLine key={item.id} item={item} onQty={(q) => setQty(item.id, q)} onRemove={() => remove(item.id)} />
        ))}
      </Card>

      <Card className="space-y-1.5">
        <TotalsRow label="Subtotal" value={totals.subtotal} />
        {totals.tax > 0 && <TotalsRow label="Tax" value={totals.tax} />}
        <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-line">
          <span className="text-[14.5px] font-bold text-ink">Total</span>
          <span className="text-[16px] font-extrabold text-ink tnum">{formatMoney(totals.total)}</span>
        </div>
      </Card>

      <MenuCheckPanel state={menuCheck} onRemove={remove} onRetry={checkMenu}
        acknowledged={acknowledgedPrices} onAcknowledge={() => setAcknowledgedPrices(true)} />

      {pay.status === 'error' && (
        <Card className="border-danger/40 bg-danger-bg">
          <p className="text-[13px] text-danger">{pay.message}</p>
        </Card>
      )}
      {pay.status === 'confirming' && (
        <Card className="text-center space-y-2">
          <Spinner />
          <p className="text-[13px] text-ink-2">Confirming your payment…</p>
        </Card>
      )}
      <Button
        variant="primary"
        fullWidth
        size="lg"
        loading={pay.status === 'paying'}
        disabled={!canPay || pay.status === 'paying' || pay.status === 'confirming'}
        onClick={handlePay}
      >
        Pay {formatMoney(totals.total)}
      </Button>
      {cartBlocked && !priceAckNeeded && (
        <p className="text-[12.5px] text-ink-3 text-center">
          Fix the items above before paying.
        </p>
      )}
    </div>
  );
}

function TotalsRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13.5px] text-ink-2">{label}</span>
      <span className="text-[13.5px] text-ink-2 tnum">{formatMoney(value)}</span>
    </div>
  );
}

function CartLine({ item, onQty, onRemove }: { item: CartItem; onQty: (qty: number) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-ink truncate">{item.name}</p>
        <p className="text-[13px] text-ink-3 tnum mt-0.5">{formatMoney(item.price)} each</p>
      </div>
      <div className="flex items-center gap-1 bg-surface-3 rounded-xl p-1 shrink-0">
        <button
          onClick={() => onQty(item.qty - 1)}
          aria-label={`Remove one ${item.name}`}
          className="w-11 h-11 grid place-items-center rounded-lg bg-surface text-ink hover:bg-line active:scale-[0.95] transition-all"
        >
          <Minus size={16} strokeWidth={2.75} />
        </button>
        <span className="w-7 text-center text-[14px] font-extrabold text-ink tnum">{item.qty}</span>
        <button
          onClick={() => item.qty < MAX_QTY && onQty(item.qty + 1)}
          disabled={item.qty >= MAX_QTY}
          aria-label={`Add one more ${item.name}`}
          className="w-11 h-11 grid place-items-center rounded-lg bg-accent text-accent-fg hover:bg-accent-600 active:scale-[0.95] transition-all disabled:opacity-45"
        >
          <Plus size={16} strokeWidth={2.75} />
        </button>
      </div>
      <button
        onClick={onRemove}
        aria-label={`Remove ${item.name} from your order`}
        className="w-11 h-11 grid place-items-center rounded-lg text-ink-3 hover:text-danger hover:bg-danger-bg active:scale-[0.95] transition-all shrink-0"
      >
        <X size={18} />
      </button>
    </div>
  );
}

function MenuCheckPanel({
  state, onRemove, onRetry, acknowledged, onAcknowledge,
}: {
  state: MenuCheck;
  onRemove: (id: string) => void;
  onRetry: () => void;
  acknowledged: boolean;
  onAcknowledge: () => void;
}) {
  if (state.status === 'checking') {
    return (
      <div className="flex items-center justify-center gap-2 py-3 text-[13px] text-ink-3">
        <Spinner className="!size-4" />
        Checking prices and availability…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <Card className="border-danger/40 bg-danger-bg space-y-2">
        <p className="text-[13.5px] font-semibold text-danger">Could not check the menu</p>
        <p className="text-[13px] text-danger">{state.message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
      </Card>
    );
  }

  if (state.status !== 'issues') return null;

  return (
    <Card className="border-warning/40 bg-warning-bg space-y-3">
      {state.removed.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2">
          <p className="text-[13.5px] text-ink">
            <span className="font-bold">{r.name}</span> is no longer available
          </p>
          <Button variant="secondary" size="sm" onClick={() => onRemove(r.id)}>
            Remove
          </Button>
        </div>
      ))}
      {state.changed.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2">
          <p className="text-[13.5px] text-ink">
            <span className="font-bold">{c.name}</span> is now {formatMoney(c.newPrice)} (was {formatMoney(c.oldPrice)})
          </p>
        </div>
      ))}
      {state.changed.length > 0 && state.removed.length === 0 && (
        <label className="flex items-center gap-2 text-[13px] text-ink-2 pt-1">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={onAcknowledge}
            className="w-5 h-5 accent-accent"
          />
          I accept the new price
        </label>
      )}
      {state.removed.length > 0 && (
        <p className="text-[12.5px] text-ink-3">Remove the item{state.removed.length > 1 ? 's' : ''} above to continue.</p>
      )}
    </Card>
  );
}
