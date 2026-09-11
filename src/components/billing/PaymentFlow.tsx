import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, CheckCircle2, CreditCard, Loader2, Printer, Share2,
  Smartphone, X, ArrowLeft,
} from 'lucide-react';
import clsx from 'clsx';
import type { Bill, PaymentMethod } from '@/types';
import { Button, Field, Input, Modal, toast } from '@/components/ui';
import { formatMoney, roundToRupee } from '@/utils/money';
import { upiQrDataUrl, upiUri } from '@/services/billing/upi';

/* Plan §12 — payment. Cash is the default because it needs the most
   interaction (tender + change); UPI and card are one tap each. */

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote; hint: string }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote, hint: 'Count change' },
  { id: 'upi', label: 'UPI', icon: Smartphone, hint: 'Scan QR' },
  { id: 'card', label: 'Card', icon: CreditCard, hint: 'Swipe / tap' },
];

export function PaymentModal({
  open, total, enabled, upiId, businessName, onCancel, onConfirm,
}: {
  open: boolean;
  total: number;
  enabled: PaymentMethod[];
  upiId: string;
  businessName: string;
  onCancel: () => void;
  onConfirm: (payment: PaymentMethod, cashReceived?: number, change?: number) => void;
}) {
  const available = METHODS.filter((m) => enabled.includes(m.id));
  const [method, setMethod] = useState<PaymentMethod>(available[0]?.id ?? 'cash');
  const [received, setReceived] = useState<string>('');
  const [upiWaiting, setUpiWaiting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMethod(available[0]?.id ?? 'cash');
    setReceived('');
    setUpiWaiting(false);
    setBusy(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const receivedNum = Number(received) || 0;
  const change = Math.max(0, receivedNum - total);
  const shortfall = Math.max(0, total - receivedNum);
  const canConfirmCash = receivedNum >= total;

  // Denominations a customer would realistically hand over.
  const suggestions = useMemo(() => {
    const exact = roundToRupee(Math.ceil(total));
    const set = new Set<number>([exact]);
    for (const step of [10, 50, 100, 500]) {
      const up = Math.ceil(total / step) * step;
      if (up >= total) set.add(up);
    }
    for (const note of [100, 200, 500, 2000]) if (note >= total) set.add(note);
    return [...set].sort((a, b) => a - b).slice(0, 5);
  }, [total]);

  function confirm() {
    setBusy(true);
    if (method === 'cash') onConfirm('cash', receivedNum, change);
    else onConfirm(method);
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Payment"
      size="md"
      dismissable={!busy}
      footer={
        method === 'upi' && upiWaiting ? (
          <div className="flex gap-2.5">
            <Button variant="secondary" fullWidth onClick={() => setUpiWaiting(false)}>Cancel</Button>
            <Button variant="success" fullWidth loading={busy} onClick={confirm}>Payment Received</Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={method === 'cash' && !canConfirmCash}
            onClick={() => (method === 'upi' ? setUpiWaiting(true) : confirm())}
          >
            {method === 'cash'
              ? canConfirmCash ? `Complete · Change ${formatMoney(change)}` : `Short by ${formatMoney(shortfall)}`
              : method === 'upi'
                ? 'Show QR Code'
                : 'Complete Payment'}
          </Button>
        )
      }
    >
      <div className="text-center mb-5">
        <p className="text-[12px] font-bold text-ink-3 uppercase tracking-wider">Total amount</p>
        <p className="text-[40px] leading-tight font-extrabold text-ink tnum">{formatMoney(total)}</p>
      </div>

      {method === 'upi' && upiWaiting ? (
        <UpiWaiting total={total} upiId={upiId} businessName={businessName} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {available.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={clsx(
                  'flex flex-col items-center justify-center gap-1.5 py-4 rounded-2xl border-2 transition-all',
                  method === m.id
                    ? 'border-accent bg-accent-50 text-accent-700 dark:text-accent-300'
                    : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong',
                )}
              >
                <m.icon size={24} strokeWidth={method === m.id ? 2.5 : 2} />
                <span className="text-[13.5px] font-bold">{m.label}</span>
                <span className="text-[11px] text-ink-3">{m.hint}</span>
              </button>
            ))}
          </div>

          {method === 'cash' && (
            <div className="space-y-3.5">
              <Field label="Cash received">
                <Input
                  type="number"
                  inputMode="decimal"
                  autoFocus
                  value={received}
                  placeholder="Enter amount"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setReceived(e.target.value)}
                  className="tnum font-extrabold text-xl h-14 text-center"
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => setReceived(String(s))}
                    className="flex-1 min-w-[68px] h-11 rounded-xl bg-surface-3 text-[14px] font-bold text-ink hover:bg-accent hover:text-accent-fg transition tnum"
                  >
                    {i === 0 && s === Math.ceil(total) ? `Exact ₹${s}` : `₹${s}`}
                  </button>
                ))}
              </div>

              <div
                className={clsx(
                  'flex items-center justify-between p-4 rounded-xl border',
                  canConfirmCash ? 'bg-success-bg border-success/20' : 'bg-surface-2 border-line',
                )}
              >
                <span className="text-[14px] font-semibold text-ink-2">
                  {canConfirmCash ? 'Change to return' : 'Still needed'}
                </span>
                <span
                  className={clsx(
                    'text-[24px] font-extrabold tnum',
                    canConfirmCash ? 'text-success' : 'text-ink-3',
                  )}
                >
                  {formatMoney(canConfirmCash ? change : shortfall)}
                </span>
              </div>
            </div>
          )}

          {method === 'card' && (
            <div className="p-5 rounded-xl bg-surface-2 border border-line text-center">
              <CreditCard size={30} className="mx-auto text-ink-3 mb-3" />
              <p className="text-[14px] font-semibold text-ink">Complete the payment on the card machine</p>
              <p className="text-[13px] text-ink-3 mt-1.5 leading-relaxed">
                Then confirm here to record the sale.
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function UpiWaiting({ total, upiId, businessName }: { total: number; upiId: string; businessName: string }) {
  const qr = useMemo(
    () => upiQrDataUrl(upiUri({ pa: upiId, pn: businessName, am: total })),
    [upiId, businessName, total],
  );

  return (
    <div className="text-center">
      <div className="inline-block p-4 bg-white rounded-2xl border border-line shadow-[var(--shadow-sm)]">
        <img src={qr} alt="UPI QR code" className="w-52 h-52 [image-rendering:pixelated]" />
      </div>
      <p className="text-[13px] text-ink-2 mt-3.5 font-semibold">{upiId}</p>
      <p className="flex items-center justify-center gap-2 text-[13.5px] text-ink-3 mt-4">
        <Loader2 size={15} className="animate-spin" />
        Waiting for payment…
      </p>
      <p className="text-[12px] text-ink-3 mt-2.5 leading-relaxed max-w-xs mx-auto">
        Confirm once the money lands in your account. Payment-gateway verification
        arrives in a later version.
      </p>
    </div>
  );
}

/* ---------------- Success (Plan §13) ---------------- */

export function BillSuccessModal({
  bill, onNewBill, onPrint, onShare,
}: {
  bill: Bill | null;
  onNewBill: () => void;
  onPrint: () => void;
  onShare: () => void;
}) {
  // Enter / N starts the next bill without reaching for the mouse.
  useEffect(() => {
    if (!bill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onNewBill();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bill, onNewBill]);

  if (!bill) return null;

  const methodLabel = bill.payment === 'upi' ? 'UPI' : bill.payment === 'cash' ? 'Cash' : 'Card';

  return (
    <Modal open onClose={onNewBill} size="sm" dismissable={false}>
      <div className="text-center py-2">
        <div className="w-16 h-16 rounded-full bg-success-bg grid place-items-center mx-auto mb-4">
          <CheckCircle2 size={34} className="text-success" strokeWidth={2.25} />
        </div>

        <p className="text-[17px] font-extrabold text-ink">Payment successful</p>
        <p className="text-[13.5px] text-ink-3 mt-1">Bill {bill.billNo}</p>

        <p className="text-[38px] leading-tight font-extrabold text-ink tnum mt-4">
          {formatMoney(bill.totals.total)}
        </p>
        <p className="text-[13.5px] text-ink-2 mt-1 font-semibold">Paid by {methodLabel}</p>

        {bill.payment === 'cash' && (bill.change ?? 0) > 0 && (
          <div className="mt-4 p-3.5 rounded-xl bg-warning-bg border border-warning/20">
            <p className="text-[12.5px] font-bold text-warning uppercase tracking-wide">Return change</p>
            <p className="text-[26px] font-extrabold text-warning tnum mt-0.5">{formatMoney(bill.change!)}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 mt-6">
          <Button variant="secondary" icon={<Printer size={17} />} onClick={onPrint}>Print</Button>
          <Button variant="secondary" icon={<Share2 size={17} />} onClick={onShare}>Share</Button>
        </div>

        <Button variant="primary" size="lg" fullWidth className="mt-2.5" onClick={onNewBill}>
          New Bill
        </Button>
        <p className="text-[11.5px] text-ink-3 mt-3">Press Enter to start the next bill</p>
      </div>
    </Modal>
  );
}

/* ---------------- Customer details ---------------- */

export function CustomerModal({
  open, onClose, name, phone, onSave,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  phone: string;
  onSave: (name: string, phone: string) => void;
}) {
  const [n, setN] = useState(name);
  const [p, setP] = useState(phone);
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) { setWasOpen(true); setN(name); setP(phone); }
  if (!open && wasOpen) setWasOpen(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customer details"
      size="sm"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" fullWidth onClick={() => { onSave('', ''); onClose(); }}>Clear</Button>
          <Button variant="primary" fullWidth onClick={() => { onSave(n.trim(), p.trim()); onClose(); }}>Save</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name" hint="Optional — helps when reprinting a bill later.">
          <Input value={n} autoFocus onChange={(e) => setN(e.target.value)} placeholder="Customer name" />
        </Field>
        <Field label="Phone">
          <Input
            value={p}
            type="tel"
            inputMode="numeric"
            onChange={(e) => setP(e.target.value.replace(/[^\d+ ]/g, ''))}
            placeholder="+91"
          />
        </Field>
      </div>
    </Modal>
  );
}

export function HoldModal({
  open, onClose, onHold,
}: { open: boolean; onClose: () => void; onHold: (label: string) => void }) {
  const [label, setLabel] = useState('');

  useEffect(() => { if (open) setLabel(''); }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hold this bill"
      size="sm"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            fullWidth
            onClick={() => { onHold(label.trim()); onClose(); toast('Bill held', 'success'); }}
          >
            Hold
          </Button>
        </div>
      }
    >
      <Field label="Label" hint="Something you will recognise — a table number or the customer’s name.">
        <Input
          value={label}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Table 4"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onHold(label.trim()); onClose(); toast('Bill held', 'success'); }
          }}
        />
      </Field>
    </Modal>
  );
}

export { X, ArrowLeft };
