import { useEffect, useRef } from 'react';
import { printKot } from '@/services/billing/kot';
import type { CloudOrder } from '@/types/order';

/* Fires the kitchen ticket the moment a paid order reaches the kitchen screen.

   Deciding WHAT to print is pure and tested. The rules:
   - Whatever is on the board when the screen opens counts as already handled,
     so reopening the page never reprints the queue.
   - A ticket prints once per order, remembered across reloads.
   - Only orders that are paid and not yet being cooked print. */

const PRINTED_KEY = 'kot-printed-ids';
const KEEP = 300;
const STAGGER_MS = 1500;

/** PAID, or ACCEPTED when a till claimed it first. Never anything unpaid. */
export const AUTO_PRINT_STATUSES: readonly CloudOrder['status'][] = ['PAID', 'ACCEPTED'];

export function selectOrdersToAutoPrint(
  current: CloudOrder[],
  alreadyPrinted: ReadonlySet<string>,
  firstLoad: boolean,
): CloudOrder[] {
  if (firstLoad) return [];
  return current.filter((o) => AUTO_PRINT_STATUSES.includes(o.status) && !alreadyPrinted.has(o.id));
}

export function rememberPrinted(existing: readonly string[], newIds: readonly string[], keep = KEEP): string[] {
  return [...existing, ...newIds.filter((id) => !existing.includes(id))].slice(-keep);
}

function loadPrinted(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PRINTED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function savePrinted(ids: string[]): void {
  try {
    localStorage.setItem(PRINTED_KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: the worst case is a repeat print after a reload.
  }
}

/** `enabled` should be `loaded && setting`, so the first real load is the
    baseline rather than an empty initial state. */
export function useKotAutoPrint(orders: CloudOrder[], enabled: boolean, businessName: string): void {
  const baselineTaken = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const printed = loadPrinted();
    const firstLoad = !baselineTaken.current;
    baselineTaken.current = true;

    if (firstLoad) {
      savePrinted(rememberPrinted(printed, orders.map((o) => o.id)));
      return;
    }

    const toPrint = selectOrdersToAutoPrint(orders, new Set(printed), false);
    if (!toPrint.length) return;

    savePrinted(rememberPrinted(printed, toPrint.map((o) => o.id)));
    toPrint.forEach((order, i) => {
      setTimeout(() => {
        try {
          printKot(order, businessName);
        } catch (err) {
          console.error(`Could not auto-print the KOT for ${order.token}:`, err);
        }
      }, i * STAGGER_MS);
    });
  }, [orders, enabled, businessName]);
}
