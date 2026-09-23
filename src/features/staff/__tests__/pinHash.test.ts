import { describe, it, expect } from 'vitest';
import { generateSalt, hashPin, verifyPin } from '../pinHash';

describe('pinHash', () => {
  it('verifies a correct PIN against its own hash', async () => {
    const salt = generateSalt();
    const hash = await hashPin('4821', salt);
    expect(await verifyPin('4821', salt, hash)).toBe(true);
  });

  it('rejects a wrong PIN', async () => {
    const salt = generateSalt();
    const hash = await hashPin('4821', salt);
    expect(await verifyPin('0000', salt, hash)).toBe(false);
  });

  it('produces different hashes for the same PIN with different salts', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const h1 = await hashPin('4821', salt1);
    const h2 = await hashPin('4821', salt2);
    expect(h1).not.toBe(h2);
  });
});
