import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKitchenFeed, type FeedState } from '../kitchenFeed';
import type { CloudOrder } from '@/types/order';

const order = (id: string): CloudOrder => ({
  id, token: `A-${id}`, tableCode: 'T04', customerId: null,
  customerName: '', customerPhone: '', status: 'PAID',
  subtotal: 25, tax: 1.25, total: 26.25, createdAt: '2026-09-27T10:00:00Z', lines: [],
});

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup(fetchImpl?: () => Promise<CloudOrder[]>) {
  let fire = () => {};
  const closed = vi.fn();
  const subscribe = vi.fn((onChange: () => void) => { fire = onChange; return closed; });
  const fetchOrders = vi.fn(fetchImpl ?? (async () => [order('1')]));
  const feed = createKitchenFeed({ fetchOrders, subscribe, debounceMs: 250, pollMs: 30_000 });
  return { feed, fetchOrders, subscribe, closed, change: () => fire() };
}

describe('kitchenFeed', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('opens ONE channel and ONE fetch for several screens', async () => {
    const { feed, fetchOrders, subscribe } = setup();
    const a: FeedState[] = []; const b: FeedState[] = []; const c: FeedState[] = [];
    feed.subscribe((s) => a.push(s));
    feed.subscribe((s) => b.push(s));
    feed.subscribe((s) => c.push(s));
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(fetchOrders).toHaveBeenCalledTimes(1);
    expect(a.at(-1)?.orders.map((o) => o.id)).toEqual(['1']);
  });

  it('hands a late subscriber the current queue without refetching', async () => {
    const { feed, fetchOrders } = setup();
    feed.subscribe(() => {});
    await flush();
    const late: FeedState[] = [];
    feed.subscribe((s) => late.push(s));
    expect(late).toHaveLength(1);
    expect(late[0].loaded).toBe(true);
    expect(fetchOrders).toHaveBeenCalledTimes(1);
  });

  it('folds a burst of changes into one fetch', async () => {
    const { feed, fetchOrders, change } = setup();
    feed.subscribe(() => {});
    await flush();
    change(); change(); change();
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchOrders).toHaveBeenCalledTimes(2); // initial + one for the burst
  });

  it('keeps the last good queue and reports the error when a fetch fails', async () => {
    let fail = false;
    const { feed, change } = setup(async () => { if (fail) throw new Error('offline'); return [order('1')]; });
    const seen: FeedState[] = [];
    feed.subscribe((s) => seen.push(s));
    await flush();
    fail = true;
    change();
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.at(-1)).toMatchObject({ error: 'offline', loaded: true });
    expect(seen.at(-1)?.orders.map((o) => o.id)).toEqual(['1']);
  });

  it('polls as a fallback and closes everything when the last screen leaves', async () => {
    const { feed, fetchOrders, closed } = setup();
    const off1 = feed.subscribe(() => {});
    const off2 = feed.subscribe(() => {});
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchOrders).toHaveBeenCalledTimes(2);
    off1();
    expect(closed).not.toHaveBeenCalled();
    off2();
    expect(closed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchOrders).toHaveBeenCalledTimes(2);
  });

  it('still works (by polling) when the live channel cannot open', async () => {
    const fetchOrders = vi.fn(async () => [order('1')]);
    const feed = createKitchenFeed({
      fetchOrders,
      subscribe: () => { throw new Error('channel collision'); },
      pollMs: 30_000,
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: FeedState[] = [];
    expect(() => feed.subscribe((s) => seen.push(s))).not.toThrow();
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchOrders).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)?.loaded).toBe(true);
    err.mockRestore();
  });

  it('refetches once more when a change lands during a fetch', async () => {
    let resolve: (v: CloudOrder[]) => void = () => {};
    const calls: number[] = [];
    const fetchOrders = vi.fn(() => { calls.push(1); return new Promise<CloudOrder[]>((r) => { resolve = r; }); });
    const feed = createKitchenFeed({ fetchOrders, subscribe: () => () => {}, pollMs: 30_000 });
    feed.subscribe(() => {});
    void feed.refresh(); // arrives while the first fetch is still running
    resolve([order('1')]);
    await flush();
    resolve([order('1'), order('2')]);
    await flush();
    expect(fetchOrders).toHaveBeenCalledTimes(2);
    expect(feed.getState().orders.map((o) => o.id)).toEqual(['1', '2']);
  });
});
