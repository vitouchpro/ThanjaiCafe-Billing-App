import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import { formatMoney, formatMoneyShort } from '@/utils/money';

/** Anything with a label and a numeric series — hourly buckets, daily
    buckets, per-product rows all satisfy this. */
export interface ChartRow {
  label: string;
  sales: number;
  orders?: number;
  [key: string]: unknown;
}

/* Chart shells. Colours come from the theme tokens so charts follow the
   accent and dark mode without a second palette to maintain. */

const AXIS = { fontSize: 11, fontWeight: 600 };

function ChartTooltip({
  active, payload, label, valueLabel = 'Sales', secondary,
}: {
  active?: boolean;
  payload?: { value: number; payload: ChartRow }[];
  label?: string;
  valueLabel?: string;
  secondary?: (row: ChartRow) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow-md)]">
      <p className="text-[12px] font-bold text-ink">{label}</p>
      <p className="text-[15px] font-extrabold text-ink tnum mt-0.5">
        {formatMoney(payload[0].value)}
      </p>
      <p className="text-[11px] text-ink-3">{valueLabel}</p>
      {secondary?.(row)}
    </div>
  );
}

export function SalesAreaChart({
  data, height = 220, xKey = 'label', yKey = 'sales',
}: {
  data: ChartRow[];
  height?: number;
  xKey?: string;
  yKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ ...AXIS, fill: 'var(--color-ink-3)' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={18}
        />
        <YAxis
          tick={{ ...AXIS, fill: 'var(--color-ink-3)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatMoneyShort(Number(v))}
          width={54}
        />
        <Tooltip
          content={
            <ChartTooltip
              secondary={(r) =>
                typeof r.orders === 'number' ? (
                  <p className="text-[11px] text-ink-3 mt-1">{r.orders} orders</p>
                ) : null
              }
            />
          }
          cursor={{ stroke: 'var(--color-accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
        />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke="var(--color-accent)"
          strokeWidth={2.5}
          fill="url(#salesFill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SalesBarChart({
  data, height = 220, xKey = 'label', yKey = 'sales', highlightMax,
}: {
  data: ChartRow[];
  height?: number;
  xKey?: string;
  yKey?: string;
  highlightMax?: boolean;
}) {
  const max = highlightMax ? Math.max(...data.map((d) => Number(d[yKey]) || 0)) : -1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ ...AXIS, fill: 'var(--color-ink-3)' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={10}
        />
        <YAxis
          tick={{ ...AXIS, fill: 'var(--color-ink-3)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatMoneyShort(Number(v))}
          width={54}
        />
        <Tooltip
          content={
            <ChartTooltip
              secondary={(r) =>
                typeof r.orders === 'number' ? (
                  <p className="text-[11px] text-ink-3 mt-1">{r.orders} orders</p>
                ) : null
              }
            />
          }
          cursor={{ fill: 'var(--color-surface-3)' }}
        />
        <Bar dataKey={yKey} radius={[6, 6, 0, 0]} maxBarSize={46}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={
                highlightMax && Number(d[yKey]) === max
                  ? 'var(--color-accent)'
                  : 'var(--color-accent-300)'
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal share bar — payment split, category mix. */
export function ShareBar({
  segments,
}: { segments: { label: string; value: number; percent: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return <div className="h-2.5 rounded-full bg-surface-3" />;

  return (
    <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-3">
      {segments.map((s) =>
        s.percent > 0 ? (
          <div
            key={s.label}
            style={{ width: `${s.percent}%`, background: s.color }}
            title={`${s.label} ${s.percent.toFixed(1)}%`}
          />
        ) : null,
      )}
    </div>
  );
}
