import { db } from '@/services/db/db';
import { useAppStore } from '@/store/useAppStore';
import type { Bill } from '@/types';

/* Plan §32 — offline-first sync.

   Bills are written to IndexedDB the moment a payment completes, with
   `synced: 0`. This module drains that queue whenever the network is up.
   There is no server in V1, so `pushBills` is the single seam a real backend
   plugs into — everything around it (queueing, retry, backoff, status) is
   already the behaviour a shop needs. */

export interface SyncTransport {
  /** Resolves with the ids the server accepted. Throws to retry later. */
  pushBills: (bills: Bill[]) => Promise<string[]>;
}

/** No backend configured: bills stay queued and nothing is lost. Swap this
    for an HTTP transport and the rest of the pipeline is unchanged. */
export const localOnlyTransport: SyncTransport = {
  async pushBills() {
    throw new Error('No sync server configured');
  },
};

export interface SyncState {
  running: boolean;
  lastAttempt: number | null;
  lastSuccess: number | null;
  consecutiveFailures: number;
}

const state: SyncState = {
  running: false,
  lastAttempt: null,
  lastSuccess: null,
  consecutiveFailures: 0,
};

export const getSyncState = (): Readonly<SyncState> => ({ ...state });

const BATCH_SIZE = 50;

export async function pendingBills(): Promise<Bill[]> {
  return db.bills.where('synced').equals(0).limit(BATCH_SIZE).toArray();
}

export const pendingCount = (): Promise<number> => db.bills.where('synced').equals(0).count();

/** One drain pass. Safe to call often — it exits immediately when offline,
    already running, or there is nothing queued. */
export async function syncNow(transport: SyncTransport = localOnlyTransport): Promise<{
  pushed: number;
  remaining: number;
  error?: string;
}> {
  if (state.running) return { pushed: 0, remaining: await pendingCount() };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { pushed: 0, remaining: await pendingCount(), error: 'offline' };
  }

  state.running = true;
  state.lastAttempt = Date.now();

  try {
    const batch = await pendingBills();
    if (!batch.length) {
      state.consecutiveFailures = 0;
      state.lastSuccess = Date.now();
      return { pushed: 0, remaining: 0 };
    }

    const accepted = await transport.pushBills(batch);
    if (accepted.length) await useAppStore.getState().markSynced(accepted);

    state.consecutiveFailures = 0;
    state.lastSuccess = Date.now();
    return { pushed: accepted.length, remaining: await pendingCount() };
  } catch (err) {
    state.consecutiveFailures++;
    return {
      pushed: 0,
      remaining: await pendingCount(),
      error: err instanceof Error ? err.message : 'Sync failed',
    };
  } finally {
    state.running = false;
  }
}

/** Exponential backoff, capped — a shop with no backend should not retry
    every 30 seconds forever. */
const backoffMs = (failures: number): number =>
  Math.min(30_000 * 2 ** Math.min(failures, 5), 15 * 60_000);

let timer: ReturnType<typeof setTimeout> | null = null;

export function startSync(transport: SyncTransport = localOnlyTransport): () => void {
  const tick = async () => {
    await syncNow(transport);
    timer = setTimeout(tick, backoffMs(state.consecutiveFailures));
  };

  // Coming back online is the moment worth retrying immediately.
  const onOnline = () => void syncNow(transport);
  window.addEventListener('online', onOnline);

  timer = setTimeout(tick, 5_000);

  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('online', onOnline);
  };
}
