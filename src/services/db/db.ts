import Dexie, { type Table } from 'dexie';
import type { Bill, Category, DayClose, Product, Settings, User } from '@/types';

/* IndexedDB is the source of truth. The POS keeps working with the network
   down; bills carry `synced: 0` until a backend accepts them. (Plan §32) */

export interface KV {
  key: string;
  value: unknown;
}

export class PosDatabase extends Dexie {
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  bills!: Table<Bill, string>;
  dayCloses!: Table<DayClose, string>;
  users!: Table<User, string>;
  kv!: Table<KV, string>;

  constructor() {
    super('thangai-pos');
    this.version(1).stores({
      // `synced` is 0|1 rather than boolean — IndexedDB cannot index booleans.
      products: 'id, name, categoryId, available, archived, sku',
      categories: 'id, sortOrder, name',
      bills: 'id, billNo, seq, createdAt, status, payment, synced, customerPhone',
      dayCloses: 'id, date',
      users: 'id, role, active',
      kv: 'key',
    });
  }
}

export const db = new PosDatabase();

/* ---- KV helpers (settings, counters, session) ---- */

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value });
}

export const SETTINGS_KEY = 'settings';
export const SEQ_KEY = 'billSeq';
export const SESSION_KEY = 'session';

export const getSettings = () => kvGet<Settings>(SETTINGS_KEY);
export const saveSettings = (s: Settings) => kvSet(SETTINGS_KEY, s);

/** Reserve the next invoice number atomically.
    Runs inside a transaction so two rapid COMPLETE BILL taps can never
    hand out the same bill number. */
export async function nextBillSeq(startingNumber: number): Promise<number> {
  return db.transaction('rw', db.kv, async () => {
    const current = (await kvGet<number>(SEQ_KEY)) ?? startingNumber;
    await kvSet(SEQ_KEY, current + 1);
    return current;
  });
}

export async function peekBillSeq(startingNumber: number): Promise<number> {
  return (await kvGet<number>(SEQ_KEY)) ?? startingNumber;
}

export const setBillSeq = (n: number) => kvSet(SEQ_KEY, n);

/* ---- Backup / restore (Plan §20 System → Backup, Data Export) ---- */

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  products: Product[];
  categories: Category[];
  bills: Bill[];
  dayCloses: DayClose[];
  users: User[];
  settings?: Settings;
  billSeq?: number;
}

export async function exportBackup(): Promise<BackupPayload> {
  const [products, categories, bills, dayCloses, users, settings, billSeq] = await Promise.all([
    db.products.toArray(),
    db.categories.toArray(),
    db.bills.toArray(),
    db.dayCloses.toArray(),
    db.users.toArray(),
    getSettings(),
    kvGet<number>(SEQ_KEY),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), products, categories, bills, dayCloses, users, settings, billSeq };
}

export async function importBackup(payload: BackupPayload): Promise<void> {
  if (payload.version !== 1) throw new Error('Unsupported backup version');
  await db.transaction('rw', [db.products, db.categories, db.bills, db.dayCloses, db.users, db.kv], async () => {
    await Promise.all([db.products.clear(), db.categories.clear(), db.bills.clear(), db.dayCloses.clear(), db.users.clear()]);
    await Promise.all([
      db.products.bulkAdd(payload.products ?? []),
      db.categories.bulkAdd(payload.categories ?? []),
      db.bills.bulkAdd(payload.bills ?? []),
      db.dayCloses.bulkAdd(payload.dayCloses ?? []),
      db.users.bulkAdd(payload.users ?? []),
    ]);
    if (payload.settings) await saveSettings(payload.settings);
    if (typeof payload.billSeq === 'number') await setBillSeq(payload.billSeq);
  });
}

export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', [db.products, db.categories, db.bills, db.dayCloses, db.users, db.kv], async () => {
    await Promise.all([
      db.products.clear(), db.categories.clear(), db.bills.clear(),
      db.dayCloses.clear(), db.users.clear(), db.kv.clear(),
    ]);
  });
}
