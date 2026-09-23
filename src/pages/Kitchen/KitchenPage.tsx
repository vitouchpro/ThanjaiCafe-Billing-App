import { useEffect, useState } from 'react';
import { CheckCircle2, ChefHat, Clock, Flame, Printer, ShoppingBag, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { useOrderIntake } from '@/features/orders/useOrderIntake';
import { useKotAutoPrint } from '@/features/orders/useKotAutoPrint';
import { advanceStatus } from '@/services/cloud/orders';
import { printKot } from '@/services/billing/kot';
import { isCloudConfigured } from '@/services/cloud/client';
import { Badge, Button, Card, EmptyState, toast } from '@/components/ui';
import type { CloudOrder, OrderStatus } from '@/types/order';

/* The kitchen display screen. A cook reads this across a room while working:
   large type, high contrast, no hover-only affordances, tap targets >= 44px.
   useOrderIntake already filters to KITCHEN_VISIBLE (PAID/ACCEPTED/PREPARING/
   READY) — an unpaid order can never reach this board. */

const WARNING_MS = 15 * 60 * 1000;

type Column = 'new' | 'preparing' | 'ready';

const COLUMNS: { key: Column; title: string; icon: typeof ShoppingBag; statuses: OrderStatus[] }[] = [
  { key: 'new', title: 'New', icon: ShoppingBag, statuses: ['PAID', 'ACCEPTED'] },
  { key: 'preparing', title: 'Preparing', icon: Flame, statuses: ['PREPARING'] },
  { key: 'ready', title: 'Ready', icon: CheckCircle2, statuses: ['READY'] },
];

/** The next status a ticket moves to, and the label for that action. */
function nextStep(status: OrderStatus): { to: OrderStatus; label: string } | null {
  if (status === 'PAID' || status === 'ACCEPTED') return { to: 'PREPARING', label: 'Start' };
  if (status === 'PREPARING') return { to: 'READY', label: 'Ready' };
  if (status === 'READY') return { to: 'SERVED', label: 'Picked up' };
  return null;
}

export function KitchenPage() {
  const businessName = useAppStore((s) => s.settings.business.name);
  const autoPrintKot = useAppStore((s) => s.settings.receipt.autoPrintKot ?? false);
  // The kitchen displays orders; only a till bills them (see ordersToClaim).
  const { orders, error, loaded } = useOrderIntake(true, { createBills: false });
  useKotAutoPrint(orders, loaded && autoPrintKot, businessName);
  const [now, setNow] = useState(() => Date.now());

  // Ticks the "waiting for" clocks and the 15-minute warning treatment.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (!isCloudConfigured()) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <EmptyState
            icon={<WifiOff size={24} />}
            title="Online ordering is not configured"
            description="This device has no VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, so there is no kitchen queue to show. Add them to .env.local and restart the app to enable QR ordering."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5 h-full flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-[22px] sm:text-[26px] font-extrabold text-ink flex items-center gap-2.5">
            <ChefHat size={26} className="text-accent" />
            Kitchen
          </h1>
          <p className="text-[14px] text-ink-3 mt-0.5">
            {orders.length} order{orders.length === 1 ? '' : 's'} in the queue
          </p>
        </div>
        {error && (
          <Badge tone="danger">Could not refresh: {error}</Badge>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4 overflow-y-auto lg:overflow-visible pb-4">
        {COLUMNS.map((col) => (
          <BoardColumn
            key={col.key}
            title={col.title}
            Icon={col.icon}
            tickets={orders.filter((o) => col.statuses.includes(o.status))}
            now={now}
            businessName={businessName}
          />
        ))}
      </div>
    </div>
  );
}

function BoardColumn({
  title, Icon, tickets, now, businessName,
}: {
  title: string;
  Icon: typeof ShoppingBag;
  tickets: CloudOrder[];
  now: number;
  businessName: string;
}) {
  return (
    <div className="flex flex-col min-h-0 lg:h-full">
      <div className="flex items-center gap-2 mb-2.5 shrink-0">
        <Icon size={20} className="text-ink-2" />
        <h2 className="text-[16px] font-extrabold text-ink">{title}</h2>
        <span className="text-[13px] font-bold text-ink-3 tnum">{tickets.length}</span>
      </div>

      <div className="flex-1 min-h-0 lg:overflow-y-auto space-y-3 pr-0.5">
        {tickets.length === 0 ? (
          <div className="border border-dashed border-line rounded-2xl py-10 grid place-items-center text-ink-3 text-[13.5px] font-semibold">
            Nothing here
          </div>
        ) : (
          tickets.map((order) => (
            <Ticket key={order.id} order={order} now={now} businessName={businessName} />
          ))
        )}
      </div>
    </div>
  );
}

function Ticket({
  order, now, businessName,
}: {
  order: CloudOrder;
  now: number;
  businessName: string;
}) {
  const [busy, setBusy] = useState(false);
  const since = new Date(order.paidAt ?? order.createdAt).getTime();
  const waitedMs = Math.max(0, now - since);
  const warning = waitedMs >= WARNING_MS;
  const step = nextStep(order.status);

  async function advance() {
    if (!step) return;
    setBusy(true);
    try {
      await advanceStatus(order.id, step.to);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the order', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      className={clsx(
        'border-2',
        warning ? 'border-danger bg-danger-bg/40' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <p className="text-[32px] leading-none font-extrabold text-ink tnum">{order.token}</p>
          <p className="text-[14px] font-bold text-ink-2 mt-1">Table {order.tableCode}</p>
        </div>
        <WaitBadge waitedMs={waitedMs} warning={warning} />
      </div>

      <div className="mb-3">
        <p className="text-[15px] font-bold text-ink truncate">{order.customerName || 'Guest'}</p>
        {order.customerPhone && <p className="text-[13.5px] text-ink-3 tnum">{order.customerPhone}</p>}
      </div>

      <ul className="divide-y divide-line border-t border-b border-line mb-3">
        {order.lines.map((line) => (
          <li key={line.id} className="py-2 flex items-start gap-2.5">
            <span className="shrink-0 min-w-[28px] text-[16px] font-extrabold text-accent tnum">
              {line.qty}×
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-ink">{line.name}</span>
              {line.note && (
                <span className="block text-[13px] text-warning font-medium italic">{line.note}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-[1fr_auto] gap-2.5">
        {step ? (
          <Button
            variant={order.status === 'READY' ? 'success' : 'primary'}
            size="xl"
            fullWidth
            loading={busy}
            onClick={advance}
          >
            {step.label}
          </Button>
        ) : (
          <div />
        )}
        <Button
          variant="secondary"
          size="xl"
          aria-label="Print KOT"
          onClick={() => printKot(order, businessName)}
        >
          <Printer size={20} />
        </Button>
      </div>
    </Card>
  );
}

function WaitBadge({ waitedMs, warning }: { waitedMs: number; warning: boolean }) {
  const mins = Math.floor(waitedMs / 60_000);
  const label = mins < 1 ? 'just now' : `${mins} min`;
  return (
    <Badge tone={warning ? 'danger' : 'neutral'} className="shrink-0 text-[13px] px-2.5 py-1">
      <Clock size={13} />
      {label}
    </Badge>
  );
}
