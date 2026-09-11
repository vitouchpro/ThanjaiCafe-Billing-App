import { useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from '@/routes';
import { useAppStore } from '@/store/useAppStore';
import { useTheme, useOnlineStatus } from '@/hooks';
import { Spinner, ToastHost } from '@/components/ui';
import { Coffee } from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/* The customer ordering pages are not part of the till. They read the published
   menu from the cloud and never touch IndexedDB, so they must not wait behind
   the staff app's boot — which seeds a catalogue and ~90 days of trading history
   on first run. A diner scanning a table QR on mobile data would otherwise sit
   through the whole till warming up a database they never use. */
const isCustomerRoute = (pathname: string): boolean =>
  // Exactly /order or a path beneath it. A bare startsWith would also match a
  // future staff route like /orders, which would then render the till without
  // its store ever being initialised.
  pathname === '/order' || pathname.startsWith('/order/');

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ThemeBridge />
        <AppShell />
        <ToastHost />
      </ErrorBoundary>
    </BrowserRouter>
  );
}

/** Inside the router, so it can tell a customer route from a staff one. */
function AppShell() {
  const ready = useAppStore((s) => s.ready);
  const init = useAppStore((s) => s.init);
  const { pathname } = useLocation();
  const customer = isCustomerRoute(pathname);

  useEffect(() => {
    // Seeding the till is pointless on a diner's phone.
    if (!customer) void init();
  }, [init, customer]);

  if (customer) return <AppRoutes />;
  return ready ? <AppRoutes /> : <BootScreen />;
}

/** Hooks that need to run inside the tree but render nothing. */
function ThemeBridge() {
  useTheme();
  useOnlineStatus();
  return null;
}

function BootScreen() {
  return (
    <div className="h-full grid place-items-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-accent grid place-items-center text-accent-fg">
          <Coffee size={26} />
        </div>
        <Spinner />
        <p className="text-[13px] text-ink-3 font-medium">Preparing your counter…</p>
      </div>
    </div>
  );
}
