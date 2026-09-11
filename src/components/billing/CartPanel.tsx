import { useState } from 'react';
import { Minus, Plus, Trash2, Tag, StickyNote, X } from 'lucide-react';
import clsx from 'clsx';
import type { BillLine, DiscountType } from '@/types';
import type { ComputedBill } from '@/services/billing/calc';
import { useCartStore } from '@/store/useCartStore';
import { Badge, Button, Field, Input, MoneyInput, Modal, Segmented } from '@/components/ui';
import { formatMoney, toRupees } from '@/utils/money';

/* The bill pane. Quantity steppers are deliberately large: this is used
   with a thumb, at speed, often one-handed. */

export function CartLines({ computed }: { computed: ComputedBill }) {
  const { increment, decrement, removeLine } = useCartStore();
  const [editing, setEditing] = useState<BillLine | null>(null);

  return (
    <>
      <ul className="divide-y divide-line">
        {computed.lines.map((c) => {
          const l = c.line;
          const hasDiscount = c.itemDiscountPaise > 0 || c.billDiscountSharePaise > 0;

          return (
            <li key={l.id} className="py-3 first:pt-0 group">
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-ink leading-snug">{l.name}</p>
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
                    <span className="text-[12.5px] text-ink-3 tnum">
                      {formatMoney(l.unitPrice)} × {l.qty}
                    </span>
                    {c.itemDiscountPaise > 0 && (
                      <Badge tone="danger">
                        −{formatMoney(toRupees(c.itemDiscountPaise))}
                      </Badge>
                    )}
                    {l.taxRate > 0 && <span className="text-[11.5px] text-ink-3">GST {l.taxRate}%</span>}
                  </div>
                  {l.note && (
                    <p className="text-[12px] text-accent-700 dark:text-accent-300 mt-1 flex items-center gap-1">
                      <StickyNote size={11} /> {l.note}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-[15px] font-extrabold text-ink tnum">
                    {formatMoney(toRupees(c.totalPaise))}
                  </p>
                  {hasDiscount && (
                    <p className="text-[11.5px] text-ink-3 line-through tnum">
                      {formatMoney(toRupees(c.grossPaise))}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 mt-2.5">
                <div className="flex items-center bg-surface-3 rounded-xl overflow-hidden">
                  <button
                    onClick={() => decrement(l.id)}
                    className="w-9 h-9 grid place-items-center text-ink-2 hover:bg-line active:scale-90 transition"
                    aria-label={`Reduce ${l.name}`}
                  >
                    <Minus size={15} strokeWidth={2.75} />
                  </button>
                  <span className="w-9 text-center text-[14.5px] font-extrabold text-ink tnum">{l.qty}</span>
                  <button
                    onClick={() => increment(l.id)}
                    className="w-9 h-9 grid place-items-center text-ink-2 hover:bg-line active:scale-90 transition"
                    aria-label={`Add another ${l.name}`}
                  >
                    <Plus size={15} strokeWidth={2.75} />
                  </button>
                </div>

                <button
                  onClick={() => setEditing(l)}
                  className={clsx(
                    'h-9 px-2.5 rounded-xl text-[12.5px] font-bold inline-flex items-center gap-1.5 transition',
                    l.discount > 0
                      ? 'bg-danger-bg text-danger'
                      : 'text-ink-3 hover:bg-surface-3 hover:text-ink',
                  )}
                >
                  <Tag size={13} />
                  {l.discount > 0
                    ? l.discountType === 'percent' ? `${l.discount}%` : formatMoney(l.discount)
                    : 'Discount'}
                </button>

                <button
                  onClick={() => removeLine(l.id)}
                  className="w-9 h-9 ml-auto grid place-items-center rounded-xl text-ink-3 hover:bg-danger-bg hover:text-danger transition"
                  aria-label={`Remove ${l.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <LineDiscountModal line={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function LineDiscountModal({ line, onClose }: { line: BillLine | null; onClose: () => void }) {
  const setLineDiscount = useCartStore((s) => s.setLineDiscount);
  const setLineNote = useCartStore((s) => s.setLineNote);

  const [value, setValue] = useState(0);
  const [type, setType] = useState<DiscountType>('percent');
  const [note, setNote] = useState('');
  const [key, setKey] = useState('');

  // Re-seed local state whenever a different line is opened.
  if (line && key !== line.id) {
    setKey(line.id);
    setValue(line.discount);
    setType(line.discountType);
    setNote(line.note ?? '');
  }

  if (!line) return null;

  const apply = () => {
    setLineDiscount(line.id, value, type);
    setLineNote(line.id, note.trim());
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={line.name}
      size="sm"
      footer={
        <div className="flex gap-2.5">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => { setLineDiscount(line.id, 0, 'percent'); setLineNote(line.id, ''); onClose(); }}
          >
            Clear
          </Button>
          <Button variant="primary" fullWidth onClick={apply}>Apply</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Discount type">
          <Segmented
            fullWidth
            value={type}
            onChange={setType}
            options={[
              { value: 'percent', label: 'Percentage' },
              { value: 'fixed', label: 'Fixed ₹' },
            ]}
          />
        </Field>

        <Field
          label={type === 'percent' ? 'Discount %' : 'Discount per unit'}
          hint={type === 'fixed' ? 'Applied to each unit on this line.' : undefined}
        >
          {type === 'percent' ? (
            <Input
              type="number"
              min={0}
              max={100}
              value={value || ''}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setValue(Math.min(100, Math.max(0, Number(e.target.value))))}
              className="tnum font-semibold"
            />
          ) : (
            <MoneyInput
              value={value || ''}
              onChange={(e) => setValue(Math.max(0, Number(e.target.value)))}
            />
          )}
        </Field>

        <div className="flex gap-2">
          {(type === 'percent' ? [5, 10, 15, 20] : [2, 5, 10, 20]).map((q) => (
            <button
              key={q}
              onClick={() => setValue(q)}
              className="flex-1 h-9 rounded-xl bg-surface-3 text-[13px] font-bold text-ink-2 hover:bg-accent hover:text-accent-fg transition"
            >
              {type === 'percent' ? `${q}%` : `₹${q}`}
            </button>
          ))}
        </div>

        <Field label="Note" hint="Shows on the kitchen ticket — e.g. less sugar.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- Totals ---------------- */

export function CartTotals({
  computed, currency = '₹', onEditBillDiscount,
}: {
  computed: ComputedBill;
  currency?: string;
  onEditBillDiscount?: () => void;
}) {
  const t = computed.totals;

  return (
    <div className="space-y-1.5 text-[13.5px]">
      <Row label="Subtotal" value={formatMoney(t.subtotal, currency)} />

      {t.itemDiscount > 0 && (
        <Row label="Item discount" value={`−${formatMoney(t.itemDiscount, currency)}`} tone="danger" />
      )}

      {(t.billDiscount > 0 || onEditBillDiscount) && (
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onEditBillDiscount}
            className={clsx(
              'text-left inline-flex items-center gap-1.5',
              onEditBillDiscount ? 'text-accent font-semibold hover:underline' : 'text-ink-2',
            )}
          >
            <Tag size={13} />
            Bill discount
          </button>
          <span className={clsx('font-semibold tnum', t.billDiscount > 0 ? 'text-danger' : 'text-ink-3')}>
            {t.billDiscount > 0 ? `−${formatMoney(t.billDiscount, currency)}` : '—'}
          </span>
        </div>
      )}

      {computed.taxBreakup.map((b) => (
        <Row key={b.rate} label={`GST ${b.rate}%`} value={formatMoney(b.tax, currency)} muted />
      ))}

      <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-line">
        <span className="text-[15px] font-extrabold text-ink">TOTAL</span>
        <span className="text-[22px] font-extrabold text-ink tnum">{formatMoney(t.total, currency)}</span>
      </div>
    </div>
  );
}

function Row({
  label, value, tone, muted,
}: { label: string; value: string; tone?: 'danger'; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={clsx(muted ? 'text-ink-3' : 'text-ink-2')}>{label}</span>
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

/* ---------------- Bill discount modal ---------------- */

export function BillDiscountModal({
  open, onClose, maxPercent, subtotal,
}: { open: boolean; onClose: () => void; maxPercent: number; subtotal: number }) {
  const billDiscount = useCartStore((s) => s.billDiscount);
  const billDiscountType = useCartStore((s) => s.billDiscountType);
  const setBillDiscount = useCartStore((s) => s.setBillDiscount);

  const [value, setValue] = useState(billDiscount);
  const [type, setType] = useState<DiscountType>(billDiscountType);
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) {
    setWasOpen(true);
    setValue(billDiscount);
    setType(billDiscountType);
  }
  if (!open && wasOpen) setWasOpen(false);

  const overLimit = type === 'percent' && value > maxPercent;
  const preview = type === 'percent' ? (subtotal * value) / 100 : Math.min(value, subtotal);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bill discount"
      size="sm"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" fullWidth onClick={() => { setBillDiscount(0, 'percent'); onClose(); }}>
            Clear
          </Button>
          <Button
            variant="primary"
            fullWidth
            disabled={overLimit}
            onClick={() => { setBillDiscount(value, type); onClose(); }}
          >
            Apply
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Segmented
          fullWidth
          value={type}
          onChange={setType}
          options={[
            { value: 'percent', label: 'Percentage' },
            { value: 'fixed', label: 'Fixed ₹' },
          ]}
        />

        <Field
          label={type === 'percent' ? 'Discount %' : 'Discount amount'}
          error={overLimit ? `Above the ${maxPercent}% limit set in Billing settings.` : undefined}
        >
          {type === 'percent' ? (
            <Input
              type="number"
              min={0}
              max={100}
              value={value || ''}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setValue(Math.max(0, Number(e.target.value)))}
              invalid={overLimit}
              className="tnum font-semibold text-lg"
            />
          ) : (
            <MoneyInput
              autoFocus
              value={value || ''}
              onChange={(e) => setValue(Math.max(0, Number(e.target.value)))}
              className="text-lg"
            />
          )}
        </Field>

        <div className="flex gap-2">
          {(type === 'percent' ? [5, 10, 15, 20] : [10, 20, 50, 100]).map((q) => (
            <button
              key={q}
              onClick={() => setValue(q)}
              className="flex-1 h-10 rounded-xl bg-surface-3 text-[13.5px] font-bold text-ink-2 hover:bg-accent hover:text-accent-fg transition"
            >
              {type === 'percent' ? `${q}%` : `₹${q}`}
            </button>
          ))}
        </div>

        {value > 0 && !overLimit && (
          <div className="p-3 rounded-xl bg-surface-2 border border-line flex items-center justify-between">
            <span className="text-[13px] text-ink-2">Customer saves</span>
            <span className="text-[16px] font-extrabold text-success tnum">−{formatMoney(preview)}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- Held bills (Plan §28) ---------------- */

export function HeldBillsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const held = useCartStore((s) => s.held);
  const resume = useCartStore((s) => s.resume);
  const dropHeld = useCartStore((s) => s.dropHeld);

  return (
    <Modal open={open} onClose={onClose} title={`Held bills (${held.length})`} size="md">
      {held.length === 0 ? (
        <p className="text-[14px] text-ink-3 py-8 text-center">
          No held bills. Use <b>Hold</b> to park an order and start a new one.
        </p>
      ) : (
        <div className="space-y-2.5">
          {held.map((h) => {
            const items = h.lines.reduce((a, l) => a + l.qty, 0);
            const value = h.lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
            return (
              <div key={h.id} className="flex items-center gap-3 p-3.5 rounded-xl border border-line bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold text-ink truncate">{h.label}</p>
                  <p className="text-[12.5px] text-ink-3 tnum">
                    {items} item{items > 1 ? 's' : ''} · {formatMoney(value)} ·{' '}
                    {new Date(h.heldAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
                <Button size="sm" variant="primary" onClick={() => { resume(h.id); onClose(); }}>
                  Resume
                </Button>
                <button
                  onClick={() => dropHeld(h.id)}
                  className="w-9 h-9 grid place-items-center rounded-xl text-ink-3 hover:bg-danger-bg hover:text-danger"
                  aria-label={`Discard ${h.label}`}
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
