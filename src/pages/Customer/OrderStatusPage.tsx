import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, CircleAlert, Clock, PackageCheck, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { fetchOrder, subscribeToOrder } from '@/services/cloud/orders';
import { isCloudConfigured } from '@/services/cloud/client';
import { useCustomerCart } from '@/features/customer/useCustomerCart';
import { STATUS_LABELS, type CloudOrder, type OrderStatus } from '@/types/order';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { formatMoney } from '@/utils/money';

/* The screen a diner stares at after paying. It answers two questions only:
   did my payment work, and is my food coming — and it answers both from the
   database, never from anything the phone itself decided. The webhook that
   flips AWAITING_PAYMENT -> PAID is the only writer of that transition; this
   page only ever reads. */

const POLL_MS = 15_000;
const SHOW_COUNTER_AFTER_MS = 90_000;

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; order: CloudOrder };

/* A diner watching this screen should never read "TypeError: Failed to
   fetch". A dropped connection is the most likely failure — a phone on
   patchy cafe wifi — and the one thing they can act on, so it gets plain
   words and a Retry. Anything else keeps its message, because a real server
   error is something staff need to be told. */
function dinerFacing(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (raw === 'TIMED_OUT') {
    return 'This is taking too long to load. Check your connection and try again, or show this screen to the counter.';
  }
  if (/failed to fetch|networkerror|load failed|ERR_/i.test(raw)) {
    return 'Your phone could not reach your order. Check your connection and try again, or show this screen to the counter.';
  }
  return raw || 'Something went wrong loading your order.';
}

export function OrderStatusPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<CircleAlert size={24} />}
          title="We couldn't find that order"
          description="This link is missing an order. Please check the link, or speak to the counter."
        />
      </div>
    );
  }

  if (!isCloudConfigured()) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<TriangleAlert size={24} />}
          title="Online ordering is unavailable"
          description="This cafe hasn't set up online ordering yet. Please speak to the counter."
        />
      </div>
    );
  }

  return <OrderStatusContent id={id} />;
}

function OrderStatusContent({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const clearCart = useCustomerCart((s) => s.clear);
  const clearedRef = useRef(false);

  const load = useCallback((signalCancelled: { current: boolean }) => {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMED_OUT')), 10_000),
    );
    Promise.race([fetchOrder(id), timeout])
      .then((order) => {
        if (signalCancelled.current) return;
        setState(order ? { status: 'ready', order } : { status: 'not-found' });
      })
      .catch((err: unknown) => {
        if (signalCancelled.current) return;
        setState({ status: 'error', message: dinerFacing(err) });
      });
  }, [id]);

  // Initial fetch + retry, live subscription, and a 15s poll as a fallback
  // in case the realtime channel drops silently.
  useEffect(() => {
    const cancelled = { current: false };
    load(cancelled);

    const unsubscribe = subscribeToOrder(id, (order) => {
      if (!cancelled.current) setState({ status: 'ready', order });
    });

    const poll = setInterval(() => load(cancelled), POLL_MS);

    return () => {
      cancelled.current = true;
      unsubscribe();
      clearInterval(poll);
    };
  }, [id, load, attempt]);

  // The database saying PAID is the only trigger for clearing the cart —
  // never anything client-side. Guarded so it fires once per mount even as
  // further status updates keep arriving.
  useEffect(() => {
    if (state.status === 'ready' && state.order.status !== 'AWAITING_PAYMENT' && !clearedRef.current) {
      clearedRef.current = true;
      clearCart();
    }
  }, [state, clearCart]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((a) => a + 1);
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="px-4 py-16 flex justify-center">
        <Spinner />
      </div>
    );
  }

  if (state.status === 'not-found') {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<CircleAlert size={24} />}
          title="We couldn't find that order"
          description="This order may have expired or the link is incorrect. Please speak to the counter for help."
        />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<TriangleAlert size={24} />}
          title="Could not load your order"
          description={state.message}
          action={<Button variant="primary" onClick={reload}>Retry</Button>}
        />
      </div>
    );
  }

  return <OrderStatusView order={state.order} />;
}

const STEP_ORDER: OrderStatus[] = ['PAID', 'ACCEPTED', 'PREPARING', 'READY'];

