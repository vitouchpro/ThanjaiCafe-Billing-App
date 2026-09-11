import { createClient } from 'jsr:@supabase/supabase-js@2';

/* Receives bills from the till and mirrors them into the database.

   `bills` and `day_closes` have RLS on with no policy at all, so the anon key
   that ships in the browser cannot read or write a single row — these are the
   shop's financial records, and a diner scanning a table QR holds that same
   key. The write happens here instead, where the service-role key never leaves
   the server, behind the same shared secret the menu publish uses.

   This is a MIRROR. The till stays authoritative: it writes locally first so a
   cashier never waits on the network, then pushes. A bill that exists locally
   but not yet here is un-backed-up, never lost. */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-publish-token',
};

const MAX_BATCH = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const expected = Deno.env.get('PUBLISH_TOKEN') ?? '';
  const given = req.headers.get('x-publish-token') ?? '';
  if (!expected || !timingSafeEqual(given, expected)) {
    return json({ error: 'Not allowed to back up bills.' }, 401);
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json() as { bills?: unknown[]; dayCloses?: unknown[] };
    const bills = Array.isArray(body.bills) ? body.bills : [];
    const dayCloses = Array.isArray(body.dayCloses) ? body.dayCloses : [];

    if (bills.length > MAX_BATCH || dayCloses.length > MAX_BATCH) {
      return json({ error: `Send at most ${MAX_BATCH} records at a time.` }, 400);
    }

    /* The ids of what was actually stored. The till flips `synced` only for
       these, so anything omitted stays queued and is retried — which is what
       makes a partial failure safe rather than silent data loss. */
    const accepted: string[] = [];

    if (bills.length) {
      const rows = bills.map(toBillRow).filter((r): r is BillRow => r !== null);
      if (rows.length !== bills.length) {
        return json({ error: 'A bill was missing its id or bill number.' }, 400);
      }

      const { error } = await admin.from('bills').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.error('backup-bills: upsert failed', error);
        return json({ error: 'Could not back up the bills.' }, 500);
      }
      accepted.push(...rows.map((r) => r.id));
    }

    if (dayCloses.length) {
      const rows = dayCloses.map(toDayCloseRow).filter((r): r is DayCloseRow => r !== null);
      const { error } = await admin.from('day_closes').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.error('backup-bills: day_closes upsert failed', error);
        // The bills above did land, so report them rather than losing the fact.
        return json({ accepted, error: 'Bills backed up, but the day closing failed.' }, 500);
      }
    }

    return json({ accepted });
  } catch (err) {
    console.error('backup-bills: unexpected failure', err);
    return json({ error: 'Could not back up the bills.' }, 500);
  }
});

interface BillRow { id: string; bill_no: string; [k: string]: unknown }
interface DayCloseRow { id: string; [k: string]: unknown }

/* camelCase from the till, snake_case in Postgres. Mapped explicitly rather
   than by a generic transform so an unexpected extra field on a bill cannot
   silently create a column mismatch. */
function toBillRow(b: unknown): BillRow | null {
  const x = b as Record<string, unknown>;
  if (!x?.id || !x?.billNo) return null;
  return {
    id: String(x.id),
    bill_no: String(x.billNo),
    seq: Number(x.seq ?? 0),
    created_at: String(x.createdAt),
    lines: x.lines ?? [],
    totals: x.totals ?? {},
    bill_discount: Number(x.billDiscount ?? 0),
    bill_discount_type: String(x.billDiscountType ?? 'fixed'),
    payment: String(x.payment ?? 'cash'),
    cash_received: x.cashReceived ?? null,
    change_given: x.change ?? null,
    status: String(x.status ?? 'completed'),
    customer_name: x.customerName ?? null,
    customer_phone: x.customerPhone ?? null,
    cashier_id: String(x.cashierId ?? ''),
    cashier_name: String(x.cashierName ?? ''),
    note: x.note ?? null,
    refunded_at: x.refundedAt ?? null,
    refund_amount: x.refundAmount ?? null,
    cancelled_at: x.cancelledAt ?? null,
    held_label: x.heldLabel ?? null,
    source_order_id: x.sourceOrderId ?? null,
    backed_up_at: new Date().toISOString(),
  };
}

function toDayCloseRow(d: unknown): DayCloseRow | null {
  const x = d as Record<string, unknown>;
  if (!x?.id) return null;
  return {
    id: String(x.id),
    date: String(x.date),
    closed_at: String(x.closedAt),
    total_sales: Number(x.totalSales ?? 0),
    cash_sales: Number(x.cashSales ?? 0),
    upi_sales: Number(x.upiSales ?? 0),
    card_sales: Number(x.cardSales ?? 0),
    online_sales: x.onlineSales ?? null,
    discounts: Number(x.discounts ?? 0),
    refunds: Number(x.refunds ?? 0),
    orders: Number(x.orders ?? 0),
    expected_cash: Number(x.expectedCash ?? 0),
    actual_cash: Number(x.actualCash ?? 0),
    difference: Number(x.difference ?? 0),
    note: x.note ?? null,
    closed_by: String(x.closedBy ?? ''),
    backed_up_at: new Date().toISOString(),
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
