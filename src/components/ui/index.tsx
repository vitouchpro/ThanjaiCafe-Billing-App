import {
  forwardRef, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useScrollLock } from '@/hooks';

/* Shared UI vocabulary. Touch targets stay >= 44px on interactive controls —
   this runs on a counter tablet with people in a hurry. (Plan §34) */

/* ---------------- Button ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-600 active:bg-accent-700 shadow-sm',
  secondary: 'bg-surface-3 text-ink hover:bg-line active:bg-line-strong/40',
  ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-110 active:brightness-95 shadow-sm',
  success: 'bg-success text-white hover:brightness-110 active:brightness-95 shadow-sm',
  outline: 'border border-line-strong text-ink hover:bg-surface-3',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-13 px-5 text-base gap-2 rounded-xl',
  xl: 'h-16 px-6 text-lg gap-2.5 rounded-2xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center font-semibold transition-all select-none',
        'disabled:opacity-45 disabled:pointer-events-none active:scale-[0.985]',
        VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
});

/* ---------------- Card ---------------- */

export function Card({
  className, children, padded = true, ...rest
}: { className?: string; children: ReactNode; padded?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'bg-surface border border-line rounded-2xl shadow-[var(--shadow-sm)]',
        padded && 'p-4 sm:p-5', className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title, subtitle, action, icon,
}: { title: string; subtitle?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-ink flex items-center gap-2">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {subtitle && <p className="text-[13px] text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------------- Inputs ---------------- */

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <label className="block">
      {label && (
        <span className="block text-[13px] font-semibold text-ink-2 mb-1.5">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="block text-[12px] text-danger mt-1.5 font-medium">{error}</span>
      ) : hint ? (
        <span className="block text-[12px] text-ink-3 mt-1.5">{hint}</span>
      ) : null}
    </label>
  );
}

const inputBase =
  'w-full h-11 px-3.5 bg-surface-2 border border-line rounded-xl text-ink text-[15px] ' +
  'placeholder:text-ink-3 outline-none transition focus:border-accent focus:bg-surface ' +
  'focus:ring-4 focus:ring-accent/12 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(inputBase, invalid && 'border-danger focus:border-danger focus:ring-danger/12', className)}
        {...rest}
      />
    );
  },
);