function OrderStatusView({ order }: { order: CloudOrder }) {
  const [waitedLong, setWaitedLong] = useState(false);

  useEffect(() => {
    if (order.status !== 'AWAITING_PAYMENT') return;
    const t = setTimeout(() => setWaitedLong(true), SHOW_COUNTER_AFTER_MS);
    return () => clearTimeout(t);
  }, [order.status]);

  // waitedLong only ever matters while still AWAITING_PAYMENT; once the
  // status moves on this line hides the banner without another setState.
  const showCounterHint = waitedLong && order.status === 'AWAITING_PAYMENT';

  return (
    <div className="px-4 py-6 pb-12 space-y-5">
      <TokenHeader order={order} />

      {order.status === 'AWAITING_PAYMENT' && (
        <Card className="text-center space-y-3 py-8">
          <div className="flex justify-center"><Spinner /></div>
          <p className="text-[14.5px] font-semibold text-ink">Confirming your payment…</p>
          <p className="text-[13px] text-ink-3">This can take a few seconds. Please don't close this page.</p>
          {showCounterHint && (
            <p className="text-[13px] text-warning font-medium pt-1">
              Still waiting? Show this screen to the counter and they'll check on it.
            </p>
          )}
        </Card>
      )}

      {order.status === 'PAYMENT_FAILED' && (
        <Card className="border-danger/40 bg-danger-bg text-center space-y-3 py-8">
          <div className="flex justify-center text-danger"><CircleAlert size={32} /></div>
          <p className="text-[15px] font-bold text-danger">Your payment didn't go through</p>
          <p className="text-[13px] text-danger">No charge was made. Your cart is still saved — you can try again.</p>
          <Link to="/order/checkout">
            <Button variant="primary" size="lg">Try again</Button>
          </Link>
        </Card>
      )}

      {order.status === 'CANCELLED' && (
        <Card className="text-center space-y-3 py-8">
          <div className="flex justify-center text-ink-3"><CircleAlert size={32} /></div>
          <p className="text-[15px] font-bold text-ink">This order was cancelled</p>
          <p className="text-[13px] text-ink-3">Please speak to the counter if you have any questions.</p>
        </Card>
      )}

      {(order.status === 'PAID' || order.status === 'ACCEPTED' || order.status === 'PREPARING' || order.status === 'READY') && (
        <StepIndicator status={order.status} />
      )}

      {order.status === 'SERVED' && (
        <Card className="text-center space-y-2 py-8">
          <div className="flex justify-center text-success"><PackageCheck size={28} /></div>
          <p className="text-[14.5px] font-bold text-ink">Order served</p>
          <p className="text-[13px] text-ink-3">Enjoy! Thank you for ordering with us.</p>
        </Card>
      )}

      <OrderSummary order={order} />
    </div>
  );
}

function TokenHeader({ order }: { order: CloudOrder }) {
  const ready = order.status === 'READY';
  return (
    <div
      className={clsx(
        'rounded-2xl border p-5 text-center transition-colors',
        ready ? 'bg-accent border-accent shadow-[var(--shadow-lg)]' : 'bg-surface border-line',
      )}
    >
      <p className={clsx('text-[12px] font-bold uppercase tracking-wider', ready ? 'text-accent-fg/80' : 'text-ink-3')}>
        Your token
      </p>
      <p className={clsx('text-[44px] leading-tight font-extrabold tnum tracking-tight', ready ? 'text-accent-fg' : 'text-ink')}>
        {order.token}
      </p>
      <p className={clsx('text-[13px] font-semibold', ready ? 'text-accent-fg/90' : 'text-ink-2')}>
        Table {order.tableCode}
      </p>
      {ready && (
        <p className="mt-2 text-[15px] font-extrabold text-accent-fg uppercase tracking-wide">
          Your order is ready!
        </p>
      )}
    </div>
  );
}

function StepIndicator({ status }: { status: OrderStatus }) {
  const currentIdx = STEP_ORDER.indexOf(status);
  return (
    <Card className="space-y-0">
      {STEP_ORDER.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const isReady = step === 'READY';
        return (
          <div key={step} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  'w-8 h-8 rounded-full grid place-items-center shrink-0 border-2 transition-colors',
                  done && 'bg-success border-success text-white',
                  active && !done && isReady && 'bg-accent border-accent text-accent-fg',
                  active && !done && !isReady && 'bg-accent-50 border-accent text-accent-700',
                  !done && !active && 'border-line text-ink-3',
                )}
              >
                {done ? <Check size={16} strokeWidth={3} /> : active ? <Clock size={15} /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
              </div>
              {i < STEP_ORDER.length - 1 && (
                <div className={clsx('w-0.5 flex-1 min-h-[22px]', done ? 'bg-success' : 'bg-line')} />
              )}
            </div>
            <div className={clsx('pb-5', i === STEP_ORDER.length - 1 && 'pb-0')}>
              <p
                className={clsx(
                  'font-bold leading-tight',
                  isReady && active ? 'text-[19px] text-accent' : 'text-[14px]',
                  done && 'text-ink',
                  active && !isReady && 'text-ink',
                  !done && !active && 'text-ink-3',
                )}
              >
                {STATUS_LABELS[step]}
              </p>
              {active && (
                <Badge tone={isReady ? 'accent' : 'info'} className="mt-1">In progress</Badge>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function OrderSummary({ order }: { order: CloudOrder }) {
  return (
    <Card className="space-y-3">
      <p className="text-[13px] font-bold text-ink-2 uppercase tracking-wide">Order summary</p>
      <div className="divide-y divide-line">
        {order.lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-ink truncate">
                {line.name} <span className="text-ink-3 font-normal">× {line.qty}</span>
              </p>
            </div>
            <span className="text-[14px] font-bold text-ink tnum shrink-0">
              {formatMoney(line.unitPrice * line.qty)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-line">
        <span className="text-[14.5px] font-bold text-ink">Total</span>
        <span className="text-[16px] font-extrabold text-ink tnum">{formatMoney(order.total)}</span>
      </div>
    </Card>
  );
}
