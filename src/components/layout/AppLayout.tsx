import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, ChefHat, CloudOff, Coffee, LayoutDashboard, LogOut, MoreHorizontal,
  Package, Receipt, Settings as SettingsIcon, ShoppingBag, Cloud, Menu, X, CalendarCheck, User as UserIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { useCartStore } from '@/store/useCartStore';
import { useIsMobile, useOnlineStatus, usePermission } from '@/hooks';
import { can } from '@/features/auth/permissions';
import { Badge, Button, Modal } from '@/components/ui';
import { billsOnDay, summarize, discountSummary } from '@/services/reports/analytics';
import { formatMoney } from '@/utils/money';
import { formatDayName, formatDate, dateKey } from '@/utils/date';
import { useOrderAlerts } from '@/features/orders/useOrderAlerts';
import { OrderAlertHost } from '@/features/orders/OrderAlertHost';
import type { Permission } from '@/types';

/* useOrderAlerts subscribes to live order intake, which is only meaningful
   for someone who can see billing. It is always called (hooks can't branch)
   but its result is discarded for anyone without the permission, so the nav
   badge never appears for a role that can't act on it. */
function useNavOrderBadge(allowed: boolean): number {
  const { unseen } = useOrderAlerts();
  return allowed ? unseen : 0;
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
  mobile?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'reports', mobile: true },
  { to: '/billing', label: 'Billing', icon: Receipt, permission: 'billing', mobile: true },
  { to: '/kitchen', label: 'Kitchen', icon: ChefHat, permission: 'kot', mobile: true },
  { to: '/billing/online', label: 'Online Orders', icon: ShoppingBag, permission: 'billing', mobile: true },
  { to: '/products', label: 'Products', icon: Package, permission: 'products', mobile: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, permission: 'reports', mobile: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, permission: 'settings' },
];

export function AppLayout() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const user = useAppStore((s) => s.currentUser);
  const business = useAppStore((s) => s.settings.business);
  const canSeeOrders = can(user, 'billing');

  const visible = NAV.filter((n) => can(user, n.permission));

  // The POS runs edge-to-edge: its own panes scroll, the page never does.
  const isPos = location.pathname.startsWith('/billing') && !location.pathname.includes('/history');

  return (
    <div className="flex h-full bg-bg">
      {!isMobile && <Sidebar items={visible} />}

      <div className="flex-1 flex flex-col min-w-0 h-full">
        <TopBar businessName={business.name} />

        <main
          className={clsx(
            'flex-1 min-h-0',
            isPos ? 'overflow-hidden' : 'overflow-y-auto',
            isMobile && 'pb-[72px]',
          )}
        >
          <Outlet />
        </main>

        {isMobile && <BottomNav items={visible} />}
      </div>

      {canSeeOrders && <OrderAlertHost />}
    </div>
  );
}

/* ---------------- Desktop sidebar ---------------- */

function Sidebar({ items }: { items: NavItem[] }) {
  const business = useAppStore((s) => s.settings.business);
  const user = useAppStore((s) => s.currentUser);
  const logout = useAppStore((s) => s.logout);
  const navigate = useNavigate();
  const { online, pendingSync } = useOnlineStatus();
  const onlineOrderCount = useNavOrderBadge(can(user, 'billing'));

  return (
    <aside className="w-[248px] shrink-0 border-r border-line bg-surface flex flex-col h-full">
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-line shrink-0">
        <div className="w-9 h-9 rounded-xl bg-accent grid place-items-center text-accent-fg shrink-0 overflow-hidden">
          {business.logo
            ? <img src={business.logo} alt="" className="w-full h-full object-cover" />
            : <Coffee size={19} />}
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-extrabold text-ink truncate leading-tight">{business.name}</p>
          <p className="text-[11px] text-ink-3 font-medium">Point of Sale</p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 h-11 px-3 rounded-xl text-[14.5px] font-semibold transition-all',
                isActive
                  ? 'bg-accent text-accent-fg shadow-sm'
                  : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
              )
            }
          >
            <item.icon size={19} />
            <span className="flex-1">{item.label}</span>
            {item.to === '/billing/online' && onlineOrderCount > 0 && (
              <Badge tone="danger">{onlineOrderCount}</Badge>
            )}
          </NavLink>
        ))}

        <DayCloseLink />
      </nav>

      <div className="p-3 border-t border-line space-y-2 shrink-0">
        <SyncStatus online={online} pending={pendingSync} />

        <button
          onClick={async () => { await logout(); navigate('/login'); }}
          className="flex items-center gap-3 w-full h-11 px-3 rounded-xl text-[14px] font-semibold text-ink-2 hover:bg-surface-3 hover:text-ink transition"
        >
          <span className="w-7 h-7 rounded-lg bg-accent-50 text-accent-700 dark:text-accent-300 grid place-items-center text-[12px] font-extrabold shrink-0">
            {user?.name?.[0]?.toUpperCase() ?? '?'}
          </span>
          <span className="flex-1 text-left truncate">{user?.name ?? 'Guest'}</span>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}

