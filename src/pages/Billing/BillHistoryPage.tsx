import { useMemo, useState } from 'react';
import {
  Banknote, CreditCard, Printer, Receipt, RotateCcw, Share2, Smartphone, XCircle, CloudOff,
} from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { useDebounced, usePermission } from '@/hooks';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Modal, MoneyInput,
  SearchInput, Segmented, Field, toast,
} from '@/components/ui';
import { computeBill } from '@/services/billing/calc';
import { printReceipt, shareReceipt } from '@/services/billing/receipt';
import { billsBetween, isOnlineBill, summarize } from '@/services/reports/analytics';
import { formatMoney, toRupees } from '@/utils/money';
import { addDays, formatDate, formatTime, startOfDay } from '@/utils/date';
import type { Bill, PaymentMethod } from '@/types';

/* Plan §14 — bill history, detail, reprint, share, refund. */

type RangeKey = 'today' | '7d' | '30d' | 'all';

const RANGES = [
  { value: 'today' as const, label: 'Today' },
  { value: '7d' as const, label: '7 Days' },
  { value: '30d' as const, label: '30 Days' },
  { value: 'all' as const, label: 'All' },
];

type SourceKey = 'all' | 'online';

const SOURCES = [
  { value: 'all' as const, label: 'All' },
  { value: 'online' as const, label: 'Online' },
];

const PAYMENT_ICONS: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  upi: Smartphone,
  card: CreditCard,
};

