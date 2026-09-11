import { supabase } from '@/services/cloud/client';
import type { Bill } from '@/types';
import type { SyncTransport } from './sync';

/* Pushes bills to the database.

   This is the seam `sync.ts` was written around and never given: the queue,
   the retry and the backoff already existed, but `pushBills` always threw
   because there was no server. So every bill a cashier ever took sat in one
   browser, flagged unsynced, with nothing draining it.

   The till stays authoritative. A bill is written locally the moment payment
   completes — a cashier never waits on the network — and this pushes it
   afterwards. A bill that is here but not yet upstream is un-backed-up, never
   lost and never wrong.

   Bills are the shop's financial records, so they do not go up with the anon
   key: `bills` has RLS on with no policy at all, and the write happens in an
   edge function holding the service-role key. */

const MAX_BATCH = 100;

export function httpTransport(): SyncTransport {
  return {
    async pushBills(bills: Bill[]): Promise<string[]> {
      if (!bills.length) return [];
      if (!supabase) throw new Error('Online backup is not configured');

      const token = import.meta.env.VITE_PUBLISH_TOKEN ?? '';
      if (!token) throw new Error('Online backup is not configured: VITE_PUBLISH_TOKEN is unset');

      /* Never send more than the function accepts. sync.ts already batches at
         50, but this is the boundary and must not depend on a caller's
         constant staying in step with the server's. */
      const batch = bills.slice(0, MAX_BATCH);

      const { data, error } = await supabase.functions.invoke<{
        accepted?: string[];
        error?: string;
      }>('backup-bills', {
        body: { bills: batch },
        headers: { 'x-publish-token': token },
      });

      /* Throwing is how the queue learns to retry with backoff, so a failure
         must throw rather than return an empty list — returning [] would look
         like "nothing to do" and quietly stall the backup forever. */
      if (error) throw new Error(data?.error || error.message);
      if (data?.error && !data.accepted?.length) throw new Error(data.error);

      /* Only the ids the server confirms are marked synced. Anything it omitted
         stays queued and is retried, which is what makes a partial write safe:
         the worst case is sending a bill twice, and the upsert on the till's own
         id makes that harmless. */
      return data?.accepted ?? [];
    },
  };
}

/** True when bills can actually be backed up, so the UI can say so honestly. */
export const isBackupConfigured = (): boolean =>
  Boolean(supabase) && Boolean(import.meta.env.VITE_PUBLISH_TOKEN);
