import { describe, it, expect } from 'vitest';
import { CREATE_ORDER_LIMITS, clientIp, isOverLimit, rateLimitKey } from '../rateLimit.ts';

const req = (headers: Record<string, string>) => new Request('https://x.test/', { headers });

describe('clientIp', () => {
  it('uses the first x-forwarded-for entry', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });
  it('falls back to cf-connecting-ip', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });
  it('prefers cf-connecting-ip over x-forwarded-for when both are present', () => {
    expect(clientIp(req({
      'x-forwarded-for': '192.0.2.99, 10.0.0.1',
      'cf-connecting-ip': '198.51.100.4',
    }))).toBe('198.51.100.4');
  });
  it('falls back to the first x-forwarded-for entry when cf-connecting-ip is empty', () => {
    expect(clientIp(req({
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'cf-connecting-ip': '',
    }))).toBe('203.0.113.7');
  });
  it('returns unknown when nothing identifies the caller', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});

describe('rateLimitKey', () => {
  it('joins scope and parts', () => {
    expect(rateLimitKey('create-order', '203.0.113.7', 'T04')).toBe('create-order:203.0.113.7:T04');
  });
  it('replaces unsafe characters and truncates long parts', () => {
    expect(rateLimitKey('s', 'a b/c')).toBe('s:a_b_c');
    expect(rateLimitKey('s', 'x'.repeat(200))).toBe(`s:${'x'.repeat(64)}`);
  });
});

describe('isOverLimit', () => {
  it('allows exactly the maximum and blocks the next call', () => {
    expect(isOverLimit(10, 10)).toBe(false);
    expect(isOverLimit(11, 10)).toBe(true);
  });
  it('treats a non-numeric count as not over, so a broken counter cannot block orders', () => {
    expect(isOverLimit(Number.NaN, 10)).toBe(false);
  });
});

describe('CREATE_ORDER_LIMITS', () => {
  it('lets a whole table burst higher than a single caller', () => {
    expect(CREATE_ORDER_LIMITS.perTable.max).toBeGreaterThan(CREATE_ORDER_LIMITS.perIpPerTable.max);
  });
});
