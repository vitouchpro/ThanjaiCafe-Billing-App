import { describe, it, expect } from 'vitest';
import { PERF_TARGETS, mulberry32, median } from '../perf';

describe('mulberry32', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it('rejects an empty list', () => {
    expect(() => median([])).toThrow();
  });
});

describe('PERF_TARGETS', () => {
  it('encodes the spec thresholds', () => {
    expect(PERF_TARGETS.firstPageMs).toBe(200);
    expect(PERF_TARGETS.todayDashboardMs).toBe(300);
  });
});
