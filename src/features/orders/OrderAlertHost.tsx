import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, X } from 'lucide-react';
import { useOrderAlerts } from './useOrderAlerts';
import { Button } from '@/components/ui';

/* A paid order must announce itself without hijacking whatever the cashier is
   doing. No modal, no stolen focus — a dismissible card that gets out of the
   way on its own after a few seconds, leaving the nav badge as the lasting
   signal. */

const AUTO_DISMISS_MS = 8000;

export function OrderAlertHost() {
  const { banner, dismissBanner } = useOrderAlerts();
  const navigate = useNavigate();

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(dismissBanner, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner?.id]);

  if (!banner) return null;

  const itemCount = banner.lines.reduce((a, l) => a + l.qty, 0);

  return (
    <div
      role="status"
      className="fixed top-[72px] right-4 z-40 w-[min(360px,calc(100vw-2rem))] pointer-events-none"
    >
      <div className="pointer-events-auto bg-surface border border-line rounded-2xl shadow-[var(--shadow-lg,0_12px_32px_rgba(0,0,0,0.18))] p-4 flex gap-3 animate-pop">
        <span className="w-10 h-10 rounded-xl bg-accent-50 text-accent-700 dark:text-accent-300 grid place-items-center shrink-0">
          <ShoppingBag size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-ink">New online order</p>
          <p className="text-[13px] text-ink-2 mt-0.5">
            {banner.token} · Table {banner.tableCode}
            {itemCount > 0 ? ` · ${itemCount} item${itemCount > 1 ? 's' : ''}` : ''}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => { navigate('/billing/online'); dismissBanner(); }}
            >
              View order
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissBanner}>
              Dismiss
            </Button>
          </div>
        </div>
        <button
          onClick={dismissBanner}
          aria-label="Dismiss"
          className="p-1 -m-1 rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink transition shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