export function BillHistoryPage() {
  const bills = useAppStore((s) => s.bills);
  const settings = useAppStore((s) => s.settings);

  const [range, setRange] = useState<RangeKey>('today');
  const [source, setSource] = useState<SourceKey>('all');
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 200);
  const [selected, setSelected] = useState<Bill | null>(null);

  const filtered = useMemo(() => {
    const today = startOfDay(new Date());
    const days = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 0;

    let list = days ? billsBetween(bills, addDays(today, -(days - 1)), today) : bills.filter((b) => b.status !== 'held');

    if (source === 'online') list = list.filter(isOnlineBill);

    const q = debounced.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.billNo.toLowerCase().includes(q) ||
          String(b.seq).includes(q) ||
          b.totals.total.toFixed(2).includes(q) ||
          (b.customerName ?? '').toLowerCase().includes(q) ||
          (b.customerPhone ?? '').includes(q) ||
          b.cashierName.toLowerCase().includes(q),
      );
    }

    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [bills, range, source, debounced]);

  const summary = useMemo(() => summarize(filtered), [filtered]);

  return (
    <div className="p-4 sm:p-5 max-w-[1200px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[21px] sm:text-[24px] font-extrabold text-ink">Bill History</h1>
          <p className="text-[13.5px] text-ink-3 mt-0.5 tnum">
            {summary.orders} bills · {formatMoney(summary.totalSales)}
            {summary.refunds > 0 && ` · ${formatMoney(summary.refunds)} refunded`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented options={SOURCES} value={source} onChange={setSource} size="sm" />
          <Segmented options={RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search bill number, amount, customer or cashier…"
      />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Receipt size={22} />}
            title={query ? 'No bills match your search' : 'No bills in this period'}
            description={
              query
                ? 'Try a bill number, an amount, or a customer name.'
                : 'Bills you complete will appear here.'
            }
          />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-line">
            {filtered.map((b) => {
              const Icon = PAYMENT_ICONS[b.payment];
              const voided = b.status === 'refunded' || b.status === 'cancelled';

              return (
                <li key={b.id}>
                  <button
                    onClick={() => setSelected(b)}
                    className="w-full flex items-center gap-3 p-3 sm:p-3.5 text-left hover:bg-surface-2/60 transition"
                  >
                    <span
                      className={clsx(
                        'w-10 h-10 rounded-xl grid place-items-center shrink-0',
                        voided ? 'bg-danger-bg text-danger' : 'bg-accent-50 text-accent-700 dark:text-accent-300',
                      )}
                    >
                      <Icon size={18} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[14.5px] font-extrabold text-ink">{b.billNo}</span>
                        {isOnlineBill(b) && <Badge tone="accent">Online</Badge>}
                        {b.status === 'refunded' && <Badge tone="danger">Refunded</Badge>}
                        {b.status === 'cancelled' && <Badge tone="neutral">Cancelled</Badge>}
                        {b.synced === 0 && (
                          <span title="Not yet synced" className="text-ink-3">
                            <CloudOff size={13} />
                          </span>
                        )}
                      </span>
                      <span className="block text-[12.5px] text-ink-3 truncate">
                        {formatTime(b.createdAt)} · {b.lines.reduce((a, l) => a + l.qty, 0)} items
                        {b.customerName ? ` · ${b.customerName}` : ''} · {b.cashierName}
                      </span>
                    </span>

                    <span className="text-right shrink-0">
                      <span
                        className={clsx(
                          'block text-[15.5px] font-extrabold tnum',
                          voided ? 'text-ink-3 line-through' : 'text-ink',
                        )}
                      >
                        {formatMoney(b.totals.total)}
                      </span>
                      <span className="block text-[11.5px] text-ink-3 uppercase font-bold tracking-wide">
                        {b.payment}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <BillDetailModal bill={selected} onClose={() => setSelected(null)} settings={settings} />
    </div>
  );
}

function BillDetailModal({
  bill, onClose, settings,
}: {
  bill: Bill | null;
  onClose: () => void;
  settings: ReturnType<typeof useAppStore.getState>['settings'];
}) {
  const refundBill = useAppStore((s) => s.refundBill);
  const cancelBill = useAppStore((s) => s.cancelBill);
  const canRefund = usePermission('refund');

  const [showRefund, setShowRefund] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const computed = useMemo(
    () =>
      bill
        ? computeBill(bill.lines, bill.billDiscount, bill.billDiscountType, {
            pricesIncludeTax: settings.billing.pricesIncludeTax,
            roundTotals: settings.billing.roundTotals,
          })
        : null,
    [bill, settings.billing],
  );

  if (!bill || !computed) return null;

  const voided = bill.status === 'refunded' || bill.status === 'cancelled';

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={bill.billNo}
        size="md"
        footer={
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                variant="secondary"
                icon={<Printer size={16} />}
                onClick={() => printReceipt(bill, settings, { duplicate: true })}
              >
                Reprint
              </Button>
              <Button
                variant="secondary"
                icon={<Share2 size={16} />}
                onClick={async () => {
                  const r = await shareReceipt(bill, settings);
                  if (r === 'copied') toast('Receipt copied to clipboard', 'success');
                  else if (r === 'failed') toast('Could not share the receipt', 'danger');
                }}
              >
                Share
              </Button>
            </div>

            {canRefund && !voided && (
              <div className="grid grid-cols-2 gap-2.5">
                <Button variant="outline" icon={<XCircle size={16} />} onClick={() => setConfirmCancel(true)}>
                  Cancel Bill
                </Button>
                <Button variant="danger" icon={<RotateCcw size={16} />} onClick={() => setShowRefund(true)}>
                  Refund
                </Button>
              </div>
            )}
          </div>
        }
      >
        {voided && (
          <div
            className={clsx(
              'flex items-center gap-2.5 p-3 rounded-xl mb-4 border',
              bill.status === 'refunded'
                ? 'bg-danger-bg border-danger/20 text-danger'
                : 'bg-surface-3 border-line text-ink-2',
            )}
          >
            {bill.status === 'refunded' ? <RotateCcw size={17} /> : <XCircle size={17} />}
            <div className="text-[13px] font-semibold">
              {bill.status === 'refunded'
                ? `Refunded ${formatMoney(bill.refundAmount ?? bill.totals.total)}`
                : 'This bill was cancelled'}
              {bill.refundedAt && (
                <span className="block font-normal opacity-80">
                  {formatDate(bill.refundedAt)} at {formatTime(bill.refundedAt)}
                </span>
              )}
            </div>
          </div>
        )}

        {isOnlineBill(bill) && bill.note && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl mb-4 bg-accent-50 text-accent-700 dark:text-accent-300 text-[13px] font-semibold">
            <Badge tone="accent">Online</Badge>
            <span>{bill.note}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-4 text-[13px]">
          <Meta label="Date" value={`${formatDate(bill.createdAt)}, ${formatTime(bill.createdAt)}`} />
          <Meta label="Cashier" value={bill.cashierName} />
          <Meta label="Payment" value={bill.payment.toUpperCase()} />
          <Meta label="Sync" value={bill.synced ? 'Synced' : 'Pending'} />
          {bill.customerName && <Meta label="Customer" value={bill.customerName} />}
          {bill.customerPhone && <Meta label="Phone" value={bill.customerPhone} />}
        </div>

        <div className="border-t border-line pt-3">
          <p className="text-[11.5px] font-extrabold text-ink-3 uppercase tracking-wider mb-2">Items</p>
          <ul className="divide-y divide-line">
            {computed.lines.map((c) => (
              <li key={c.line.id} className="flex items-start gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-ink">{c.line.name}</span>
                  <span className="block text-[12px] text-ink-3 tnum">
                    {formatMoney(c.line.unitPrice)} × {c.line.qty}
                    {c.line.taxRate > 0 && ` · GST ${c.line.taxRate}%`}
                  </span>
                  {c.line.note && (
                    <span className="block text-[11.5px] text-accent-700 dark:text-accent-300 italic">
                      {c.line.note}
                    </span>
                  )}
                </span>
                <span className="text-[14px] font-bold text-ink tnum shrink-0">
                  {formatMoney(toRupees(c.totalPaise))}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-line mt-3 pt-3 space-y-1.5 text-[13.5px]">
          <Row label="Subtotal" value={formatMoney(bill.totals.subtotal)} />
          {bill.totals.itemDiscount > 0 && (
            <Row label="Item discount" value={`−${formatMoney(bill.totals.itemDiscount)}`} tone="danger" />
          )}
          {bill.totals.billDiscount > 0 && (
            <Row label="Bill discount" value={`−${formatMoney(bill.totals.billDiscount)}`} tone="danger" />
          )}
          {computed.taxBreakup.map((t) => (
            <Row key={t.rate} label={`GST ${t.rate}%`} value={formatMoney(t.tax)} muted />
          ))}
          <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-line">
            <span className="text-[15px] font-extrabold text-ink">TOTAL</span>
            <span className="text-[20px] font-extrabold text-ink tnum">
              {formatMoney(bill.totals.total)}
            </span>
          </div>
          {bill.payment === 'cash' && bill.cashReceived != null && (
            <>
              <Row label="Cash received" value={formatMoney(bill.cashReceived)} muted />
              <Row label="Change given" value={formatMoney(bill.change ?? 0)} muted />
            </>
          )}
        </div>
      </Modal>

      <RefundModal
        open={showRefund}
        bill={bill}
        onClose={() => setShowRefund(false)}
        onRefund={async (amount) => {
          await refundBill(bill.id, amount);
          setShowRefund(false);
          onClose();
          toast(`Refunded ${formatMoney(amount)}`, 'success');
        }}
      />

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this bill?"
        message={
          <>
            <b>{bill.billNo}</b> will be marked cancelled and removed from your sales totals.
            The record stays in history for your audit trail.
          </>
        }
        confirmLabel="Cancel bill"
        cancelLabel="Keep it"
        onCancel={() => setConfirmCancel(false)}
        onConfirm={async () => {
          await cancelBill(bill.id);
          setConfirmCancel(false);
          onClose();
          toast('Bill cancelled', 'success');
        }}
      />
    </>
  );
}

function RefundModal({
  open, bill, onClose, onRefund,
}: {
  open: boolean;
  bill: Bill;
  onClose: () => void;
  onRefund: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(String(bill.totals.total));
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) { setWasOpen(true); setAmount(String(bill.totals.total)); }
  if (!open && wasOpen) setWasOpen(false);

  const value = Number(amount) || 0;
  const invalid = value <= 0 || value > bill.totals.total;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refund bill"
      size="sm"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button variant="danger" fullWidth disabled={invalid} onClick={() => onRefund(value)}>
            Refund {formatMoney(value)}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-2 leading-relaxed">
          Refunding <b>{bill.billNo}</b> removes it from sales totals and records the amount
          against today’s refunds.
        </p>

        <Field
          label="Refund amount"
          hint={`Full amount is ${formatMoney(bill.totals.total)}. Enter less for a partial refund.`}
          error={invalid ? 'Enter an amount between ₹0 and the bill total.' : undefined}
        >
          <MoneyInput
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
            className="text-lg"
          />
        </Field>

        <button
          onClick={() => setAmount(String(bill.totals.total))}
          className="w-full h-10 rounded-xl bg-surface-3 text-[13.5px] font-bold text-ink-2 hover:bg-line transition"
        >
          Refund the full amount
        </button>
      </div>
    </Modal>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-ink-3 uppercase tracking-wider">{label}</p>
      <p className="text-[13.5px] font-semibold text-ink truncate">{value}</p>
    </div>
  );
}

function Row({
  label, value, tone, muted,
}: { label: string; value: string; tone?: 'danger'; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={muted ? 'text-ink-3' : 'text-ink-2'}>{label}</span>
      <span
        className={clsx(
          'font-semibold tnum',
          tone === 'danger' ? 'text-danger' : muted ? 'text-ink-3' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