/** Currency input. Selects on focus so the cashier can overwrite instantly. */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { currency?: string }>(
  function MoneyInput({ className, currency = '₹', ...rest }, ref) {
    return (
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 font-semibold pointer-events-none">
          {currency}
        </span>
        <input
          ref={ref}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          onFocus={(e) => e.currentTarget.select()}
          className={clsx(inputBase, 'pl-9 tnum font-semibold', className)}
          {...rest}
        />
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={clsx(inputBase, 'h-auto min-h-[84px] py-2.5 resize-y leading-relaxed', className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={clsx(inputBase, 'appearance-none pr-10 cursor-pointer', className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
      </div>
    );
  },
);

export function SearchInput({
  value, onChange, placeholder = 'Search…', autoFocus, onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="relative">
      <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx(inputBase, 'pl-10 pr-10')}
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); onClear?.(); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink"
          aria-label="Clear search"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/* ---------------- Toggle & choices ---------------- */

export function Toggle({
  checked, onChange, label, description, disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 w-full text-left group disabled:opacity-50 py-1"
    >
      <span className="min-w-0">
        {label && <span className="block text-[15px] font-medium text-ink">{label}</span>}
        {description && <span className="block text-[12.5px] text-ink-3 mt-0.5">{description}</span>}
      </span>
      <span
        className={clsx(
          'relative w-[46px] h-[26px] rounded-full transition-colors shrink-0',
          checked ? 'bg-accent' : 'bg-line-strong/60',
        )}
      >
        <span
          className={clsx(
            'absolute top-[3px] w-5 h-5 bg-white rounded-full shadow transition-transform',
            checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
          )}
        />
      </span>
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function Segmented<T extends string>({
  options, value, onChange, size = 'md', fullWidth,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}) {
  return (
    <div
      className={clsx(
        'inline-flex bg-surface-3 rounded-xl p-1 gap-1',
        fullWidth && 'flex w-full',
      )}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-all whitespace-nowrap',
            size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
            fullWidth && 'flex-1',
            value === o.value
              ? 'bg-surface text-ink shadow-[var(--shadow-sm)]'
              : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RadioGroup<T extends string>({
  options, value, onChange, columns = 1,
}: {
  options: { value: T; label: string; description?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex items-start gap-3 p-3 rounded-xl border text-left transition-all',
              active ? 'border-accent bg-accent-50 ring-1 ring-accent/25' : 'border-line hover:border-line-strong bg-surface-2',
            )}
          >
            <span
              className={clsx(
                'w-[18px] h-[18px] rounded-full border-2 grid place-items-center mt-0.5 shrink-0 transition',
                active ? 'border-accent' : 'border-line-strong',
              )}
            >
              {active && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold text-ink">{o.label}</span>
              {o.description && <span className="block text-[12.5px] text-ink-3 mt-0.5">{o.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-left disabled:opacity-50 py-1.5 w-full"
    >
      <span
        className={clsx(
          'w-[20px] h-[20px] rounded-md border-2 grid place-items-center transition shrink-0',
          checked ? 'bg-accent border-accent' : 'border-line-strong',
        )}
      >
        {checked && <Check size={13} className="text-accent-fg" strokeWidth={3.5} />}
      </span>
      <span className="text-[14.5px] text-ink">{label}</span>
    </button>
  );
}

/* ---------------- Badge ---------------- */

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  success: 'bg-success-bg text-success',
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
  accent: 'bg-accent-50 text-accent-700 dark:text-accent-300',
};

export function Badge({
  children, tone = 'neutral', className, dot,
}: { children: ReactNode; tone?: Tone; className?: string; dot?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11.5px] font-bold uppercase tracking-wide',
        TONES[tone], className,
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ---------------- Modal & Sheet ---------------- */

export function Modal({
  open, onClose, title, children, footer, size = 'md', dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissable?: boolean;
}) {
  useScrollLock(open);

  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissable]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={dismissable ? onClose : undefined}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'relative w-full bg-surface border border-line shadow-[var(--shadow-lg)] flex flex-col',
          'rounded-t-3xl sm:rounded-2xl max-h-[92vh] sm:max-h-[88vh]',
          'animate-sheet sm:animate-pop',
          widths[size],
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line shrink-0">
            <h3 className="text-[17px] font-bold text-ink truncate">{title}</h3>
            {dismissable && (
              <button
                onClick={onClose}
                className="p-2 -mr-2 rounded-xl text-ink-3 hover:bg-surface-3 hover:text-ink"
                aria-label="Close"
              >
                <X size={19} />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-line shrink-0 safe-b bg-surface-2/60 rounded-b-3xl sm:rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Empty & loading ---------------- */

export function EmptyState({
  icon, title, description, action,
}: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-surface-3 grid place-items-center text-ink-3 mb-4">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-bold text-ink">{title}</p>
      {description && <p className="text-[13.5px] text-ink-3 mt-1.5 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin text-accent', className)} size={22} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse bg-surface-3 rounded-lg', className)} />;
}

/* ---------------- Toast ---------------- */

interface ToastItem { id: number; message: string; tone: Tone; }
let pushToast: ((message: string, tone?: Tone) => void) | null = null;
export const toast = (message: string, tone: Tone = 'neutral') => pushToast?.(message, tone);

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    pushToast = (message, tone = 'neutral') => {
      const id = ++seq.current;
      setItems((cur) => [...cur, { id, message, tone }]);
      setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 2800);
    };
    return () => { pushToast = null; };
  }, []);

  if (!items.length) return null;

  return createPortal(
    <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center px-4 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'px-4 py-2.5 rounded-xl shadow-[var(--shadow-lg)] text-[14px] font-semibold animate-pop border',
            t.tone === 'success' && 'bg-success text-white border-success',
            t.tone === 'danger' && 'bg-danger text-white border-danger',
            t.tone === 'warning' && 'bg-warning text-white border-warning',
            (t.tone === 'neutral' || t.tone === 'info' || t.tone === 'accent') && 'bg-ink text-bg border-transparent',
          )}
        >
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ---------------- Confirm dialog ---------------- */

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'danger', onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" fullWidth onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} fullWidth onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-[14.5px] text-ink-2 leading-relaxed">{message}</p>
    </Modal>
  );
}

/* ---------------- Misc ---------------- */

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="relative group/tt inline-flex">
      <span aria-describedby={id}>{children}</span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 px-2 py-1 rounded-lg bg-ink text-bg text-[11.5px] font-semibold whitespace-nowrap opacity-0 group-hover/tt:opacity-100 transition z-30"
      >
        {label}
      </span>
    </span>
  );
}

export function Stat({
  label, value, sub, tone,
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'success' | 'danger' }) {
  return (
    <div>
      <p className="text-[11.5px] font-bold text-ink-3 uppercase tracking-wider">{label}</p>
      <p
        className={clsx(
          'text-[22px] font-extrabold tnum mt-1',
          tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[12.5px] text-ink-3 mt-0.5">{sub}</p>}
    </div>
  );
}

/** Horizontally scrollable chip row — category filters on narrow screens. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">{children}</div>
  );
}

export function Chip({
  active, onClick, children,
}: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'shrink-0 h-9 px-3.5 rounded-xl text-[13.5px] font-semibold transition-all border whitespace-nowrap',
        active
          ? 'bg-accent text-accent-fg border-accent shadow-sm'
          : 'bg-surface text-ink-2 border-line hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
