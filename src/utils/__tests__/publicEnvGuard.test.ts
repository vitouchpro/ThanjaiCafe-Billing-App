import { describe, it, expect } from 'vitest';
import { assertPublicEnvSafe, findForbiddenPublicEnv } from '../publicEnvGuard';

const prod = { command: 'build', mode: 'production', acknowledged: false } as const;

describe('findForbiddenPublicEnv', () => {
  it('accepts the public variables the app is meant to have', () => {
    expect(findForbiddenPublicEnv({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_RAZORPAY_KEY_ID: 'rzp_test_x',
      VITE_CAFE_NAME: 'THANJAI CAFE',
      VITE_PUBLIC_ORDER_URL: 'https://x.app',
    })).toEqual([]);
  });

  it('flags the publish token when it has a value', () => {
    expect(findForbiddenPublicEnv({ VITE_PUBLISH_TOKEN: 'abc' })).toEqual(['VITE_PUBLISH_TOKEN']);
  });

  it('ignores an empty or whitespace publish token', () => {
    expect(findForbiddenPublicEnv({ VITE_PUBLISH_TOKEN: '' })).toEqual([]);
    expect(findForbiddenPublicEnv({ VITE_PUBLISH_TOKEN: '   ' })).toEqual([]);
  });

  it('flags secret-looking names, sorted', () => {
    expect(findForbiddenPublicEnv({
      VITE_RAZORPAY_KEY_SECRET: 'x',
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'y',
    })).toEqual(['VITE_RAZORPAY_KEY_SECRET', 'VITE_SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('ignores variables without the VITE_ prefix', () => {
    expect(findForbiddenPublicEnv({ RAZORPAY_KEY_SECRET: 'x', SECRET: 'y' })).toEqual([]);
  });
});

describe('assertPublicEnvSafe', () => {
  it('blocks a production build that carries the publish token', () => {
    expect(() => assertPublicEnvSafe({ VITE_PUBLISH_TOKEN: 't' }, prod))
      .toThrow(/VITE_PUBLISH_TOKEN/);
  });

  it('allows the publish token when knowingly acknowledged', () => {
    expect(() => assertPublicEnvSafe({ VITE_PUBLISH_TOKEN: 't' }, { ...prod, acknowledged: true }))
      .not.toThrow();
  });

  it('never allows a secret-looking variable, even when acknowledged', () => {
    expect(() => assertPublicEnvSafe({ VITE_RAZORPAY_KEY_SECRET: 'x' }, { ...prod, acknowledged: true }))
      .toThrow(/VITE_RAZORPAY_KEY_SECRET/);
  });

  it('does not interfere with dev serving or non-production modes', () => {
    const env = { VITE_PUBLISH_TOKEN: 't' };
    expect(() => assertPublicEnvSafe(env, { command: 'serve', mode: 'development', acknowledged: false })).not.toThrow();
    expect(() => assertPublicEnvSafe(env, { command: 'build', mode: 'staging', acknowledged: false })).not.toThrow();
  });

  it('passes a clean production build', () => {
    expect(() => assertPublicEnvSafe({ VITE_SUPABASE_URL: 'https://x' }, prod)).not.toThrow();
  });
});