/** Honest connection status. With no backend configured, unsynced bills are
    "saved on this device" — calling that "syncing" would be a lie the shop
    owner might rely on. */
function SyncStatus({ online, pending }: { online: boolean; pending: number }) {
  const tone = !online
    ? 'bg-warning-bg text-warning'
    : pending > 0
      ? 'bg-info-bg text-info'
      : 'bg-success-bg text-success';

  return (
    <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-xl text-[12.5px] font-semibold', tone)}>
      {online ? <Cloud size={15} /> : <CloudOff size={15} />}
      <span className="truncate">
        {!online
          ? `Offline · ${pending} saved here`
          : pending > 0
            ? `${pending} saved on this device`
            : 'All bills saved'}
      </span>
    </div>
  );
}

function DayCloseLink() {
  const allowed = usePermission('day_close');
  if (!allowed) return null;
  return (
    <NavLink
      to="/day-close"
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 h-11 px-3 rounded-xl text-[14.5px] font-semibold transition-all',
          isActive ? 'bg-accent text-accent-fg shadow-sm' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
        )
      }
    >
      <CalendarCheck size={19} />
      Daily Closing
    </NavLink>
  );
}

/* ---------------- Top bar ---------------- */

function TopBar({ businessName }: { businessName: string }) {
  const isMobile = useIsMobile();
  const { online, pendingSync } = useOnlineStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const notifications = useAppStore((s) => s.settings.notifications);
  const [notifOpen, setNotifOpen] = useState(false);
  const today = new Date();

  return (
    <>
      <header className="h-16 shrink-0 border-b border-line bg-surface/85 backdrop-blur-md flex items-center gap-3 px-4 sm:px-5 z-20">
        {isMobile && (
          <button
            onClick={() => setMenuOpen(true)}
            className="p-2 -ml-2 rounded-xl text-ink-2 hover:bg-surface-3"
            aria-label="Open menu"
          >
            <Menu size={21} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] sm:text-[16px] font-extrabold text-ink truncate leading-tight">
            {isMobile ? businessName : `${formatDayName(today)}, ${formatDate(today)}`}
          </h1>
          {!isMobile && (
            <p className="text-[12px] text-ink-3 font-medium">Have a good shift</p>
          )}
        </div>

        {!online && (
          <Badge tone="warning" dot className="hidden xs:inline-flex">
            Offline{pendingSync > 0 ? ` · ${pendingSync}` : ''}
          </Badge>
        )}

        <button
          onClick={() => setNotifOpen(true)}
          className="relative p-2.5 rounded-xl text-ink-2 hover:bg-surface-3 hover:text-ink transition"
          aria-label="Notifications"
        >
          <Bell size={19} />
          <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-danger ring-2 ring-surface" />
        </button>

        <ProfileButton />
      </header>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      <NotificationPanel
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        enabled={notifications}
      />
    </>
  );
}

function ProfileButton() {
  const user = useAppStore((s) => s.currentUser);
  const logout = useAppStore((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-9 h-9 rounded-xl bg-accent-50 text-accent-700 dark:text-accent-300 grid place-items-center text-[13px] font-extrabold shrink-0 hover:ring-2 hover:ring-accent/30 transition"
        aria-label="Account"
      >
        {user?.name?.[0]?.toUpperCase() ?? <UserIcon size={17} />}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Account" size="sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-accent text-accent-fg grid place-items-center text-lg font-extrabold">
            {user?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-ink truncate">{user?.name}</p>
            <p className="text-[13px] text-ink-3 capitalize">{user?.role}</p>
          </div>
        </div>
        <Button
          variant="danger"
          fullWidth
          icon={<LogOut size={17} />}
          onClick={async () => { await logout(); setOpen(false); navigate('/login'); }}
        >
          Sign Out
        </Button>
      </Modal>
    </>
  );
}

/* ---------------- Mobile drawer ---------------- */

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAppStore((s) => s.currentUser);
  const business = useAppStore((s) => s.settings.business);
  const logout = useAppStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const { online, pendingSync } = useOnlineStatus();
  const onlineOrderCount = useNavOrderBadge(can(user, 'billing'));

  useEffect(() => { onClose(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const items = [
    ...NAV.filter((n) => can(user, n.permission)),
    ...(can(user, 'day_close')
      ? [{ to: '/day-close', label: 'Daily Closing', icon: CalendarCheck, permission: 'day_close' as Permission }]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute left-0 top-0 bottom-0 w-[80%] max-w-[300px] bg-surface border-r border-line flex flex-col animate-pop">
        <div className="h-16 px-5 flex items-center justify-between border-b border-line">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-accent grid place-items-center text-accent-fg shrink-0">
              <Coffee size={18} />
            </div>
            <p className="text-[14px] font-extrabold text-ink truncate">{business.name}</p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-xl text-ink-3 hover:bg-surface-3">
            <X size={19} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 h-12 px-3 rounded-xl text-[15px] font-semibold transition',
                  isActive ? 'bg-accent text-accent-fg' : 'text-ink-2 hover:bg-surface-3',
                )
              }
            >
              <item.icon size={20} />
              <span className="flex-1">{item.label}</span>
              {item.to === '/billing/online' && onlineOrderCount > 0 && (
                <Badge tone="danger">{onlineOrderCount}</Badge>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-line space-y-2 safe-b">
          <SyncStatus online={online} pending={pendingSync} />
          <Button
            variant="ghost"
            fullWidth
            icon={<LogOut size={17} />}
            onClick={async () => { await logout(); navigate('/login'); }}
          >
            Sign out {user?.name}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Bottom nav (mobile) ---------------- */

function BottomNav({ items }: { items: NavItem[] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const user = useAppStore((s) => s.currentUser);
  const cartCount = useCartStore((s) => s.lines.reduce((a, l) => a + l.qty, 0));
  const onlineOrderCount = useNavOrderBadge(can(user, 'billing'));

  const primary = items.filter((i) => i.mobile).slice(0, 4);
  const hasMore = can(user, 'settings') || can(user, 'day_close');

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-surface/95 backdrop-blur-lg border-t border-line safe-b md:hidden">
        <div className="flex items-stretch h-[68px]">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition relative',
                  isActive ? 'text-accent' : 'text-ink-3',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <item.icon size={21} strokeWidth={isActive ? 2.5 : 2} />
                    {item.to === '/billing' && cartCount > 0 && (
                      <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-danger text-white text-[10px] font-extrabold grid place-items-center">
                        {cartCount > 99 ? '99+' : cartCount}
                      </span>
                    )}
                    {item.to === '/billing/online' && onlineOrderCount > 0 && (
                      <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-danger text-white text-[10px] font-extrabold grid place-items-center">
                        {onlineOrderCount > 99 ? '99+' : onlineOrderCount}
                      </span>
                    )}
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}

          {hasMore && (
            <button
              onClick={() => setMoreOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-ink-3"
            >
              <MoreHorizontal size={21} />
              More
            </button>
          )}
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="grid grid-cols-2 gap-3">
          {can(user, 'settings') && (
            <MoreTile to="/settings" icon={<SettingsIcon size={22} />} label="Settings" onNavigate={() => setMoreOpen(false)} />
          )}
          {can(user, 'day_close') && (
            <MoreTile to="/day-close" icon={<CalendarCheck size={22} />} label="Daily Closing" onNavigate={() => setMoreOpen(false)} />
          )}
          {can(user, 'bill_history') && (
            <MoreTile to="/billing/history" icon={<Receipt size={22} />} label="Bill History" onNavigate={() => setMoreOpen(false)} />
          )}
          {can(user, 'reports') && (
            <MoreTile to="/reports" icon={<BarChart3 size={22} />} label="Reports" onNavigate={() => setMoreOpen(false)} />
          )}
        </div>
      </Modal>
    </>
  );
}

function MoreTile({
  to, icon, label, onNavigate,
}: { to: string; icon: React.ReactNode; label: string; onNavigate: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className="flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl bg-surface-2 border border-line text-ink hover:border-accent transition"
    >
      <span className="text-accent">{icon}</span>
      <span className="text-[13.5px] font-bold">{label}</span>
    </NavLink>
  );
}

/* ---------------- Notifications (Plan §26) ---------------- */

function NotificationPanel({
  open, onClose, enabled,
}: {
  open: boolean;
  onClose: () => void;
  enabled: ReturnType<typeof useAppStore.getState>['settings']['notifications'];
}) {
  const bills = useAppStore((s) => s.bills);
  const dayCloses = useAppStore((s) => s.dayCloses);
  const settings = useAppStore((s) => s.settings);

  const notes = buildNotifications(bills, dayCloses, settings, enabled);

  return (
    <Modal open={open} onClose={onClose} title="Notifications" size="md">
      {notes.length === 0 ? (
        <p className="text-[14px] text-ink-3 py-6 text-center">Nothing needs your attention right now.</p>
      ) : (
        <div className="space-y-2.5">
          {notes.map((n, i) => (
            <div
              key={i}
              className={clsx(
                'flex gap-3 p-3.5 rounded-xl border',
                n.tone === 'danger' && 'bg-danger-bg border-danger/20',
                n.tone === 'warning' && 'bg-warning-bg border-warning/20',
                n.tone === 'success' && 'bg-success-bg border-success/20',
                n.tone === 'info' && 'bg-info-bg border-info/20',
              )}
            >
              <span className="text-lg leading-none mt-0.5">{n.emoji}</span>
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-ink">{n.title}</p>
                <p className="text-[13px] text-ink-2 mt-0.5 leading-relaxed">{n.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

interface Note { emoji: string; title: string; body: string; tone: 'danger' | 'warning' | 'success' | 'info'; }

function buildNotifications(
  bills: ReturnType<typeof useAppStore.getState>['bills'],
  dayCloses: ReturnType<typeof useAppStore.getState>['dayCloses'],
  settings: ReturnType<typeof useAppStore.getState>['settings'],
  enabled: ReturnType<typeof useAppStore.getState>['settings']['notifications'],
): Note[] {
  const notes: Note[] = [];
  const today = new Date();
  const todays = billsOnDay(bills, today);
  const s = summarize(todays);

  if (enabled.dailySalesSummary && s.orders > 0) {
    notes.push({
      emoji: '📊',
      title: 'Today so far',
      body: `${s.orders} orders · ${formatMoney(s.totalSales)} · average bill ${formatMoney(s.avgBill)}.`,
      tone: 'info',
    });
  }

  if (enabled.highDiscountAlert) {
    const d = discountSummary(todays);
    if (d.avgPercent > settings.billing.requireReasonAboveDiscount) {
      notes.push({
        emoji: '🏷️',
        title: 'Discounts running high',
        body: `${formatMoney(d.total)} given away today — ${d.avgPercent.toFixed(1)}% of gross sales across ${d.billCount} bills.`,
        tone: 'warning',
      });
    }
  }

  if (enabled.refundAlert) {
    const refunds = todays.filter((b) => b.status === 'refunded');
    if (refunds.length) {
      notes.push({
        emoji: '↩️',
        title: `${refunds.length} refund${refunds.length > 1 ? 's' : ''} today`,
        body: `${formatMoney(refunds.reduce((a, b) => a + (b.refundAmount ?? b.totals.total), 0))} returned to customers.`,
        tone: 'danger',
      });
    }
  }

  if (enabled.dailyClosingReminder) {
    const closed = dayCloses.some((c) => c.date === dateKey(today));
    if (!closed && today.getHours() >= 20 && s.orders > 0) {
      notes.push({
        emoji: '🔒',
        title: 'Day not closed yet',
        body: 'Count the cash drawer and close the day to lock today’s figures.',
        tone: 'warning',
      });
    }
  }

  const pending = bills.filter((b) => b.synced === 0).length;
  if (pending > 0) {
    notes.push({
      emoji: '☁️',
      title: `${pending} bills held on this device`,
      body: 'Saved to local storage. They will upload automatically once a sync server is connected.',
      tone: 'info',
    });
  }

  return notes;
}
