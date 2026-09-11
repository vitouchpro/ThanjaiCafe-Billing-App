import { create } from 'zustand';
import type {
  Bill, Category, DayClose, ID, Product, Settings, User,
} from '@/types';
import {
  db, getSettings, saveSettings, kvGet, kvSet,
  nextBillSeq, peekBillSeq, SESSION_KEY,
} from '@/services/db/db';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, DEFAULT_USERS, defaultProducts } from '@/data/defaults';
import { productImage } from '@/data/illustrations';
import { productPhoto } from '@/data/photos';
import { generateHistory } from '@/data/seed';
import { now } from '@/utils/date';

/* Single application store. Reads hydrate from IndexedDB on boot; every
   mutation writes through to IndexedDB so a refresh (or a power cut mid-shift)
   loses nothing. */

interface AppState {
  ready: boolean;
  online: boolean;

  settings: Settings;
  products: Product[];
  categories: Category[];
  bills: Bill[];
  dayCloses: DayClose[];
  users: User[];
  currentUser: User | null;

  init: () => Promise<void>;
  setOnline: (v: boolean) => void;

  login: (userId: ID, pin: string) => Promise<boolean>;
  logout: () => Promise<void>;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;

  addProduct: (p: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Product>;
  updateProduct: (id: ID, patch: Partial<Product>) => Promise<void>;
  deleteProduct: (id: ID) => Promise<void>;
  toggleAvailability: (id: ID) => Promise<void>;

  addCategory: (c: Omit<Category, 'id'>) => Promise<void>;
  updateCategory: (id: ID, patch: Partial<Category>) => Promise<void>;
  deleteCategory: (id: ID) => Promise<void>;

  reserveBillNo: () => Promise<{ seq: number; billNo: string }>;
  saveBill: (b: Bill) => Promise<void>;
  refundBill: (id: ID, amount?: number) => Promise<void>;
  cancelBill: (id: ID) => Promise<void>;
  deleteBill: (id: ID) => Promise<void>;
  markSynced: (ids: ID[]) => Promise<void>;

  closeDay: (c: DayClose) => Promise<void>;

  addUser: (u: Omit<User, 'id'>) => Promise<void>;
  updateUser: (id: ID, patch: Partial<User>) => Promise<void>;
  deleteUser: (id: ID) => Promise<void>;

  reload: () => Promise<void>;
}

/** Brings the seeded catalogue up to the current artwork on installs created
    before it existed: fills a blank image, upgrades a bundled illustration
    to a photograph where we now have one, and refreshes any install caught
    mid-migration (a brief release preferred illustrations over photos) back
    onto the real photo.

    A picture the shop uploaded is an ordinary URL or a data: JPEG, and is
    never touched — only our own generated SVGs and bundled photo paths are
    replaced. */
async function backfillProductImages(products: Product[]): Promise<Product[]> {
  const patched: Product[] = [];
  const isOurIllustration = (src?: string) => !!src?.startsWith('data:image/svg+xml');
  const isOurBundledPhoto = (src?: string) => !!src?.startsWith('/products/');
  const isOurArt = (src?: string) => isOurIllustration(src) || isOurBundledPhoto(src);

  for (const p of products) {
    if (p.image && !isOurArt(p.image)) continue; // the shop's own upload

    const image = productPhoto(p.name) ?? productImage(p.name, p.categoryId);
    if (image && image !== p.image) patched.push({ ...p, image });
  }

  if (!patched.length) return products;

  await db.transaction('rw', db.products, async () => {
    await db.products.bulkPut(patched);
  });

  const byId = new Map(patched.map((p) => [p.id, p]));
  return products.map((p) => byId.get(p.id) ?? p);
}

/** Set on the first init() call so StrictMode's second invocation joins the
    same promise instead of starting a competing seed. */
let initPromise: Promise<void> | null = null;

const uid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,

  settings: DEFAULT_SETTINGS,
  products: [],
  categories: [],
  bills: [],
  dayCloses: [],
  users: [],
  currentUser: null,

  async init() {
    // React StrictMode invokes effects twice in development; without this the
    // two runs race and the seeding bulkAdd fails with a BulkError.
    if (initPromise) return initPromise;
    initPromise = (async () => {
    let settings = await getSettings();

    // First run: lay down catalogue, staff and a plausible trading history.
    if (!settings) {
      settings = DEFAULT_SETTINGS;
      const products = defaultProducts();
      const bills = generateHistory(products, settings);
      const nextSeq = bills.length ? Math.max(...bills.map((b) => b.seq)) + 1 : settings.invoice.startingNumber;

      await db.transaction('rw', [db.products, db.categories, db.bills, db.users, db.kv], async () => {
        await db.products.bulkPut(products);
        await db.categories.bulkPut(DEFAULT_CATEGORIES);
        await db.bills.bulkPut(bills);
        await db.users.bulkPut(DEFAULT_USERS);
        await saveSettings(settings!);
        await kvSet('billSeq', nextSeq);
      });
    }

    let [products, categories, bills, dayCloses, users, sessionId] = await Promise.all([
      db.products.toArray(),
      db.categories.toArray(),
      db.bills.toArray(),
      db.dayCloses.toArray(),
      db.users.toArray(),
      kvGet<ID>(SESSION_KEY),
    ]);

    products = await backfillProductImages(products);

    const currentUser = sessionId ? users.find((u) => u.id === sessionId && u.active) ?? null : null;

    set({
      ready: true,
      settings,
      products: products.sort((a, b) => a.name.localeCompare(b.name)),
      categories: categories.sort((a, b) => a.sortOrder - b.sortOrder),
      bills: bills.sort((a, b) => b.seq - a.seq),
      dayCloses: dayCloses.sort((a, b) => b.date.localeCompare(a.date)),
      users,
      currentUser,
    });
    })();
    return initPromise;
  },

