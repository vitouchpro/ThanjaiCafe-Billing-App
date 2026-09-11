import { supabase } from './client';
import { KITCHEN_VISIBLE } from './status';
import type { CloudOrder, CloudOrderLine, OrderStatus } from '@/types/order';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const opt = (v: unknown): string | undefined => (v == null ? undefined : String(v));
const num = (v: unknown): number => Number(v ?? 0);

export function rowToOrder(row: Row, lineRows: Row[]): CloudOrder {
  return {
    id: str(row.id),
    token: str(row.token),
    tableCode: str(row.table_code),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    customerName: str(row.customer_name),
    customerPhone: str(row.customer_phone),
    status: str(row.status) as OrderStatus,
    subtotal: num(row.subtotal),
    tax: num(row.tax),
    total: num(row.total),
    razorpayOrderId: opt(row.razorpay_order_id),
    razorpayPaymentId: opt(row.razorpay_payment_id),
    billId: opt(row.bill_id),
    note: opt(row.note),
    createdAt: str(row.created_at),
    paidAt: opt(row.paid_at),
    acceptedAt: opt(row.accepted_at),
    readyAt: opt(row.ready_at),
    servedAt: opt(row.served_at),
    lines: lineRows.map((l): CloudOrderLine => ({
      id: str(l.id),
      orderId: str(l.order_id),
      productId: str(l.product_id),
      name: str(l.name),
      unitPrice: num(l.unit_price),
      qty: num(l.qty),
      taxRate: num(l.tax_rate),
      note: opt(l.note),
    })),
  };
}

export async function fetchOrder(id: string): Promise<CloudOrder | null> {
  if (!supabase) return null;
  const { data: order } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
  if (!order) return null;
  const { data: lines } = await supabase.from('order_lines').select('*').eq('order_id', id);
  return rowToOrder(order, lines ?? []);
}

/** Live updates for one order — what the customer's phone watches. */
export function subscribeToOrder(id: string, onChange: (o: CloudOrder) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`order:${id}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
      () => { void fetchOrder(id).then((o) => { if (o) onChange(o); }); })
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

/** Live paid orders — what the kitchen screen and the till watch.
    Unpaid orders are filtered out here as well as in the query, so no code
    path can put an unpaid ticket in front of the kitchen. */
export async function fetchKitchenOrders(): Promise<CloudOrder[]> {
  if (!supabase) return [];
  const { data: orders } = await supabase
    .from('orders').select('*').in('status', KITCHEN_VISIBLE).order('created_at');
  if (!orders?.length) return [];
  const ids = orders.map((o: Row) => String(o.id));
  const { data: lines } = await supabase.from('order_lines').select('*').in('order_id', ids);
  const byOrder = new Map<string, Row[]>();
  for (const l of (lines ?? []) as Row[]) {
    const k = String(l.order_id);
    byOrder.set(k, [...(byOrder.get(k) ?? []), l]);
  }
  return (orders as Row[]).map((o) => rowToOrder(o, byOrder.get(String(o.id)) ?? []));
}

let channelSeq = 0;

export function subscribeToKitchen(onChange: () => void): () => void {
  if (!supabase) return () => {};

  /* A UNIQUE channel name per subscriber, not a shared 'kitchen'.

     supabase-js hands back the SAME channel object for a name that already
     exists, and calling .on() on one that has already subscribed throws
     "cannot add postgres_changes callbacks after subscribe()". That happens
     two ways here: React StrictMode mounts every effect twice in development,
     and three separate places subscribe at once — the alert host (mounted on
     every staff screen), the kitchen board, and the online orders page.

     The throw propagated out of the effect and took the whole till to its
     error boundary immediately after login. */
  const client = supabase;
  const channel = client
    .channel(`kitchen-${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
    .subscribe();

  return () => { void client.removeChannel(channel); };
}

export async function advanceStatus(id: string, to: OrderStatus): Promise<void> {
  if (!supabase) throw new Error('Online ordering is not configured');
  const stamp: Record<string, string> = {};
  if (to === 'READY') stamp.ready_at = new Date().toISOString();
  if (to === 'SERVED') stamp.served_at = new Date().toISOString();
  const { error } = await supabase.from('orders').update({ status: to, ...stamp }).eq('id', id);
  if (error) throw new Error(error.message);
}
