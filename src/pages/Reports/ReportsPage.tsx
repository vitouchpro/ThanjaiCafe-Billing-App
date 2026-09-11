import { useMemo, useState } from 'react';
import {
  BarChart3, Download, Package, Tag, TrendingUp, Wallet, RotateCcw, ChevronLeft, ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { usePermission } from '@/hooks';
import {
  Badge, Button, Card, EmptyState, SectionTitle, Segmented, Select,
} from '@/components/ui';
import { SalesAreaChart, SalesBarChart, ShareBar } from '@/components/charts';
import {
  PERFORMANCE_SORTS, billsBetween, categoryPerformance, dailyBucketsDated,
  discountSummary, hourlyBuckets, paymentSplit, productPerformance,
  sortPerformance, summarize, type PerformanceSort,
} from '@/services/reports/analytics';
import { exportBillsCsv, exportProductsCsv, downloadCsv } from '@/services/reports/export';
import { formatMoney, formatNumber, pctChange } from '@/utils/money';
import {
  addDays, endOfMonth, endOfWeek, formatDate, formatDateShort, formatMonthYear,
  startOfDay, startOfMonth, startOfWeek,
} from '@/utils/date';

/* Plan §15–19 — reports organised by period, then by subject. */

type Period = 'daily' | 'weekly' | 'monthly';
type Tab = 'sales' | 'products' | 'payments' | 'discounts' | 'refunds';

const PERIODS = [
  { value: 'daily' as const, label: 'Daily' },
  { value: 'weekly' as const, label: 'Weekly' },
  { value: 'monthly' as const, label: 'Monthly' },
];

const TABS: { value: Tab; label: string; icon: typeof TrendingUp }[] = [
  { value: 'sales', label: 'Sales', icon: TrendingUp },
  { value: 'products', label: 'Products', icon: Package },
  { value: 'payments', label: 'Payments', icon: Wallet },
  { value: 'discounts', label: 'Discounts', icon: Tag },
  { value: 'refunds', label: 'Refunds', icon: RotateCcw },
];

export function ReportsPage() {
  const bills = useAppStore((s) => s.bills);
  const products = useAppStore((s) => s.products);
  const categories = useAppStore((s) => s.categories);
  const settings = useAppStore((s) => s.settings);
  const canSeeCost = usePermission('product_cost');

  const [period, setPeriod] = useState<Period>('daily');
  const [tab, setTab] = useState<Tab>('sales');
  const [offset, setOffset] = useState(0); // 0 = current period, -1 = previous
  const [sort, setSort] = useState<PerformanceSort>('best_selling');

  const window = useMemo(() => {
    const today = startOfDay(new Date());

    if (period === 'daily') {
      const day = addDays(today, offset);
      return { from: day, to: day, label: formatDate(day), prevLabel: 'yesterday' };
    }
    if (period === 'weekly') {
      const anchor = addDays(today, offset * 7);
      const from = startOfWeek(anchor);
      const to = endOfWeek(anchor);
      return {
        from,
        to,
        label: `${formatDateShort(from)} — ${formatDateShort(to)}`,
        prevLabel: 'previous week',
      };
    }
    const anchor = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return {
      from: startOfMonth(anchor),
      to: endOfMonth(anchor),
      label: formatMonthYear(anchor),
      prevLabel: 'previous month',
    };
  }, [period, offset]);

  const data = useMemo(() => {
    const current = billsBetween(bills, window.from, window.to);

    // Immediately preceding window of the same length.
    const spanDays =
      Math.round((window.to.getTime() - window.from.getTime()) / 86400000) + 1;
    const prevTo = addDays(window.from, -1);
    const prevFrom = addDays(prevTo, -(spanDays - 1));
    const previous = billsBetween(bills, prevFrom, prevTo);

    const perf = productPerformance(current, products);

    return {
      current,
      summary: summarize(current),
      prevSummary: summarize(previous),
      perf,
      payments: paymentSplit(current),
      discounts: discountSummary(current),
      categories: categoryPerformance(perf, categories),
      trend:
        period === 'daily'
          ? hourlyBuckets(current)
          : dailyBucketsDated(current, window.from, window.to).map((d) => ({
              label: period === 'weekly' ? d.day : d.label,
              sales: d.sales,
              orders: d.orders,
            })),
      refunded: current.filter((b) => b.status === 'refunded'),
    };
  }, [bills, products, categories, window, period]);

  const { summary, prevSummary } = data;
  const isCurrent = offset === 0;

  return (
    <div className="p-4 sm:p-5 max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[21px] sm:text-[24px] font-extrabold text-ink">Reports</h1>
          <p className="text-[13.5px] text-ink-3 mt-0.5">{window.label}</p>
        </div>
        <Segmented
          options={PERIODS}
          value={period}
          onChange={(v) => { setPeriod(v); setOffset(0); }}
        />
      </div>

      {/* Period stepper */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOffset(offset - 1)} aria-label="Previous period">
          <ChevronLeft size={16} />
        </Button>
        <span className="text-[13.5px] font-bold text-ink px-2">{window.label}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={isCurrent}
          onClick={() => setOffset(Math.min(0, offset + 1))}
          aria-label="Next period"
        >
          <ChevronRight size={16} />
        </Button>
        {!isCurrent && (
          <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>Back to current</Button>
        )}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            icon={<Download size={15} />}
            onClick={() => {
              downloadCsv(
                `bills-${window.label.replace(/[^\w]+/g, '-').toLowerCase()}.csv`,
                exportBillsCsv(data.current, settings),
              );
              }}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Metric
          label="Total Sales"
          value={formatMoney(summary.totalSales)}
          change={pctChange(summary.totalSales, prevSummary.totalSales)}
          compare={window.prevLabel}
        />
        <Metric
          label="Orders"
          value={formatNumber(summary.orders)}
          change={pctChange(summary.orders, prevSummary.orders)}
          compare={window.prevLabel}
        />
        <Metric
          label="Average Bill"
          value={formatMoney(summary.avgBill)}
          change={pctChange(summary.avgBill, prevSummary.avgBill)}
          compare={window.prevLabel}
        />
        {canSeeCost ? (
          <Metric
            label="Gross Margin"
            value={formatMoney(summary.margin)}
            sub={summary.totalSales ? `${((summary.margin / summary.totalSales) * 100).toFixed(1)}% of sales` : undefined}
          />
        ) : (
          <Metric label="Discounts" value={formatMoney(summary.discount)} />
        )}
      </div>

      {summary.orders === 0 ? (
        <Card>
          <EmptyState
            icon={<BarChart3 size={22} />}
            title="No sales in this period"
            description="Pick another period, or start billing to build up your reports."
          />
        </Card>
      ) : (
        <>
          {/* Subject tabs */}
          <div className="overflow-x-auto no-scrollbar -mx-1 px-1">
            <div className="inline-flex bg-surface-3 rounded-xl p-1 gap-1">
              {TABS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg text-[13.5px] font-semibold whitespace-nowrap transition',
                    tab === t.value ? 'bg-surface text-ink shadow-[var(--shadow-sm)]' : 'text-ink-3 hover:text-ink',
                  )}
                >
                  <t.icon size={15} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tab === 'sales' && (
            <>
              <Card>
                <SectionTitle
                  title={period === 'daily' ? 'Sales by hour' : 'Sales by day'}
                  subtitle={window.label}
                />
                {period === 'daily' ? (
                  <SalesAreaChart data={data.trend} height={260} />
                ) : (
                  <SalesBarChart data={data.trend} height={260} highlightMax />
                )}
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <SectionTitle title="Summary" />
                  <div className="divide-y divide-line">
                    <SumRow label="Total sales" value={formatMoney(summary.totalSales)} strong />
                    <SumRow label="Orders" value={formatNumber(summary.orders)} />
                    <SumRow label="Average bill" value={formatMoney(summary.avgBill)} />
                    <SumRow label="GST collected" value={formatMoney(summary.tax)} />
                    <SumRow label="Discounts" value={formatMoney(summary.discount)} tone="danger" />
                    <SumRow label="Refunds" value={formatMoney(summary.refunds)} tone="danger" />
                    {canSeeCost && <SumRow label="Cost of goods" value={formatMoney(summary.cost)} />}
                    {canSeeCost && (
                      <SumRow label="Gross margin" value={formatMoney(summary.margin)} tone="success" strong />
                    )}
                  </div>
                </Card>

                <Card>
                  <SectionTitle title="By category" />
                  {data.categories.filter((c) => c.revenue > 0).length === 0 ? (
                    <p className="text-[13px] text-ink-3 py-4 text-center">No category data.</p>
                  ) : (
                    <ul className="space-y-3">
                      {data.categories
                        .filter((c) => c.revenue > 0)
                        .map((c) => {
                          const pct = summary.totalSales ? (c.revenue / summary.totalSales) * 100 : 0;
                          return (
                            <li key={c.categoryId}>
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className="text-[13.5px] font-semibold text-ink truncate">
                                  {c.icon} {c.name}
                                </span>
                                <span className="text-[13px] font-bold text-ink tnum shrink-0">
                                  {formatMoney(c.revenue)}
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
                                <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )}

          {tab === 'products' && (
            <Card padded={false}>
              <div className="p-4 sm:p-5 pb-3 flex flex-wrap items-center justify-between gap-3">
                <SectionTitle title="Product performance" subtitle={window.label} />
                <div className="flex gap-2">
                  <Select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as PerformanceSort)}
                    className="h-10 w-[190px]"
                  >
                    {PERFORMANCE_SORTS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                  <Button
                    variant="outline"
                    icon={<Download size={15} />}
                    onClick={() =>
                      downloadCsv(
                        `products-${window.label.replace(/[^\w]+/g, '-').toLowerCase()}.csv`,
                        exportProductsCsv(sortPerformance(data.perf, sort), categories, canSeeCost),
                      )
                    }
                  >
                    CSV
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px]">
                  <thead>
                    <tr className="border-y border-line bg-surface-2/60">
                      <Th className="pl-4 sm:pl-5">Product</Th>
                      <Th align="right">Sold</Th>
                      <Th align="right">Revenue</Th>
                      <Th align="right">Discount</Th>
                      {canSeeCost && <Th align="right" className="pr-4 sm:pr-5">Margin</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortPerformance(data.perf, sort)
                      .slice(0, 40)
                      .map((r) => {
                        const cat = categories.find((c) => c.id === r.categoryId);
                        return (
                          <tr key={r.productId} className="border-b border-line last:border-0">
                            <td className="py-2.5 pl-4 sm:pl-5">
                              <p className="text-[14px] font-semibold text-ink">{r.name}</p>
                              <p className="text-[11.5px] text-ink-3">{cat ? `${cat.icon} ${cat.name}` : '—'}</p>
                            </td>
                            <td className="text-right text-[14px] font-bold text-ink tnum">
                              {formatNumber(r.sold)}
                            </td>
                            <td className="text-right text-[14px] text-ink tnum">{formatMoney(r.revenue)}</td>
                            <td className="text-right text-[13px] tnum">
                              {r.discount > 0 ? (
                                <span className="text-danger">{formatMoney(r.discount)}</span>
                              ) : (
                                <span className="text-ink-3">—</span>
                              )}
                            </td>
                            {canSeeCost && (
                              <td className="text-right pr-4 sm:pr-5">
                                <span
                                  className={clsx(
                                    'text-[13.5px] font-bold tnum',
                                    r.margin >= 0 ? 'text-success' : 'text-danger',
                                  )}
                                >
                                  {formatMoney(r.margin)}
                                </span>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {tab === 'payments' && (
            <Card>
              <SectionTitle title="Payment breakdown" subtitle={window.label} />
              <ShareBar
                segments={data.payments.map((p, i) => ({
                  label: p.label,
                  value: p.amount,
                  percent: p.percent,
                  color: ['var(--color-accent)', 'var(--color-accent-300)', 'var(--color-line-strong)'][i] ?? 'var(--color-line-strong)',
                }))}
              />
              <div className="divide-y divide-line mt-4">
                {data.payments.map((p) => (
                  <div key={p.method} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="text-[14px] font-bold text-ink">{p.label}</p>
                      <p className="text-[12px] text-ink-3 tnum">
                        {p.count} bills · {p.percent.toFixed(1)}%
                      </p>
                    </div>
                    <p className="text-[16px] font-extrabold text-ink tnum">{formatMoney(p.amount)}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === 'discounts' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <SectionTitle title="Discount summary" subtitle={window.label} />
                <p className="text-[30px] font-extrabold text-ink tnum leading-tight">
                  {formatMoney(data.discounts.total)}
                </p>
                <p className="text-[13px] text-ink-3 mt-0.5">
                  {data.discounts.avgPercent.toFixed(1)}% of gross sales
                </p>
                <div className="divide-y divide-line mt-4">
                  <SumRow label="Item-level discounts" value={formatMoney(data.discounts.itemDiscount)} />
                  <SumRow label="Bill-level discounts" value={formatMoney(data.discounts.billDiscount)} />
                  <SumRow label="Bills discounted" value={formatNumber(data.discounts.billCount)} />
                  <SumRow
                    label="Share of bills"
                    value={`${summary.orders ? ((data.discounts.billCount / summary.orders) * 100).toFixed(0) : 0}%`}
                  />
                </div>
              </Card>

              <Card>
                <SectionTitle title="Most discounted products" />
                {sortPerformance(data.perf, 'highest_discount').filter((r) => r.discount > 0).length === 0 ? (
                  <p className="text-[13px] text-ink-3 py-4 text-center">No discounts in this period.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {sortPerformance(data.perf, 'highest_discount')
                      .filter((r) => r.discount > 0)
                      .slice(0, 8)
                      .map((r) => (
                        <li key={r.productId} className="flex items-center justify-between gap-3 py-2.5">
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-semibold text-ink truncate">{r.name}</span>
                            <span className="block text-[11.5px] text-ink-3 tnum">
                              {r.sold} sold · {formatMoney(r.revenue)} revenue
                            </span>
                          </span>
                          <span className="text-[14px] font-bold text-danger tnum shrink-0">
                            {formatMoney(r.discount)}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </Card>
            </div>
          )}

          {tab === 'refunds' && (
            <Card>
              <SectionTitle
                title="Refunds"
                subtitle={window.label}
                action={<Badge tone={data.refunded.length ? 'danger' : 'success'}>
                  {formatMoney(summary.refunds)}
                </Badge>}
              />
              {data.refunded.length === 0 ? (
                <EmptyState
                  icon={<RotateCcw size={22} />}
                  title="No refunds in this period"
                  description="Every bill in this window was completed without a refund."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {data.refunded.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-3">
                      <span className="min-w-0">
                        <span className="block text-[14px] font-bold text-ink">{b.billNo}</span>
                        <span className="block text-[12px] text-ink-3">
                          {formatDate(b.createdAt)} · {b.cashierName}
                        </span>
                      </span>
                      <span className="text-[15px] font-extrabold text-danger tnum shrink-0">
                        {formatMoney(b.refundAmount ?? b.totals.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Th({
  children, align = 'left', className,
}: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <th
      className={clsx(
        'py-2.5 text-[11px] font-extrabold text-ink-3 uppercase tracking-wider',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Metric({
  label, value, change, sub, compare,
}: {
  label: string;
  value: string;
  change?: number | null;
  sub?: string;
  compare?: string;
}) {
  const show = change !== null && change !== undefined && Math.abs(change) >= 0.05;
  const up = (change ?? 0) > 0;

  return (
    <Card className="dense-p" padded={false}>
      <p className="text-[11px] font-extrabold text-ink-3 uppercase tracking-wider">{label}</p>
      <p className="text-[21px] sm:text-[24px] font-extrabold text-ink tnum mt-1.5 leading-none">
        {value}
      </p>
      <p className="text-[11.5px] mt-2 min-h-[16px]">
        {show ? (
          <span className={clsx('font-bold tnum', up ? 'text-success' : 'text-danger')}>
            {up ? '▲' : '▼'} {Math.abs(change!).toFixed(1)}%
            {compare && <span className="text-ink-3 font-medium"> vs {compare}</span>}
          </span>
        ) : sub ? (
          <span className="text-ink-3">{sub}</span>
        ) : null}
      </p>
    </Card>
  );
}

function SumRow({
  label, value, tone, strong,
}: { label: string; value: string; tone?: 'success' | 'danger'; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className={clsx('text-[13.5px]', strong ? 'text-ink font-semibold' : 'text-ink-2')}>
        {label}
      </span>
      <span
        className={clsx(
          'font-bold tnum',
          strong ? 'text-[16px]' : 'text-[14px]',
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