  async reload() {
    const [products, categories, bills, dayCloses, users, settings] = await Promise.all([
      db.products.toArray(),
      db.categories.toArray(),
      db.bills.toArray(),
      db.dayCloses.toArray(),
      db.users.toArray(),
      getSettings(),
    ]);
    set({
      products: products.sort((a, b) => a.name.localeCompare(b.name)),
      categories: categories.sort((a, b) => a.sortOrder - b.sortOrder),
      bills: bills.sort((a, b) => b.seq - a.seq),
      dayCloses: dayCloses.sort((a, b) => b.date.localeCompare(a.date)),
      users,
      settings: settings ?? DEFAULT_SETTINGS,
    });
  },

  setOnline: (online) => set({ online }),

  async login(userId, pin) {
    const user = get().users.find((u) => u.id === userId && u.active);
    if (!user || user.pin !== pin) return false;
    await kvSet(SESSION_KEY, user.id);
    set({ currentUser: user });
    return true;
  },

  async logout() {
    await kvSet(SESSION_KEY, null);
    set({ currentUser: null });
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    await saveSettings(next);
    set({ settings: next });
  },

  async addProduct(p) {
    const ts = now();
    const product: Product = { ...p, id: uid('prd'), createdAt: ts, updatedAt: ts };
    await db.products.add(product);
    set({ products: [...get().products, product].sort((a, b) => a.name.localeCompare(b.name)) });
    return product;
  },

  async updateProduct(id, patch) {
    const next = { ...patch, updatedAt: now() };
    await db.products.update(id, next);
    set({
      products: get()
        .products.map((p) => (p.id === id ? { ...p, ...next } : p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  },

  async deleteProduct(id) {
    // Soft delete: past bills reference this product, so hard-deleting it
    // would blank out historical reports.
    const sold = get().bills.some((b) => b.lines.some((l) => l.productId === id));
    if (sold) {
      await get().updateProduct(id, { archived: true, available: false });
      return;
    }
    await db.products.delete(id);
    set({ products: get().products.filter((p) => p.id !== id) });
  },

  async toggleAvailability(id) {
    const p = get().products.find((x) => x.id === id);
    if (!p) return;
    await get().updateProduct(id, { available: !p.available });
  },

  async addCategory(c) {
    const category: Category = { ...c, id: uid('cat') };
    await db.categories.add(category);
    set({ categories: [...get().categories, category].sort((a, b) => a.sortOrder - b.sortOrder) });
  },

  async updateCategory(id, patch) {
    await db.categories.update(id, patch);
    set({
      categories: get()
        .categories.map((c) => (c.id === id ? { ...c, ...patch } : c))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    });
  },

  async deleteCategory(id) {
    const inUse = get().products.some((p) => p.categoryId === id && !p.archived);
    if (inUse) throw new Error('This category still has products. Move or remove them first.');
    await db.categories.delete(id);
    set({ categories: get().categories.filter((c) => c.id !== id) });
  },

  async reserveBillNo() {
    const { settings } = get();
    const seq = await nextBillSeq(settings.invoice.startingNumber);
    return { seq, billNo: `${settings.invoice.prefix}${seq}` };
  },

  async saveBill(b) {
    await db.bills.put(b);
    const rest = get().bills.filter((x) => x.id !== b.id);
    set({ bills: [b, ...rest].sort((a, c) => c.seq - a.seq) });
  },

  async refundBill(id, amount) {
    const bill = get().bills.find((b) => b.id === id);
    if (!bill) return;
    const patch: Partial<Bill> = {
      status: 'refunded',
      refundedAt: now(),
      refundAmount: amount ?? bill.totals.total,
      synced: 0,
    };
    await db.bills.update(id, patch);
    set({ bills: get().bills.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  },

  async cancelBill(id) {
    const patch: Partial<Bill> = { status: 'cancelled', cancelledAt: now(), synced: 0 };
    await db.bills.update(id, patch);
    set({ bills: get().bills.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  },

  async deleteBill(id) {
    await db.bills.delete(id);
    set({ bills: get().bills.filter((b) => b.id !== id) });
  },

  async markSynced(ids) {
    await db.transaction('rw', db.bills, async () => {
      for (const id of ids) await db.bills.update(id, { synced: 1 });
    });
    const idSet = new Set(ids);
    set({ bills: get().bills.map((b) => (idSet.has(b.id) ? { ...b, synced: 1 } : b)) });
  },

  async closeDay(c) {
    await db.dayCloses.put(c);
    set({ dayCloses: [c, ...get().dayCloses.filter((x) => x.id !== c.id)].sort((a, b) => b.date.localeCompare(a.date)) });
  },

  async addUser(u) {
    const user: User = { ...u, id: uid('usr') };
    await db.users.add(user);
    set({ users: [...get().users, user] });
  },

  async updateUser(id, patch) {
    await db.users.update(id, patch);
    const users = get().users.map((u) => (u.id === id ? { ...u, ...patch } : u));
    const cur = get().currentUser;
    set({ users, currentUser: cur?.id === id ? { ...cur, ...patch } : cur });
  },

  async deleteUser(id) {
    if (get().currentUser?.id === id) throw new Error('You cannot delete the account you are signed in with.');
    await db.users.delete(id);
    set({ users: get().users.filter((u) => u.id !== id) });
  },
}));

/** Next invoice number without consuming it — for display on the POS. */
export const previewNextBillNo = async (settings: Settings): Promise<string> => {
  const seq = await peekBillSeq(settings.invoice.startingNumber);
  return `${settings.invoice.prefix}${seq}`;
};
