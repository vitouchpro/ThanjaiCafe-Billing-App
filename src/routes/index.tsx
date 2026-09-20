import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAppStore } from '@/store/useAppStore';
import { can, landingRoute } from '@/features/auth/permissions';
import type { Permission } from '@/types';
import { EmptyState, Spinner } from '@/components/ui';
import { ShieldOff } from 'lucide-react';

/* Login and the POS load eagerly — they are what a cashier opens first and
   must work the instant the app does. Chart-heavy and admin screens are split
   out so the till is not waiting on Recharts to download. */
import { LoginPage } from '@/pages/Auth/LoginPage';
import { BillingPage } from '@/pages/Billing/BillingPage';

const DashboardPage = lazy(() =>
  import('@/pages/Dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const BillHistoryPage = lazy(() =>
  import('@/pages/Billing/BillHistoryPage').then((m) => ({ default: m.BillHistoryPage })));
const ProductsPage = lazy(() =>
  import('@/pages/Products/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const ReportsPage = lazy(() =>
  import('@/pages/Reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() =>
  import('@/pages/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const DayClosePage = lazy(() =>
  import('@/pages/Billing/DayClosePage').then((m) => ({ default: m.DayClosePage })));
const KitchenPage = lazy(() =>
  import('@/pages/Kitchen/KitchenPage').then((m) => ({ default: m.KitchenPage })));
const OnlineOrdersPage = lazy(() =>
  import('@/pages/Billing/OnlineOrdersPage').then((m) => ({ default: m.OnlineOrdersPage })));

/* Customer-facing pages. Lazy-loaded so a diner's phone never downloads the
   staff bundle (Dexie, seed data, Recharts, ...) just to see a menu. */
const CustomerLayout = lazy(() =>
  import('@/pages/Customer/CustomerLayout').then((m) => ({ default: m.CustomerLayout })));
const MenuPage = lazy(() =>
  import('@/pages/Customer/MenuPage').then((m) => ({ default: m.MenuPage })));
const CheckoutPage = lazy(() =>
  import('@/pages/Customer/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const OrderStatusPage = lazy(() =>
  import('@/pages/Customer/OrderStatusPage').then((m) => ({ default: m.OrderStatusPage })));
const ThanksPage = lazy(() =>
  import('@/pages/Customer/ThanksPage').then((m) => ({ default: m.ThanksPage })));

const SpikePage = lazy(() => import('@/spike/SpikePage').then((m) => ({ default: m.SpikePage })));

function RouteFallback() {
  return (
    <div className="h-full grid place-items-center py-20">
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAppStore((s) => s.currentUser);
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

/** Route-level permission gate. A cashier who deep-links to /reports gets a
    clear explanation, not a blank screen. (Plan §25) */
function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const user = useAppStore((s) => s.currentUser);
  if (!can(user, permission)) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<ShieldOff size={24} />}
          title="You do not have access to this section"
          description={`Your ${user?.role ?? 'current'} account cannot open this page. Ask the owner to grant access in Settings → Users & Roles.`}
        />
      </div>
    );
  }
  return <>{children}</>;
}

export function AppRoutes() {
  const user = useAppStore((s) => s.currentUser);

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={landingRoute(user)} replace /> : <LoginPage />}
      />

      <Route path="/spike" element={<Suspense fallback={<RouteFallback />}><SpikePage /></Suspense>} />

      {/* Customer ordering. Deliberately outside RequireAuth — a diner has no
          PIN — and lazy-loaded so a phone never downloads the POS bundle. */}
      <Route path="/order" element={<Suspense fallback={<RouteFallback />}><CustomerLayout /></Suspense>}>
        <Route index element={<Suspense fallback={<RouteFallback />}><MenuPage /></Suspense>} />
        <Route path="checkout" element={<Suspense fallback={<RouteFallback />}><CheckoutPage /></Suspense>} />
        <Route path="thanks" element={<Suspense fallback={<RouteFallback />}><ThanksPage /></Suspense>} />
        <Route path="status/:id" element={<Suspense fallback={<RouteFallback />}><OrderStatusPage /></Suspense>} />
      </Route>

      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route
          index
          element={
            can(user, 'reports')
              ? <Suspense fallback={<RouteFallback />}><DashboardPage /></Suspense>
              : <Navigate to={landingRoute(user)} replace />
          }
        />
        <Route path="billing" element={<RequirePermission permission="billing"><BillingPage /></RequirePermission>} />
        <Route path="billing/history" element={<RequirePermission permission="bill_history"><Suspense fallback={<RouteFallback />}><BillHistoryPage /></Suspense></RequirePermission>} />
        <Route path="billing/online" element={<RequirePermission permission="billing"><Suspense fallback={<RouteFallback />}><OnlineOrdersPage /></Suspense></RequirePermission>} />
        <Route path="products/*" element={<RequirePermission permission="products"><Suspense fallback={<RouteFallback />}><ProductsPage /></Suspense></RequirePermission>} />
        <Route path="reports/*" element={<RequirePermission permission="reports"><Suspense fallback={<RouteFallback />}><ReportsPage /></Suspense></RequirePermission>} />
        <Route path="settings/*" element={<RequirePermission permission="settings"><Suspense fallback={<RouteFallback />}><SettingsPage /></Suspense></RequirePermission>} />
        <Route path="day-close" element={<RequirePermission permission="day_close"><Suspense fallback={<RouteFallback />}><DayClosePage /></Suspense></RequirePermission>} />
        <Route path="kitchen" element={<RequirePermission permission="kot"><Suspense fallback={<RouteFallback />}><KitchenPage /></Suspense></RequirePermission>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
