import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Printer, Receipt, ShoppingBag, WifiOff,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useOrderIntake } from '@/features/orders/useOrderIntake';
import { advanceStatus } from '@/services/cloud/orders';
import { printKot } from '@/services/billing/kot';
import { isCloudConfigured } from '@/services/cloud/client';
import { Badge, Button, Card, EmptyState, toast } from '@/components/ui';
import { formatMoney } from '@/utils/money';
import { formatTime } from '@/utils/date';
import { STATUS_LABELS } from '@/types/order';
import type { CloudOrder, OrderStatus } from '@/types/order';

/* The cashier's live view of what has been paid for and what the kitchen is
   cooking, so a paid order announces itself instead of appearing silently in
   Bill History. useOrderIntake(true) already filters to KITCHEN_VISIBLE
   statuses — an unpaid order can never reach this list. */

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'success' | 'warning' | 'info' | 'danger'> = {
  AWAITING_PAYMENT: 'neutral',
  PAID: 'info',
  ACCEPTED: 'info',
  PREPARING: 'warning',
  READY: 'success',
  SERVED: 'neutral',
  PAYMENT_FAILED: 'danger',
  CANCELLED: 'danger',
};

export function OnlineOrdersPage() {
  const businessName = useAppStore((s) => s.settings.business.name);
  const products = useAppStore((s) => s.products);
  const bills = useAppStore((s) => s.bills);
  const { orders, error, problems } = useOrderIntake(true);

  if (!isCloudConfigured()) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <EmptyState
            icon={<WifiOff size={24} />}
            title="Online ordering is not configured"
            description="This device has no VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, so there are no online orders to show. Add them to .env.local and restart the app to enable it. Everything else in Billing keeps working offline."
          />
        </Card>
      </div>
    );
  }

  const unservedNewestFirst = [...orders]
    .filter((o) => o.status !== 'SERVED')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const availableIds = new Set(products.filter((p) => p.available).map((p) => p.id));

  return (
    <div className="p-4 sm:p-5 max-w-[900px] mx-auto space-y-4">
      <div>
        <h1 className="text-[21px] sm:text-[24px] font-extrabold text-ink">Online Orders</h1>
        <p className="text-[13.5px] text-ink-3 mt-0.5">
          {unservedNewestFirst.length} order{unservedNewestFirst.length === 1 ? '' : 's'} in progress
        </p>
      </div>

      {error && (
        <Card className="border-danger/30 bg-danger-bg/40">
          <p className="text-[13.5px] font-semibold text-danger">Could not refresh: {error}</p>
        </Card>
      )}

      {problems.length > 0 && <ProblemList problems={problems} />}

      {unservedNewestFirst.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingBag size={22} />}
            title="No online orders in progress"
            description="Paid QR orders will appear here the moment a customer pays."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {unservedNewestFirst.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              businessName={businessName}
              bill={bills.find((b) => b.id === order.billId)}
              needsRefund={order.lines.some((l) => !availableIds.has(l.productId))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Money taken with no bill. Rendered above everything else — this is the
    one thing on this page that must not be missed. */
function ProblemList({
  problems,
}: {
  problems: { orderId: string; token: string; tableCode: string; reason: string; numberSpent: boolean }[];
}) {
  return (
    <Card className="border-danger/40 bg-danger-bg/50">
      <div className="flex items-start gap-2.5 mb-3">
        <AlertTriangle size={19} className="text-danger shrink-0 mt-0.5" />
        <div>
          <p className="text-[15px] font-extrabold text-danger">
            {problems.length} order{problems.length === 1 ? '' : 's'} paid but not billed
          </p>
          <p className="text-[13px] text-ink-2 mt-0.5 leading-relaxed">
            Money was taken for these orders but a bill could not be created automatically.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {problems.map((p) => (
          <li key={p.orderId} className="p-3 rounded-xl bg-surface border border-danger/25">
            <p className="text-[14px] font-bold text-ink">
              {p.token} · Table {p.tableCode}
            </p>
            <p className="text-[12.5px] text-ink-2 mt-0.5 leading-relaxed">{p.reason}</p>
            {p.numberSpent && (
              <p className="text-[12.5px] text-danger font-semibold mt-1">
                An invoice number was already used for this order — it needs a person to sort
                out, not a retry.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OrderRow({
  order, businessName, bill, needsRefund,
}: {
  order: CloudOrder;
  businessName: string;
  bill: { id: string; billNo: string } | undefined;
  needsRefund: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function markServed() {
    setBusy(true);
    try {
      await advanceStatus(order.id, 'SERVED');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the order', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[22px] leading-none font-extrabold text-ink tnum">{order.token}</p>
            <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABELS[order.status]}</Badge>
            {needsRefund && <Badge tone="danger">Refund needed</Badge>}
          </div>
          <p className="text-[13.5px] font-semibold text-ink-2 mt-1">
            Table {order.tableCode} · {order.customerName || 'Guest'}
            {order.customerPhone ? ` · ${order.customerPhone}` : ''}
          </p>
          <p className="text-[12px] text-ink-3 mt-0.5">{formatTime(order.createdAt)}</p>
        </div>
        <p className="text-[19px] font-extrabold text-ink tnum shrink-0">{formatMoney(order.total)}</p>
      </div>

      <ul className="divide-y divide-line border-t border-b border-line mb-3">
        {order.lines.map((line) => (
          <li key={line.id} className="py-1.5 flex items-start gap-2.5 text-[13.5px]">
            <span className="shrink-0 min-w-[24px] font-bold text-accent tnum">{line.qty}×</span>
            <span className="min-w-0 flex-1">
              <span className="text-ink font-medium">{line.name}</span>
              {line.note && <span className="block text-ink-3 italic">{line.note}</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="text-[13px] text-ink-2">
          {bill ? (
            <Link to="/billing/history" className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">
              <Receipt size={14} />
              {bill.billNo}
            </Link>
          ) : (
            <span className="text-ink-3">No bill yet</span>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" icon={<Printer size={16} />} onClick={() => printKot(order, businessName)}>
            Print KOT
          </Button>
          <Button
            variant="success"
            icon={<CheckCircle2 size={16} />}
            loading={busy}
            disabled={order.status === 'SERVED'}
            onClick={markServed}
          >
            Mark served
          </Button>
        </div>
      </div>
    </Card>
  );
}
