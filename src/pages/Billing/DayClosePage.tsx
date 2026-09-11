import { useMemo, useState } from 'react';
import { CalendarCheck, CheckCircle2, Lock, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import {
  Button, Card, ConfirmDialog, Field, MoneyInput, SectionTitle, Textarea, toast,
} from '@/components/ui';
import {
  billsOnDay, cashInDrawer, onlineSalesTotal, paymentSplit, summarize,
} from '@/services/reports/analytics';
import { formatMoney } from '@/utils/money';
import { dateKey, formatDate, now } from '@/utils/date';
import type { DayClose } from '@/types';

/* Plan §27 — daily closing. The point is the cash reconciliation: what the
   till should hold versus what was counted. */

export function DayClosePage() {
  const bills = useAppStore((s) => s.bills);
  const dayCloses = useAppStore((s) => s.dayCloses);
  const closeDay = useAppStore((s) => s.closeDay);
  const user = useAppStore((s) => s.currentUser);

  const today = new Date();
  const key = dateKey(today);
  const alreadyClosed = dayCloses.find((c) => c.date === key);

  const [actualCash, setActualCash] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);

  const view = useMemo(() => {
    const todays = billsOnDay(bills, today);
    const summary = summarize(todays);
    const payments = paymentSplit(todays);
    const expectedCash = cashInDrawer(todays);
    const online = onlineSalesTotal(todays);

    return {
      todays,
      summary,
      expectedCash,
      online,
      cash: payments.find((p) => p.method === 'cash')?.amount ?? 0,
      upi: payments.find((p) => p.method === 'upi')?.amount ?? 0,
      card: payments.find((p) => p.method === 'card')?.amount ?? 0,
    };
  }, [bills]); // eslint-disable-line react-hooks/exhaustive-deps

  const counted = Number(actualCash) || 0;
  const difference = counted - view.expectedCash;
  const hasCounted = actualCash.trim() !== '';

  async function performClose() {
    const record: DayClose = {
      id: `CLS-${key.replace(/-/g, '')}`,
      date: key,
      closedAt: now(),
      totalSales: view.summary.totalSales,
      cashSales: view.cash,
      upiSales: view.upi,
      cardSales: view.card,
      onlineSales: view.online,
      discounts: view.summary.discount,
      refunds: view.summary.refunds,
      orders: view.summary.orders,
      expectedCash: view.expectedCash,
      actualCash: counted,
      difference,
      note: note.trim() || undefined,
      closedBy: user?.name ?? 'Unknown',
    };

    await closeDay(record);
    setConfirm(false);
    toast(`Day closed · ${record.id}`, 'success');
  }

  if (alreadyClosed) {
    return (
      <div className="p-4 sm:p-5 max-w-[720px] mx-auto">
        <Card className="text-center py-10">
          <div className="w-16 h-16 rounded-full bg-success-bg grid place-items-center mx-auto mb-4">
            <CheckCircle2 size={34} className="text-success" />
          </div>
          <h1 className="text-[20px] font-extrabold text-ink">Day closed</h1>
          <p className="text-[13.5px] text-ink-3 mt-1">
            {formatDate(today)} · Closing ID {alreadyClosed.id}
          </p>

          <div className="mt-6 text-left divide-y divide-line">
            <CloseRow label="Total sales" value={formatMoney(alreadyClosed.totalSales)} />
            <CloseRow label="Orders" value={String(alreadyClosed.orders)} />
            <CloseRow label="Cash" value={formatMoney(alreadyClosed.cashSales)} />
            <CloseRow label="UPI" value={formatMoney(alreadyClosed.upiSales)} />
            <CloseRow label="Card" value={formatMoney(alreadyClosed.cardSales)} />
            <CloseRow label="Online (UPI)" value={formatMoney(alreadyClosed.onlineSales ?? 0)} />
            <CloseRow label="Discounts" value={formatMoney(alreadyClosed.discounts)} />
            <CloseRow label="Refunds" value={formatMoney(alreadyClosed.refunds)} />
            <CloseRow label="Expected cash" value={formatMoney(alreadyClosed.expectedCash)} />
            <CloseRow label="Counted cash" value={formatMoney(alreadyClosed.actualCash)} />
            <CloseRow
              label="Difference"
              value={formatMoney(alreadyClosed.difference)}
              tone={alreadyClosed.difference === 0 ? undefined : alreadyClosed.difference > 0 ? 'success' : 'danger'}
            />
            <CloseRow label="Closed by" value={alreadyClosed.closedBy} />
          </div>

          {alreadyClosed.note && (
            <p className="mt-4 p-3 rounded-xl bg-surface-2 border border-line text-[13px] text-ink-2 text-left">
              {alreadyClosed.note}
            </p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5 max-w-[720px] mx-auto space-y-4">
      <div>
        <h1 className="text-[21px] sm:text-[24px] font-extrabold text-ink">Daily Closing</h1>
        <p className="text-[13.5px] text-ink-3 mt-0.5">{formatDate(today)}</p>
      </div>

      <Card>
        <SectionTitle title="Today's takings" icon={<CalendarCheck size={17} className="text-accent" />} />
        <div className="divide-y divide-line">
          <CloseRow label="Total sales" value={formatMoney(view.summary.totalSales)} strong />
          <CloseRow label="Orders" value={String(view.summary.orders)} />
          <CloseRow label="Average bill" value={formatMoney(view.summary.avgBill)} />
          <CloseRow label="Cash sales" value={formatMoney(view.cash)} />
          <CloseRow label="UPI sales" value={formatMoney(view.upi)} />
          <CloseRow label="Card sales" value={formatMoney(view.card)} />
          <CloseRow label="Online (UPI) sales" value={formatMoney(view.online)} />
          <CloseRow label="Discounts given" value={formatMoney(view.summary.discount)} tone="danger" />
          <CloseRow label="Refunds" value={formatMoney(view.summary.refunds)} tone="danger" />
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Cash reconciliation"
          subtitle="Count the drawer and enter the total"
          icon={<Wallet size={17} className="text-accent" />}
        />

        <div className="p-4 rounded-xl bg-surface-2 border border-line mb-4">
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] text-ink-2 font-semibold">Expected in drawer</span>
            <span className="text-[20px] font-extrabold text-ink tnum">
              {formatMoney(view.expectedCash)}
            </span>
          </div>
          <p className="text-[12px] text-ink-3 mt-1">
            Cash sales only. Opening float is not included. Online (UPI) sales are
            settled by the gateway to the bank, not the drawer, and are excluded here.
          </p>
        </div>

        <Field label="Actual cash counted">
          <MoneyInput
            value={actualCash}
            onChange={(e) => setActualCash(e.target.value)}
            placeholder={String(Math.round(view.expectedCash))}
            className="text-xl h-14 text-center"
          />
        </Field>

        {hasCounted && (
          <div
            className={clsx(
              'mt-4 p-4 rounded-xl border flex items-center justify-between',
              difference === 0
                ? 'bg-success-bg border-success/20'
                : difference > 0
                  ? 'bg-info-bg border-info/20'
                  : 'bg-danger-bg border-danger/20',
            )}
          >
            <span className="flex items-center gap-2 text-[13.5px] font-bold">
              {difference === 0 ? (
                <><CheckCircle2 size={17} className="text-success" /> <span className="text-success">Drawer balances</span></>
              ) : difference > 0 ? (
                <><TrendingUp size={17} className="text-info" /> <span className="text-info">Cash over</span></>
              ) : (
                <><TrendingDown size={17} className="text-danger" /> <span className="text-danger">Cash short</span></>
              )}
            </span>
            <span
              className={clsx(
                'text-[22px] font-extrabold tnum',
                difference === 0 ? 'text-success' : difference > 0 ? 'text-info' : 'text-danger',
              )}
            >
              {difference > 0 ? '+' : ''}{formatMoney(difference)}
            </span>
          </div>
        )}

        <div className="mt-4">
          <Field label="Note" hint="Optional — explain any difference for the record.">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. ₹10 short — change given from own pocket at 6 PM"
            />
          </Field>
        </div>

        <Button
          variant="primary"
          size="xl"
          fullWidth
          className="mt-4"
          icon={<Lock size={18} />}
          disabled={!hasCounted || view.summary.orders === 0}
          onClick={() => setConfirm(true)}
        >
          Close Day
        </Button>

        {view.summary.orders === 0 && (
          <p className="text-center text-[12.5px] text-ink-3 mt-2.5">
            There are no sales to close today.
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={confirm}
        title="Close the day?"
        message={
          <>
            Today’s figures will be locked with a closing record.
            {difference !== 0 && (
              <>
                {' '}The drawer is <b>{formatMoney(Math.abs(difference))} {difference > 0 ? 'over' : 'short'}</b>
                {' '}— this will be recorded.
              </>
            )}
          </>
        }
        confirmLabel="Close day"
        tone="primary"
        onCancel={() => setConfirm(false)}
        onConfirm={performClose}
      />
    </div>
  );
}

function CloseRow({
  label, value, tone, strong,
}: { label: string; value: string; tone?: 'success' | 'danger'; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className={clsx('text-[13.5px]', strong ? 'text-ink font-semibold' : 'text-ink-2')}>
        {label}
      </span>
      <span
        className={clsx(
          'tnum font-bold',
          strong ? 'text-[17px]' : 'text-[14px]',
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
