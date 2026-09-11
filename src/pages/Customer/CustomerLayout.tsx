import { Outlet } from 'react-router-dom';
import { Coffee } from 'lucide-react';

/* The diner's whole shell. No sidebar, no bottom nav, no cashier links —
   a customer on their own phone must never see a way into the till. This is
   deliberately the thinnest possible wrapper: a header naming the cafe, and
   whatever page is routed underneath it.

   The name comes from build-time config, NOT from useAppStore. Reading the
   staff store here would pull Dexie, the seed generator and the whole product
   photo set into the customer bundle — the code-splitting this page exists to
   preserve — and it would still be wrong: a diner's phone has no shop settings
   in IndexedDB, so it would always render the default name rather than the
   cafe's own. */
const CAFE_NAME: string = import.meta.env.VITE_CAFE_NAME || 'THANJAI CAFE';

export function CustomerLayout() {
  const cafeName = CAFE_NAME;

  return (
    <div className="min-h-dvh flex flex-col bg-bg">
      <header className="sticky top-0 z-20 flex items-center gap-2.5 px-4 py-3 bg-surface border-b border-line">
        <span className="w-8 h-8 rounded-xl bg-accent grid place-items-center text-accent-fg shrink-0">
          <Coffee size={17} />
        </span>
        <span className="text-[15px] font-bold text-ink truncate">{cafeName}</span>
      </header>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
