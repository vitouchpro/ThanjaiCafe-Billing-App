import { useEffect, useState } from 'react';
import { supabase } from '@/services/cloud/client';
import { fetchKitchenOrders, subscribeToKitchen } from '@/services/cloud/orders';
import { orderToBill } from '@/services/billing/orderToBill';
import { useAppStore } from '@/store/useAppStore';
import type { CloudOrder } from '@/types/order';

/* Turns paid cloud orders into local bills.

   Two tills may both be watching the same order. The claim is a conditional
   update — status must still be PAID — so exactly one device wins and writes
   the bill. The loser finds nothing updated and does nothing, which is what
   stops one order becoming two bills with two invoice numbers. */

export const buildClaim = (orderId: string) => ({
  match: { id: orderId, status: 'PAID' as const },
  patch: { status: 'ACCEPTED' as const, accepted_at: new Date().toISOString() },
});

/** Returns true if this device won the claim and should write the bill. */
export async function claimOrder(orderId: string): Promise<boolean> {
  if (!supabase) return false;
  const { match, patch } = buildClaim(orderId);
  const { data } = await supabase
    .from('orders').update(patch)
    .eq('id', match.id).eq('status', match.status)
    .select();
  return Boolean(data?.length);
}

/** The orders this device should claim and bill. A kitchen screen passes
    createBills=false: it displays orders, and must not write a bill into its own
    local database where the till would never see it. */
export function ordersToClaim(list: CloudOrder[], createBills: boolean): CloudOrder[] {
  return createBills ? list.filter((o) => o.status === 'PAID') : [];
}

/** An order that was paid for but could not be turned into a bill. */
export interface OrderProblem {
  orderId: string;
  token: string;
  tableCode: string;
  reason: string;
  /** True once an invoice number was spent — needs a person, not a retry. */
  numberSpent: boolean;
}

export function useOrderIntake(enabled: boolean, options: { createBills?: boolean } = {}) {
  const createBills = options.createBills ?? true;
  const [orders, setOrders] = useState<CloudOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  /* True once the first fetch has succeeded. Consumers that must not react to
     what was already on the board at load (auto-print) wait for this. */
  const [loaded, setLoaded] = useState(false);

  /* A customer has paid. If the bill cannot be written, that must reach a human
     rather than a console nobody is reading — either the order is structurally
     unbillable and loops on every refresh, or the write failed after the
     invoice number was spent and nothing will retry it at all. Both are money
     already taken with no bill, so the page surfaces them. */
  const [problems, setProblems] = useState<OrderProblem[]>([]);

  const noteProblem = (p: OrderProblem) =>
    setProblems((list) => [...list.filter((x) => x.orderId !== p.orderId), p]);

  useEffect(() => {
    if (!enabled || !supabase) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const list = await fetchKitchenOrders();
        if (cancelled) return;
        setOrders(list);
        setError(null);
        setLoaded(true);

        // Auto-accept: every PAID order becomes a bill on whichever till
        // wins the claim. orderToBill can throw (bad status, no lines, a
        // total that disagrees with the gateway) — one bad order must not
        // stall every other order in this refresh.
        for (const order of ordersToClaim(list, createBills)) {
          if (!await claimOrder(order.id)) continue;

          const store = useAppStore.getState();

          /* Validate BEFORE reserving an invoice number. orderToBill throws on
             a bad status, an order with no lines, or a total that disagrees
             with what the gateway settled — and reserving first would burn a
             number on an order that never becomes a bill, leaving a permanent
             gap in a GST invoice sequence. Dry-run with the number this bill
             would get, then reserve for real only once it is known good. */
          const billContext = {
            settings: store.settings,
            cashierId: store.currentUser?.id ?? 'online',
            cashierName: store.currentUser?.name ?? 'Online',
          };

          try {
            orderToBill(order, { seq: 0, billNo: 'DRY-RUN', ...billContext });
          } catch (err) {
            /* The order cannot become a bill. Hand it back so it stays visible
               as PAID-but-unbilled rather than sitting in ACCEPTED with no bill
               and nothing ever retrying it. */
            console.error(`Refusing to bill order ${order.token ?? order.id}:`, err);
            noteProblem({
              orderId: order.id,
              token: order.token,
              tableCode: order.tableCode,
              reason: err instanceof Error ? err.message : 'This order cannot be billed',
              numberSpent: false,
            });
            /* Not a violation of the single-writer rule: this hands an order
               that was ALREADY paid back from ACCEPTED to PAID, so it stays
               visible as needing a bill. Only the webhook can decide that money
               arrived; the `.eq('status','ACCEPTED')` guard is what keeps this
               a hand-back rather than a claim. */
            await supabase!.from('orders')
              .update({ status: 'PAID', accepted_at: null })
              .eq('id', order.id).eq('status', 'ACCEPTED');
            continue;
          }

          try {
            const { seq, billNo } = await store.reserveBillNo();
            const bill = orderToBill(order, { seq, billNo, ...billContext });
            await store.saveBill(bill);
            setProblems((list) => list.filter((x) => x.orderId !== order.id));
            await supabase!.from('orders').update({ bill_id: bill.id }).eq('id', order.id);
          } catch (err) {
            // Past validation, so this is a write failure (IndexedDB or the
            // network), not bad data. The number is spent; the order stays
            // ACCEPTED and the next refresh will not re-claim it.
            console.error(`Could not save the bill for order ${order.token ?? order.id}:`, err);
            noteProblem({
              orderId: order.id,
              token: order.token,
              tableCode: order.tableCode,
              reason: err instanceof Error ? err.message : 'Could not save the bill',
              numberSpent: true,
            });
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load orders');
      }
    };

    void refresh();

    /* Defence in depth. Online ordering is an ADDITION to the till, so nothing
       about it may stop a cashier taking a walk-in payment. A throw inside this
       effect propagates to the error boundary and takes down the whole app —
       which is exactly what a channel-name collision did here once. Live
       updates degrade to the poll below; the till keeps working. */
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeToKitchen(() => { void refresh(); });
    } catch (err) {
      console.error('Live order updates unavailable; falling back to polling:', err);
    }

    // A fallback poll, because a delayed webhook or a dropped socket must not
    // strand a paid order.
    const poll = setInterval(() => { void refresh(); }, 30_000);

    return () => { cancelled = true; unsubscribe(); clearInterval(poll); };
  }, [enabled, createBills]);

  return { orders, error, problems, loaded };
}
