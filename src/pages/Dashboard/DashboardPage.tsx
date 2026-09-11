import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownRight, ArrowUpRight, Clock, CreditCard, Flame, Layers,
  Receipt, Tag, TrendingDown, Plus, ArrowRight, Target,
} from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { Badge, Card, EmptyState, Segmented, SectionTitle } from '@/components/ui';
import { SalesAreaChart, SalesBarChart, ShareBar } from '@/components/charts';
import {
  billsBetween, categoryPerformance, dailyBucketsDated, discountSummary,
  hourlyBuckets, lowSelling, paymentSplit, peakHours, productPerformance, summarize, topProducts,
} from '@/services/reports/analytics';
import { formatMoney, formatMoneyShort, formatNumber, pctChange } from '@/utils/money';
import { addDays, formatDate, formatDayName, startOfDay } from '@/utils/date';

/* Plan §4/§5 — the owner dashboard answers "How is my shop doing today?" */

type Range = 'today' | '7d' | '30d';

const RANGE_OPTIONS = [
  { value: 'today' as const, label: 'Today' },
  { value: '7d' as const, label: '7 Days' },
  { value: '30d' as const, label: '30 Days' },
];

export function DashboardPage() {
  const bills = useAppStore((s) => s.bills);
  const products = useAppStore((s) => s.products);
  const categories = useAppStore((s) => s.categories);
  const settings = useAppStore((s) => s.settings);
  const user = useAppStore((s) => s.currentUser);

  const [range, setRange] = useState<Range>('today');

  const view = useMemo(() => {
    const today = startOfDay(new Date());
    const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;

    const from = addDays(today, -(days - 1));
    const current = billsBetween(bills, from, today);

    // Same-length window immediately before, for the comparison arrows.
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));
    let previous = billsBetween(bills, prevFrom, prevTo);

    // A day in progress must be compared against the same slice of the
    // earlier period, otherwise every morning looks like a collapse.
    if (range === 'today') {
      const cutoff = new Date();
      const minutesIntoDay = cutoff.getHours() * 60 + cutoff.getMinutes();
      previous = previous.filter((b) => {
        const t = new Date(b.createdAt);
        return t.getHours() * 60 + t.getMinutes() <= minutesIntoDay;
      });
    }

    const summary = summarize(current);
    const prevSummary = summarize(previous);
    const perf = productPerformance(current, products);

    return {
      days,
      from,
      to: today,
      current,
      summary,
      prevSummary,
      perf,
      trend:
        range === 'today'
          ? hourlyBuckets(current)
          : dailyBucketsDated(current, from, today).map((d) => ({
              label: range === '7d' ? d.day : d.label,
              sales: d.sales,
              orders: d.orders,
            })),
      payments: paymentSplit(current),
      discounts: discountSummary(current),
      peak: peakHours(current),
      categories: categoryPerformance(perf, categories),
      top: topProducts(perf, settings.reports.topProductCount),
      low: lowSelling(perf, settings.reports.lowSellingThreshold, 5),
    };
  }, [bills, products, categories, range, settings.reports]);

  const { summary, prevSummary } = view;
  const target =
    range === 'today'
      ? settings.reports.dailySalesTarget
      : settings.reports.dailySalesTarget * view.days;

  const hasData = summary.orders > 0;
  const compareLabel =
    range === 'today' ? 'vs same time yesterday' : `vs previous ${view.days} days`;

  return (
    <div className="p-4 sm:p-5 max-w-[1500px] mx-auto space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[21px] sm:text-[24px] font-extrabold text-ink leading-tight">
            {greeting()}, {user?.name?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="text-[13.5px] text-ink-3 mt-0.5">
            {formatDayName(new Date())}, {formatDate(new Date())}
          </p>
        </div>
        <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} />
      </div>

      {/* KPI cards (Plan §4) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label={range === 'today' ? 'Today Sales' : 'Total Sales'}
          value={formatMoney(summary.totalSales)}
          change={pctChange(summary.totalSales, prevSummary.totalSales)}
          icon={<Receipt size={16} />}
          compareLabel={compareLabel}
          accent
        />
        <KpiCard
          label="Orders"
          value={formatNumber(summary.orders)}
          change={pctChange(summary.orders, prevSummary.orders)}
          icon={<Layers size={16} />}
          compareLabel={compareLabel}
        />
        <KpiCard
          label="Avg Bill"
          value={formatMoney(summary.avgBill)}
          change={pctChange(summary.avgBill, prevSummary.avgBill)}
          icon={<CreditCard size={16} />}
          compareLabel={compareLabel}
        />
        <KpiCard
          label="Discount"
          value={formatMoney(summary.discount)}
          change={pctChange(summary.discount, prevSummary.discount)}
          invertChange
          icon={<Tag size={16} />}
          sub={`${view.discounts.billCount} bills`}
        />
      </div>

      {!hasData ? (
        <Card>
          <EmptyState
            icon={<Receipt size={22} />}
            title="No sales in this period"
            description="Once bills start coming in, your sales trend and product insights appear here."
            action={
              <Link
                to="/billing"
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-accent text-accent-fg font-semibold text-sm"
              >
                <Plus size={17} /> Start billing
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {/* Sales trend */}
          <Card>
            <SectionTitle
              title="Sales Trend"
              subtitle={
                range === 'today'
                  ? 'Sales by hour today'
                  : `${formatDate(view.from)} — ${formatDate(view.to)}`
              }
              action={
                target > 0 ? (
                  <div className="text-right">
                    <p className="text-[11px] font-bold text-ink-3 uppercase tracking-wider">
                      Target
                    </p>
                    <p className="text-[13.5px] font-bold text-ink tnum">
                      {formatMoneyShort(target)}
                    </p>
                  </div>
                ) : undefined
              }
            />

            {target > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                  <span className="text-ink-2 font-semibold">
                    {Math.round((summary.totalSales / target) * 100)}% of target
                  </span>
                  <span className="text-ink-3 tnum">
                    {summary.totalSales >= target
                      ? `${formatMoney(summary.totalSales - target)} ahead`
                      : `${formatMoney(target - summary.totalSales)} to go`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all',
                      summary.totalSales >= target ? 'bg-success' : 'bg-accent',
                    )}
                    style={{ width: `${Math.min(100, (summary.totalSales / target) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {range === 'today' ? (
              <SalesAreaChart data={view.trend} height={230} />
            ) : (
              <SalesBarChart data={view.trend} height={230} highlightMax />
            )}
          </Card>

          {/* Insights (Plan §5) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <SectionTitle
                title="Top Selling"
                icon={<Flame size={17} className="text-warning" />}
                action={
                  <Link
                    to="/reports/products"
                    className="text-[12.5px] font-bold text-accent hover:underline inline-flex items-center gap-1"
                  >
                    View All <ArrowRight size={13} />
                  </Link>
                }
              />
              {view.top.length === 0 ? (
                <p className="text-[13px] text-ink-3 py-4 text-center">Nothing sold yet.</p>
              ) : (
                <ol className="space-y-2.5">
                  {view.top.map((p, i) => (
                    <li key={p.productId} className="flex items-center gap-3">
                      <span
                        className={clsx(
                          'w-6 h-6 rounded-lg grid place-items-center text-[11.5px] font-extrabold shrink-0',
                          i === 0 ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-ink-2',
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-semibold text-ink truncate">
                          {p.name}
                        </span>
                        <span className="block text-[11.5px] text-ink-3 tnum">
                          {formatMoney(p.revenue)}
                        </span>
                      </span>
                      <span className="text-[13px] font-extrabold text-ink tnum shrink-0">
                        {formatNumber(p.sold)}
                        <span className="text-[11px] font-semibold text-ink-3 ml-1">sold</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card>
              {/* Neutral framing — the plan is explicit that these are not
                  automatically "bad" products. */}
              <SectionTitle
                title="Low Sales"
                subtitle="Review required — not necessarily poor products"
                icon={<TrendingDown size={17} className="text-info" />}
              />
              {view.low.length === 0 ? (
                <p className="text-[13px] text-ink-3 py-4 text-center">
                  Every product is selling above the review threshold.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {view.low.map((p) => (
                    <li key={p.productId} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-semibold text-ink truncate">
                          {p.name}
                        </span>
                        <span className="block text-[11.5px] text-ink-3 tnum">
                          {formatMoney(p.revenue)}
                        </span>
                      </span>
                      <Badge tone="info">{p.sold} sold</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-4">
              <Card>
                <SectionTitle title="Peak Hours" icon={<Clock size={17} className="text-accent" />} />
                {view.peak ? (
                  <>
                    <p className="text-[24px] font-extrabold text-ink leading-tight">
                      {view.peak.label}
                    </p>
                    <p className="text-[13.5px] text-ink-2 mt-1 tnum">
                      {formatMoney(view.peak.sales)} in sales
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-ink-3">Not enough data yet.</p>
                )}
              </Card>

              <Card>
                <SectionTitle title="Best Category" icon={<Target size={17} className="text-success" />} />
                {view.categories[0] && view.categories[0].revenue > 0 ? (
                  <>
                    <p className="text-[19px] font-extrabold text-ink leading-tight">
                      {view.categories[0].icon} {view.categories[0].name}
                    </p>
                    <p className="text-[13.5px] text-ink-2 mt-1 tnum">
                      {formatMoney(view.categories[0].revenue)} · {view.categories[0].sold} items
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-ink-3">Not enough data yet.</p>
                )}
              </Card>
            </div>
          </div>

          {/* Payments + discounts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <SectionTitle title="Payment Split" icon={<CreditCard size={17} className="text-accent" />} />
              <ShareBar
                segments={view.payments.map((p, i) => ({
                  label: p.label,
                  value: p.amount,
                  percent: p.percent,
                  color: ['var(--color-accent)', 'var(--color-accent-300)', 'var(--color-line-strong)'][i] ?? 'var(--color-line-strong)',
                }))}
              />
              <div className="grid grid-cols-3 gap-3 mt-4">
                {view.payments.map((p, i) => (
                  <div key={p.method}>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          background:
                            ['var(--color-accent)', 'var(--color-accent-300)', 'var(--color-line-strong)'][i] ??
                            'var(--color-line-strong)',
                        }}
                      />
                      <span className="text-[12.5px] font-bold text-ink-2">{p.label}</span>
                    </div>
                    <p className="text-[16px] font-extrabold text-ink tnum mt-1">
                      {p.percent.toFixed(0)}%
                    </p>
                    <p className="text-[12px] text-ink-3 tnum">{formatMoney(p.amount)}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionTitle title="Discounts" icon={<Tag size={17} className="text-danger" />} />
              <p className="text-[26px] font-extrabold text-ink tnum leading-tight">
                {formatMoney(view.discounts.total)}
              </p>
              <p className="text-[13px] text-ink-3 mt-0.5">
                {view.discounts.avgPercent.toFixed(1)}% of gross sales
              </p>
              <div className="mt-4 pt-3.5 border-t border-line space-y-2">
                <MiniRow label="Orders discounted" value={formatNumber(view.discounts.billCount)} />
                <MiniRow label="Item level" value={formatMoney(view.discounts.itemDiscount)} />
                <MiniRow label="Bill level" value={formatMoney(view.discounts.billDiscount)} />
                {summary.refunds > 0 && (
                  <MiniRow label="Refunds" value={formatMoney(summary.refunds)} tone="danger" />
                )}
              </div>
            </Card>
          </div>
        </>
      )}

      {/* Quick actions (Plan §33) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickAction to="/billing" icon={<Plus size={19} />} label="New Bill" primary />
        <QuickAction to="/billing/history" icon={<Receipt size={19} />} label="Bill History" />
        <QuickAction to="/products" icon={<Layers size={19} />} label="Products" />
        <QuickAction to="/reports" icon={<Target size={19} />} label="Reports" />
      </div>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function KpiCard({
  label, value, change, icon, sub, accent, invertChange, compareLabel,
}: {
  label: string;
  value: string;
  change?: number | null;
  icon?: React.ReactNode;
  sub?: string;
  accent?: boolean;
  /** For metrics where a rise is bad news — discounts, refunds. */
  invertChange?: boolean;
  compareLabel?: string;
}) {
  const up = (change ?? 0) > 0;
  const good = invertChange ? !up : up;
  const show = change !== null && change !== undefined && Math.abs(change) >= 0.05;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;

  return (
    <Card
      className={clsx('dense-p', accent && 'border-accent/40 bg-accent-50/40')}
      padded={false}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-extrabold text-ink-3 uppercase tracking-wider">{label}</p>
        {icon && <span className="text-ink-3 shrink-0">{icon}</span>}
      </div>
      <p className="text-[21px] sm:text-[25px] font-extrabold text-ink tnum mt-1.5 leading-none">
        {value}
      </p>
      <div className="flex items-center gap-2 mt-2 min-h-[18px]">
        {show ? (
          <span
            className={clsx(
              'inline-flex items-center gap-0.5 text-[12px] font-bold tnum',
              good ? 'text-success' : 'text-danger',
            )}
          >
            <Arrow size={13} />
            {Math.abs(change!).toFixed(1)}%
          </span>
        ) : change === null ? (
          <span className="text-[11.5px] text-ink-3">no prior data</span>
        ) : null}
        {show && compareLabel && (
          <span className="text-[11.5px] text-ink-3">{compareLabel}</span>
        )}
        {sub && <span className="text-[11.5px] text-ink-3">{sub}</span>}
      </div>
    </Card>
  );
}

function MiniRow({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12.5px] text-ink-2">{label}</span>
      <span className={clsx('text-[13px] font-bold tnum', tone === 'danger' ? 'text-danger' : 'text-ink')}>
        {value}
      </span>
    </div>
  );
}

function QuickAction({
  to, icon, label, primary,
}: { to: string; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={clsx(
        'flex items-center gap-2.5 p-4 rounded-2xl border font-bold text-[14px] transition-all active:scale-[0.98]',
        primary
          ? 'bg-accent text-accent-fg border-accent shadow-sm hover:bg-accent-600'
          : 'bg-surface text-ink border-line hover:border-accent',
      )}
    >
      <span className={primary ? '' : 'text-accent'}>{icon}</span>
      {label}
    </Link>
  );
}
