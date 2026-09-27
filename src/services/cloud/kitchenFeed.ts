import type { CloudOrder } from '@/types/order';

/* ONE live feed of the kitchen queue per device.

   Three places watch paid orders at once: the alert host on every staff
   screen, the kitchen board and the online-orders page. Each used to open its
   own Realtime channel and refetch every order and line on every change, so a
   single status tap cost three full reloads per screen. They now share this
   feed: one channel, one fetch per burst of changes, one fallback poll.

   Built as a factory with injected fetch/subscribe so it can be tested without
   a network; `kitchenFeed` at the bottom is the app's single instance. */

export interface FeedState {
  orders: CloudOrder[];
  error: string | null;
  /** True once a fetch has succeeded at least once. */
  loaded: boolean;
}

export interface FeedDeps {
  fetchOrders: () => Promise<CloudOrder[]>;
  /** Opens a live change stream; returns its close function. */
  subscribe: (onChange: () => void) => () => void;
  /** Changes arriving within this window are folded into one fetch. */
  debounceMs?: number;
  /** Fallback refresh for a dropped socket or a delayed webhook. */
  pollMs?: number;
}

export function createKitchenFeed(deps: FeedDeps) {
  const debounceMs = deps.debounceMs ?? 250;
  const pollMs = deps.pollMs ?? 30_000;

  const listeners = new Set<(s: FeedState) => void>();
  let state: FeedState = { orders: [], error: null, loaded: false };

  let unsubscribe: (() => void) | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let again = false;

  const emit = () => { for (const l of listeners) l(state); };

  /* At most one fetch at a time. A change that lands mid-fetch schedules one
     more fetch afterwards, so the last change is never missed. */
  const refresh = (): Promise<void> => {
    if (inFlight) { again = true; return inFlight; }
    inFlight = (async () => {
      try {
        const orders = await deps.fetchOrders();
        state = { orders, error: null, loaded: true };
      } catch (err) {
        state = { ...state, error: err instanceof Error ? err.message : 'Could not load orders' };
      }
      if (listeners.size) emit();
    })().finally(() => {
      inFlight = null;
      if (again && listeners.size) { again = false; void refresh(); }
      again = false;
    });
    return inFlight;
  };

  const onChange = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; void refresh(); }, debounceMs);
  };

  const start = () => {
    /* Online ordering is an ADDITION to the till: a failure to open the live
       stream must never take the till down. It degrades to the poll. */
    try {
      unsubscribe = deps.subscribe(onChange);
    } catch (err) {
      console.error('Live order updates unavailable; falling back to polling:', err);
      unsubscribe = null;
    }
    poll = setInterval(() => { void refresh(); }, pollMs);
    void refresh();
  };

  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (poll) clearInterval(poll);
    if (debounce) clearTimeout(debounce);
    poll = null;
    debounce = null;
  };

  return {
    /** Listen to the queue. The first listener opens the feed, the last closes it. */
    subscribe(listener: (s: FeedState) => void): () => void {
      listeners.add(listener);
      if (listeners.size === 1) start();
      else if (state.loaded || state.error) listener(state);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    /** Fetch now, e.g. right after this device changed an order's status. */
    refresh,
    getState: () => state,
  };
}
