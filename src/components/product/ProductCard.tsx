import { memo } from 'react';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import type { Product } from '@/types';
import { effectivePrice } from '@/services/billing/calc';
import { formatMoney } from '@/utils/money';
import { ProductThumb } from './ProductThumb';

/* Plan §7 — visual product cards. One tap adds, repeat taps bump quantity.
   The badge shows what is already in the cart so the cashier can count
   without looking away from the grid. */

interface Props {
  product: Product;
  onAdd: (p: Product) => void;
  inCart?: number;
  showImage?: boolean;
  compact?: boolean;
}

export const ProductCard = memo(function ProductCard({
  product, onAdd, inCart = 0, showImage = true, compact,
}: Props) {
  const price = effectivePrice(product);
  const discounted = price < product.sellingPrice;
  const disabled = !product.available;

  return (
    <button
      onClick={() => !disabled && onAdd(product)}
      disabled={disabled}
      aria-label={`Add ${product.name}, ${formatMoney(price)}`}
      className={clsx(
        'group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all',
        'bg-surface border-line focus-visible:ring-4 focus-visible:ring-accent/20',
        disabled
          ? 'opacity-55 cursor-not-allowed grayscale'
          : 'hover:border-accent hover:shadow-[var(--shadow-md)] active:scale-[0.97] cursor-pointer',
        inCart > 0 && !disabled && 'border-accent ring-2 ring-accent/25',
      )}
    >
      {showImage && (
        <div
          className={clsx(
            'relative w-full bg-surface overflow-hidden shrink-0',
            compact ? 'aspect-[5/3] p-2' : 'aspect-[4/3] p-2.5',
          )}
        >
          <ProductThumb
            name={product.name}
            image={product.image}
            className="rounded-xl shadow-[var(--shadow-sm)] transition-transform duration-300 group-hover:scale-[1.05]"
            textClass={compact ? 'text-[18px]' : 'text-[24px]'}
          />

          {discounted && (
            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-danger text-white text-[10.5px] font-extrabold uppercase tracking-wide">
              {product.discountType === 'percent' ? `${product.discount}% off` : `₹${product.discount} off`}
            </span>
          )}

          {disabled && (
            <span className="absolute inset-0 grid place-items-center bg-black/45">
              <span className="px-2.5 py-1 rounded-lg bg-danger text-white text-[11.5px] font-extrabold uppercase tracking-wide">
                Unavailable
              </span>
            </span>
          )}
        </div>
      )}

      <div className={clsx('flex-1 flex flex-col justify-between gap-1', compact ? 'p-2.5' : 'p-3')}>
        <p
          className={clsx(
            'font-bold text-ink leading-snug line-clamp-2',
            compact ? 'text-[12.5px]' : 'text-[13.5px]',
          )}
        >
          {product.name}
        </p>

        <div className="flex items-end justify-between gap-2">
          <span className="min-w-0">
            <span className={clsx('block font-extrabold text-ink tnum', compact ? 'text-[14px]' : 'text-[16px]')}>
              {formatMoney(price)}
            </span>
            {discounted && (
              <span className="block text-[11.5px] text-ink-3 line-through tnum">
                {formatMoney(product.sellingPrice)}
              </span>
            )}
          </span>

          {!disabled && (
            <span
              className={clsx(
                'shrink-0 grid place-items-center rounded-lg font-extrabold transition-all',
                compact ? 'w-7 h-7 text-[12px]' : 'w-8 h-8 text-[13px]',
                inCart > 0
                  ? 'bg-accent text-accent-fg'
                  : 'bg-surface-3 text-ink-3 group-hover:bg-accent group-hover:text-accent-fg',
              )}
            >
              {inCart > 0 ? inCart : <Plus size={compact ? 15 : 16} strokeWidth={2.75} />}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

/** Dense list row used when product images are switched off in Appearance. */
export const ProductRow = memo(function ProductRow({ product, onAdd, inCart = 0 }: Props) {
  const price = effectivePrice(product);
  const disabled = !product.available;

  return (
    <button
      onClick={() => !disabled && onAdd(product)}
      disabled={disabled}
      className={clsx(
        'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all bg-surface',
        disabled ? 'opacity-55 cursor-not-allowed' : 'border-line hover:border-accent active:scale-[0.99]',
        inCart > 0 && !disabled && 'border-accent ring-2 ring-accent/25',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold text-ink truncate">{product.name}</span>
        <span className="block text-[12px] text-ink-3">{product.unit}</span>
      </span>
      <span className="text-[15px] font-extrabold text-ink tnum shrink-0">{formatMoney(price)}</span>
      <span
        className={clsx(
          'w-8 h-8 shrink-0 grid place-items-center rounded-lg text-[13px] font-extrabold',
          inCart > 0 ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-ink-3',
        )}
      >
        {inCart > 0 ? inCart : <Plus size={16} strokeWidth={2.75} />}
      </span>
    </button>
  );
});
