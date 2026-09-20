export interface DeviceClaims { shopId: string; deviceId: string }

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('Not a JWT');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
}

export function deviceClaims(token: string): DeviceClaims {
  const p = decodeJwtPayload(token);
  if (typeof p.shop_id !== 'string' || typeof p.device_id !== 'string') {
    throw new Error('Token has no shop_id/device_id claims. Is the access-token hook enabled?');
  }
  return { shopId: p.shop_id, deviceId: p.device_id };
}
