import {
  UpdateType,
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from '@powersync/web';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* Append-only tables are uploaded with ON CONFLICT DO NOTHING, so a repeated
   upload (a retry after a dropped connection) can never edit or duplicate a bill. */
const APPEND_ONLY = new Set(['bills', 'bill_lines']);

/* Errors retrying cannot fix: bad data, constraint violations and RLS denials.
   Discard the transaction instead of blocking the queue. */
const FATAL = [/^22...$/, /^23...$/, /^42501$/];

export class SpikeConnector implements PowerSyncBackendConnector {
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: true, storageKey: 'spike-auth' } },
    );
  }

  async login(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async logout(): Promise<void> {
    await this.client.auth.signOut();
  }

  async fetchCredentials(): Promise<PowerSyncCredentials> {
    const { data: { session }, error } = await this.client.auth.getSession();
    if (error || !session) throw new Error('Not signed in');
    return { endpoint: import.meta.env.VITE_POWERSYNC_URL, token: session.access_token };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    try {
      for (const op of transaction.crud) {
        const table = this.client.from(op.table);
        let result;
        if (op.op === UpdateType.PUT) {
          const record = { ...op.opData, id: op.id };
          result = APPEND_ONLY.has(op.table)
            ? await table.upsert(record, { ignoreDuplicates: true })
            : await table.upsert(record);
        } else if (op.op === UpdateType.PATCH) {
          result = await table.update(op.opData ?? {}).eq('id', op.id);
        } else {
          result = await table.delete().eq('id', op.id);
        }
        if (result.error) throw result.error;
      }
      await transaction.complete();
    } catch (ex) {
      const code = (ex as { code?: unknown }).code;
      if (typeof code === 'string' && FATAL.some((re) => re.test(code))) {
        console.error('Upload rejected, discarding transaction:', ex);
        await transaction.complete();
      } else {
        throw ex; // retryable (network, temporary server error)
      }
    }
  }
}
