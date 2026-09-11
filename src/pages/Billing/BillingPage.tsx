import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History, PauseCircle, Search, ShoppingCart, Trash2, User, X, ChevronUp, Receipt as ReceiptIcon,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useCartStore } from '@/store/useCartStore';
import { useDebounced, useHotkeys, useIsMobile } from '@/hooks';
import { computeBill } from '@/services/billing/calc';
import { printReceipt, shareReceipt } from '@/services/billing/receipt';
import { ProductCard, ProductRow } from '@/components/product/ProductCard';
import { CartLines, CartTotals, BillDiscountModal, HeldBillsModal } from '@/components/billing/CartPanel';
import { PaymentModal, BillSuccessModal, CustomerModal, HoldModal } from '@/components/billing/PaymentFlow';
import { Badge, Button, Chip, ChipRow, EmptyState, SearchInput, toast } from '@/components/ui';
import { formatMoney } from '@/utils/money';
import { now } from '@/utils/date';
import type { Bill, PaymentMethod, Product } from '@/types';

/* Plan §6 — the POS. Desktop runs a two-pane layout (catalogue | bill);
   mobile walks Products → Cart → Payment instead of squeezing both panes
   onto a phone. (Plan §2) */

export function BillingPage() {
  const isMobile = useIsMobile();
  const products = useAppStore((s) => s.products);
  const categories = useAppStore((s) => s.categories);
  const settings = useAppStore((s) => s.settings);
  const user = useAppStore((s) => s.currentUser);
  const reserveBillNo = useAppStore((s) => s.reserveBillNo);
  const saveBill = useAppStore((s) => s.saveBill);
  const navigate = useNavigate();

  const cart = useCartStore();
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 150);
  const searchRef = useRef<HTMLDivElement>(null);

  const [showPayment, setShowPayment] = useState(false);
  const [showBillDiscount, setShowBillDiscount] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [showHold, setShowHold] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [completed, setCompleted] = useState<Bill | null>(null);

  const computed = useMemo(
    () =>
      computeBill(cart.lines, cart.billDiscount, cart.billDiscountType, {
        pricesIncludeTax: settings.billing.pricesIncludeTax,
        roundTotals: settings.billing.roundTotals,
      }),
    [cart.lines, cart.billDiscount, cart.billDiscountType, settings.billing],
  );

  const visible = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (p.archived) return false;
      if (category !== 'all' && p.categoryId !== category) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q);
    });
  }, [products, category, debouncedQuery]);

  const qtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
    return m;
  }, [cart.lines]);

  const itemCount = cart.lines.reduce((a, l) => a + l.qty, 0);
  const canPay = cart.lines.length > 0;

  /* Keyboard shortcuts — desktop speed. (Plan §28) */
  useHotkeys({
    'ctrl+k': () => searchRef.current?.querySelector('input')?.focus(),
    'ctrl+enter': () => canPay && setShowPayment(true),
    'ctrl+d': () => canPay && setShowBillDiscount(true),
    'ctrl+h': () => canPay && setShowHold(true),
    'ctrl+shift+c': () => { if (canPay) { cart.clear(); toast('Bill cleared'); } },
    escape: () => { setQuery(''); (document.activeElement as HTMLElement)?.blur(); },
  });

  async function completeBill(payment: PaymentMethod, cashReceived?: number, change?: number) {
    const { seq, billNo } = await reserveBillNo();
    const bill: Bill = {
      id: `bill-${seq}`,
      billNo,
      seq,
      createdAt: now(),
      lines: cart.lines,
      billDiscount: cart.billDiscount,
      billDiscountType: cart.billDiscountType,
      totals: computed.totals,
      payment,
      cashReceived,
      change,
      status: 'completed',
      customerName: cart.customerName || undefined,
      customerPhone: cart.customerPhone || undefined,
      cashierId: user?.id ?? 'unknown',
      cashierName: user?.name ?? 'Unknown',
      note: cart.note || undefined,
      synced: 0, // queued for sync; the sale is already safe on this device
    };

    await saveBill(bill);
    cart.clear();
    setShowPayment(false);
    setShowCartSheet(false);
    setCompleted(bill);

    if (settings.receipt.autoPrint) printReceipt(bill, settings);
  }

  return (
    <div className="h-full flex flex-col md:flex-row min-h-0">
      {/* ---------- Catalogue ---------- */}
      <section className="flex-1 flex flex-col min-h-0 min-w-0">
        <div className="p-3 sm:p-4 pb-2 space-y-3 shrink-0">
          <div ref={searchRef} className="flex gap-2">
            <div className="flex-1">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={isMobile ? 'Search…' : 'Search products…  (Ctrl+K)'}
              />
            </div>
            <Button
              variant="outline"
              icon={<PauseCircle size={17} />}
              onClick={() => setShowHeld(true)}
              className="shrink-0"
            >
              {cart.held.length > 0 ? cart.held.length : ''}
            </Button>
            <Button
              variant="outline"
              icon={<History size={17} />}
              onClick={() => navigate('/billing/history')}
              className="shrink-0 hidden sm:inline-flex"
            >
              History
            </Button>
          </div>

          <ChipRow>
            <Chip active={category === 'all'} onClick={() => setCategory('all')}>
              All
            </Chip>
            {categories.map((c) => (
              <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
                {c.icon} {c.name}
              </Chip>
            ))}
          </ChipRow>
        </div>

        <div className="flex-1 overflow-y-auto px-3 sm:px-4 pb-4">
          {visible.length === 0 ? (
            <EmptyState
              icon={<Search size={22} />}
              title="No products found"
              description={
                query
                  ? `Nothing matches “${query}”. Check the spelling or clear the search.`
                  : 'This category has no products yet.'
              }
            />
          ) : settings.appearance.showProductImages ? (
            <div className="grid grid-cols-2 xs:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2.5 sm:gap-3">
              {visible.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onAdd={handleAdd}
                  inCart={qtyByProduct.get(p.id) ?? 0}
                  compact={settings.appearance.cardStyle === 'compact'}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {visible.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  onAdd={handleAdd}
                  inCart={qtyByProduct.get(p.id) ?? 0}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---------- Bill pane (desktop / tablet) ---------- */}
      {!isMobile && (
        <aside className="w-[380px] xl:w-[420px] shrink-0 border-l border-line bg-surface flex flex-col min-h-0">
          <CartHeader
            itemCount={itemCount}
            customerName={cart.customerName}
            onCustomer={() => setShowCustomer(true)}
            onClear={() => { cart.clear(); toast('Bill cleared'); }}
          />

          <div className="flex-1 overflow-y-auto px-4 min-h-0">
            {cart.lines.length === 0 ? (
              <EmptyState
                icon={<ShoppingCart size={22} />}
                title="No items yet"
                description="Tap a product to start the bill."
              />
            ) : (
              <CartLines computed={computed} />
            )}
          </div>

          {cart.lines.length > 0 && (
            <div className="border-t border-line p-4 space-y-3.5 shrink-0 bg-surface-2/40">
              <CartTotals
                computed={computed}
                currency={settings.business.currency}
                onEditBillDiscount={() => setShowBillDiscount(true)}
              />

              <div className="grid grid-cols-2 gap-2.5">
                <Button variant="secondary" icon={<PauseCircle size={17} />} onClick={() => setShowHold(true)}>
                  Hold
                </Button>
                <Button variant="secondary" icon={<User size={17} />} onClick={() => setShowCustomer(true)}>
                  Customer
                </Button>
              </div>

              <Button variant="primary" size="xl" fullWidth onClick={() => setShowPayment(true)}>
                Complete Bill · {formatMoney(computed.totals.total, settings.business.currency)}
              </Button>
              <p className="text-center text-[11px] text-ink-3">Ctrl+Enter to pay · Ctrl+D discount</p>
            </div>
          )}
        </aside>
      )}

      {/* ---------- Mobile cart bar + sheet ---------- */}
      {isMobile && itemCount > 0 && !showCartSheet && (
        <button
          onClick={() => setShowCartSheet(true)}
          className="fixed left-3 right-3 bottom-[80px] z-30 h-14 rounded-2xl bg-accent text-accent-fg shadow-[var(--shadow-lg)] flex items-center gap-3 px-4 active:scale-[0.98] transition"
        >
          <span className="w-8 h-8 rounded-xl bg-black/15 grid place-items-center text-[14px] font-extrabold">
            {itemCount}
          </span>
          <span className="flex-1 text-left text-[14.5px] font-bold">View bill</span>
          <span className="text-[17px] font-extrabold tnum">
            {formatMoney(computed.totals.total, settings.business.currency)}
          </span>
          <ChevronUp size={18} />
        </button>
      )}

      {isMobile && showCartSheet && (
        <div className="fixed inset-0 z-40 flex flex-col">
          <div className="absolute inset-0 bg-black/45" onClick={() => setShowCartSheet(false)} />
          <div className="relative mt-auto bg-surface rounded-t-3xl border-t border-line flex flex-col max-h-[88vh] animate-sheet">
            <CartHeader
              itemCount={itemCount}
              customerName={cart.customerName}
              onCustomer={() => setShowCustomer(true)}
              onClear={() => { cart.clear(); setShowCartSheet(false); toast('Bill cleared'); }}
              onClose={() => setShowCartSheet(false)}
            />

            <div className="flex-1 overflow-y-auto px-4 min-h-0">
              <CartLines computed={computed} />
            </div>

            <div className="border-t border-line p-4 space-y-3.5 safe-b bg-surface-2/40">
              <CartTotals
                computed={computed}
                currency={settings.business.currency}
                onEditBillDiscount={() => setShowBillDiscount(true)}
              />
              <div className="grid grid-cols-2 gap-2.5">
                <Button variant="secondary" icon={<PauseCircle size={17} />} onClick={() => setShowHold(true)}>
                  Hold
                </Button>
                <Button variant="secondary" icon={<User size={17} />} onClick={() => setShowCustomer(true)}>
                  Customer
                </Button>
              </div>
              <Button variant="primary" size="xl" fullWidth onClick={() => setShowPayment(true)}>
                Complete Bill · {formatMoney(computed.totals.total, settings.business.currency)}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Modals ---------- */}
      <PaymentModal
        open={showPayment}
        total={computed.totals.total}
        enabled={settings.billing.enabledPayments}
        upiId={settings.business.email.includes('@') ? `${settings.business.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@upi` : 'merchant@upi'}
        businessName={settings.business.name}
        onCancel={() => setShowPayment(false)}
        onConfirm={completeBill}
      />

      <BillSuccessModal
        bill={completed}
        onNewBill={() => setCompleted(null)}
        onPrint={() => completed && printReceipt(completed, settings)}
        onShare={async () => {
          if (!completed) return;
          const r = await shareReceipt(completed, settings);
          if (r === 'copied') toast('Receipt copied to clipboard', 'success');
          else if (r === 'failed') toast('Could not share the receipt', 'danger');
        }}
      />

      <BillDiscountModal
        open={showBillDiscount}
        onClose={() => setShowBillDiscount(false)}
        maxPercent={settings.billing.maxDiscountPercent}
        subtotal={computed.totals.subtotal - computed.totals.itemDiscount}
      />

      <HeldBillsModal open={showHeld} onClose={() => setShowHeld(false)} />

      <HoldModal open={showHold} onClose={() => setShowHold(false)} onHold={(label) => cart.hold(label)} />

      <CustomerModal
        open={showCustomer}
        onClose={() => setShowCustomer(false)}
        name={cart.customerName}
        phone={cart.customerPhone}
        onSave={cart.setCustomer}
      />
    </div>
  );

  function handleAdd(p: Product) {
    cart.addProduct(p);
  }
}

function CartHeader({
  itemCount, customerName, onCustomer, onClear, onClose,
}: {
  itemCount: number;
  customerName: string;
  onCustomer: () => void;
  onClear: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 h-14 border-b border-line shrink-0">
      <ReceiptIcon size={18} className="text-accent shrink-0" />
      <h2 className="text-[15px] font-extrabold text-ink">Current Bill</h2>
      {itemCount > 0 && <Badge tone="accent">{itemCount}</Badge>}

      <div className="ml-auto flex items-center gap-1">
        {customerName && (
          <button
            onClick={onCustomer}
            className="text-[12.5px] font-semibold text-accent px-2 py-1 rounded-lg hover:bg-accent-50 max-w-[110px] truncate"
          >
            {customerName}
          </button>
        )}
        {itemCount > 0 && (
          <button
            onClick={onClear}
            className="p-2 rounded-xl text-ink-3 hover:bg-danger-bg hover:text-danger transition"
            aria-label="Clear bill"
          >
            <Trash2 size={16} />
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-ink-3 hover:bg-surface-3 transition"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
