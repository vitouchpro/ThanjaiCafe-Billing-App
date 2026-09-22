export interface ApprovalPayload {
  action: 'refund' | 'void_after_kot' | 'discount_override' | 'price_override' | 'no_sale_open';
  targetId: string;
  shopId: string;
  nonce: string;
  expiresAt: number;
}

/** One key pair per manager, generated once on that manager's own device and
    never leaving it; the public key is what counter devices are given. */
export async function generateManagerKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}

function payloadBytes(payload: ApprovalPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export async function signApproval(privateKey: CryptoKey, payload: ApprovalPayload): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, payloadBytes(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyApproval(publicKey: CryptoKey, payload: ApprovalPayload, signature: string): Promise<boolean> {
  if (payload.expiresAt < Date.now()) return false;
  const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sigBytes, payloadBytes(payload));
}
