import { describe, it, expect } from 'vitest';
import { generateManagerKeyPair, signApproval, verifyApproval } from '../approvalToken';

describe('approval token signing', () => {
  it('verifies a signature made with the matching private key', async () => {
    const { privateKey, publicKey } = await generateManagerKeyPair();
    const payload = { action: 'refund' as const, targetId: 'bill-123', shopId: 'shop-1', nonce: 'abc', expiresAt: Date.now() + 120_000 };
    const signature = await signApproval(privateKey, payload);
    expect(await verifyApproval(publicKey, payload, signature)).toBe(true);
  });

  it('rejects a signature after tampering with the payload', async () => {
    const { privateKey, publicKey } = await generateManagerKeyPair();
    const payload = { action: 'refund' as const, targetId: 'bill-123', shopId: 'shop-1', nonce: 'abc', expiresAt: Date.now() + 120_000 };
    const signature = await signApproval(privateKey, payload);
    const tampered = { ...payload, targetId: 'bill-999' };
    expect(await verifyApproval(publicKey, tampered, signature)).toBe(false);
  });

  it('rejects a signature from the wrong key pair', async () => {
    const pair1 = await generateManagerKeyPair();
    const pair2 = await generateManagerKeyPair();
    const payload = { action: 'refund' as const, targetId: 'bill-123', shopId: 'shop-1', nonce: 'abc', expiresAt: Date.now() + 120_000 };
    const signature = await signApproval(pair1.privateKey, payload);
    expect(await verifyApproval(pair2.publicKey, payload, signature)).toBe(false);
  });
});
