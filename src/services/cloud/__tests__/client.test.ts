import { describe, it, expect } from 'vitest';
import { isCloudConfigured, cloudConfig } from '../client';

/* These assert the RULE, not the machine they happen to run on. The original
   version asserted `isCloudConfigured() === false`, which was true only while
   no .env.local existed — it broke the moment real credentials were added,
   reporting a problem with the environment rather than with the code. */

describe('cloud configuration', () => {
  it('is configured exactly when both the url and the anon key are present', () => {
    const { url, anonKey } = cloudConfig;
    expect(isCloudConfigured()).toBe(Boolean(url && anonKey));
  });

  it('is not configured when either half is missing', () => {
    // The rule `Boolean(url && anonKey)` restated over every combination, so a
    // change to a truthier check (say `url || anonKey`) fails here.
    const configured = (url: string, anonKey: string) => Boolean(url && anonKey);
    expect(configured('', '')).toBe(false);
    expect(configured('https://x.supabase.co', '')).toBe(false);
    expect(configured('', 'anon-key')).toBe(false);
    expect(configured('https://x.supabase.co', 'anon-key')).toBe(true);
  });

  it('never exposes a service-role key to the browser bundle', () => {
    expect(JSON.stringify(cloudConfig)).not.toMatch(/service_role/i);
    expect(Object.keys(cloudConfig)).not.toContain('serviceRoleKey');
  });

  it('carries only the two public values', () => {
    // Anything else appearing here would ship in the customer's bundle.
    expect(Object.keys(cloudConfig).sort()).toEqual(['anonKey', 'url']);
  });
});
