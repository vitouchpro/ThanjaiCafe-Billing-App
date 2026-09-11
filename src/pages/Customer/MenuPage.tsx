import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Minus, Plus, QrCode, ShoppingBag, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { fetchPublishedMenu, type MenuRow } from '@/services/cloud/menu';
import { isCloudConfigured } from '@/services/cloud/client';
import { useCustomerCart, cartTotals, MAX_QTY } from '@/features/customer/useCustomerCart';
import { Badge, Button, EmptyState, Spinner, Skeleton } from '@/components/ui';
import { formatMoney } from '@/utils/money';
import { initialsOf } from '@/components/product/ProductThumb';

/* The first screen a diner sees after scanning the table QR. No cost price
   is ever in scope here — fetchPublishedMenu's shape doesn't carry one. */

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: MenuRow[] };

export function MenuPage() {
  const [params] = useSearchParams();
  const tableCode = params.get('t');
  const setTable = useCustomerCart((s) => s.setTable);

  useEffect(() => {
    if (tableCode) setTable(tableCode);
  }, [tableCode, setTable]);

  if (!tableCode) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<QrCode size={24} />}
          title="Scan the QR code on your table to order"
          description="This link is missing your table. Ask a staff member, or scan the code on your table to open the menu."
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
          description="This cafe hasn't set up online ordering yet. Please order at the counter."
        />
      </div>
    );
  }

  return <MenuContent />;
}

/* A hungry diner at a table should never read "TypeError: Failed to fetch".
   A dropped connection is by far the most likely failure here — a phone on
   patchy cafe wifi — and it is the one the customer can actually do something
   about, so it gets plain words and a Retry. Anything else keeps its message,
   because a real server error is something staff need to be told. */
function dinerFacing(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (raw === 'TIMED_OUT') {
    return 'The menu is taking too long to load. Check your connection and try again, or order at the counter.';
  }
  if (/failed to fetch|networkerror|load failed|ERR_/i.test(raw)) {
    return 'Your phone could not reach the menu. Check your connection and try again, or order at the counter.';
  }
  return raw || 'Something went wrong loading the menu.';
}

function MenuContent() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  // `attempt` is the one thing Retry changes; bumping it (rather than calling
  // setState synchronously inside the effect) re-runs the fetch below without
  // a same-render setState-in-effect. The loading state for a retry is set at
  // the click site, in reload(), which is the event that caused it.
  useEffect(() => {
    let cancelled = false;

    /* Fail fast rather than leaving a diner watching a spinner. A browser can
       sit on a dead connection for tens of seconds before giving up; someone
       standing at a table with a phone gives up long before that, and staring
       at a spinner tells them nothing they can act on. Ten seconds is past a
       slow-but-working load and well short of the browser's own patience. */
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMED_OUT')), 10_000),
    );

    Promise.race([fetchPublishedMenu(), timeout])
      .then((rows) => { if (!cancelled) setState({ status: 'ready', rows }); })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: dinerFacing(err) });
      });

    return () => { cancelled = true; };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((a) => a + 1);
  }, []);

  const categories = useMemo(() => {
    if (state.status !== 'ready') return [];
    const byCat = new Map<string, MenuRow[]>();
    for (const row of state.rows) {
      const list = byCat.get(row.category_name) ?? [];
      list.push(row);
      byCat.set(row.category_name, list);
    }
    for (const list of byCat.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    }
    return [...byCat.entries()]
      .map(([name, items]) => ({ name, items, sortOrder: items[0]?.sort_order ?? 0 }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [state]);

  const scrollTo = (name: string) => {
    sectionRefs.current.get(name)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (state.status === 'loading') {
    return (
      <div className="px-4 py-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<TriangleAlert size={24} />}
          title="Could not load the menu"
          description={state.message}
          action={<Button variant="primary" onClick={reload}>Retry</Button>}
        />
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="px-4 py-10">
        <EmptyState
          icon={<ShoppingBag size={24} />}
          title="The menu isn't ready yet"
          description="This cafe hasn't published a menu. Please check back shortly, or order at the counter."
        />
      </div>
    );
  }

  return (
    <div className="pb-28">
      <div className="sticky top-[57px] z-10 bg-bg/95 backdrop-blur border-b border-line">
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 py-2.5">
          {categories.map((c) => (
            <button
              key={c.name}
              onClick={() => scrollTo(c.name)}
              className="shrink-0 h-9 px-3.5 rounded-xl text-[13.5px] font-semibold bg-surface text-ink-2 border border-line hover:border-line-strong hover:text-ink whitespace-nowrap transition-all"
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-7">
        {categories.map((c) => (
          <section
            key={c.name}
            ref={(el) => {
              if (el) sectionRefs.current.set(c.name, el);
              else sectionRefs.current.delete(c.name);
            }}
            className="scroll-mt-[110px]"
          >
            <h2 className="text-[15px] font-bold text-ink mb-3">{c.name}</h2>
            <div className="flex flex-col gap-3">
              {c.items.map((item) => (
                <MenuItemRow key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <CartBar />
    </div>
  );
}

function MenuItemRow({ item }: { item: MenuRow }) {
  const inCart = useCustomerCart((s) => s.items.find((i) => i.id === item.id)?.qty ?? 0);
  const add = useCustomerCart((s) => s.add);
  const setQty = useCustomerCart((s) => s.setQty);
  const disabled = !item.available;

  return (
    <div
      className={clsx(
        'flex gap-3 p-3 rounded-2xl border bg-surface transition-all',
        disabled ? 'opacity-55 border-line' : 'border-line',
      )}
    >
      <div className="w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-surface-2 relative">
        <MenuThumb name={item.name} image={item.image_url} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-between gap-1.5">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-ink leading-snug line-clamp-2">{item.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[14.5px] font-extrabold text-ink tnum">{formatMoney(item.price)}</span>
            {disabled && <Badge tone="danger">Sold out</Badge>}
          </div>
        </div>

        {!disabled && (
          <div className="flex justify-end">
            {inCart > 0 ? (
              <div className="flex items-center gap-1 bg-surface-3 rounded-xl p-1">
                <button
                  onClick={() => setQty(item.id, inCart - 1)}
                  aria-label={`Remove one ${item.name}`}
                  className="w-11 h-11 grid place-items-center rounded-lg bg-surface text-ink hover:bg-line active:scale-[0.95] transition-all"
                >
                  <Minus size={16} strokeWidth={2.75} />
                </button>
                <span className="w-7 text-center text-[14px] font-extrabold text-ink tnum">{inCart}</span>
                <button
                  onClick={() => inCart < MAX_QTY && setQty(item.id, inCart + 1)}
                  disabled={inCart >= MAX_QTY}
                  aria-label={`Add one more ${item.name}`}
                  className="w-11 h-11 grid place-items-center rounded-lg bg-accent text-accent-fg hover:bg-accent-600 active:scale-[0.95] transition-all disabled:opacity-45"
                >
                  <Plus size={16} strokeWidth={2.75} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => add(item)}
                aria-label={`Add ${item.name}, ${formatMoney(item.price)}`}
                className="h-11 px-4 rounded-xl bg-accent text-accent-fg font-bold text-[13px] flex items-center gap-1.5 hover:bg-accent-600 active:scale-[0.96] transition-all"
              >
                <Plus size={15} strokeWidth={2.75} />
                Add
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Local thumb: ProductThumb's `image` prop is typed for a `Product`'s
    optional image string, but a MenuRow's `image_url` is `string | null` —
    same idea (photo, or generated initials tile), reshaped for this type. */
function MenuThumb({ name, image }: { name: string; image: string | null }) {
  if (image) {
    return <img src={image} alt="" loading="lazy" className="w-full h-full object-cover" />;
  }
  const hue = hueOf(name);
  return (
    <div
      className="product-thumb w-full h-full grid place-items-center select-none"
      style={{ '--thumb-hue': hue } as React.CSSProperties}
      aria-hidden
    >
      <span className="font-extrabold tracking-tight text-[18px]">{initialsOf(name)}</span>
    </div>
  );
}

function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function CartBar() {
  const items = useCustomerCart((s) => s.items);
  if (items.length === 0) return null;

  const count = items.reduce((a, i) => a + i.qty, 0);
  const { total } = cartTotals(items);

  return (
    <div className="fixed bottom-0 inset-x-0 z-30 px-3 pb-3 pt-2 safe-b">
      <Link
        to="/order/checkout"
        className="flex items-center justify-between gap-3 w-full h-14 px-4 rounded-2xl bg-accent text-accent-fg shadow-[var(--shadow-lg)] active:scale-[0.98] transition-all"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-accent-fg/20 grid place-items-center text-[12.5px] font-extrabold shrink-0 tnum">
            {count}
          </span>
          <span className="text-[14px] font-bold truncate">Review order</span>
        </span>
        <span className="text-[15px] font-extrabold tnum shrink-0">{formatMoney(total)}</span>
      </Link>
    </div>
  );
}
