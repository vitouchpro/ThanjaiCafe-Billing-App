import { describe, it, expect } from 'vitest';
import { deviceClaims } from '../jwt';

const token = (payload: object) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('deviceClaims', () => {
  it('reads shop_id and device_id', () => {
    expect(deviceClaims(token({ shop_id: 's1', device_id: 'd1' }))).toEqual({ shopId: 's1', deviceId: 'd1' });
  });
  it('explains a missing claim, which means the hook is not enabled', () => {
    expect(() => deviceClaims(token({ sub: 'u' }))).toThrow(/access-token hook/);
  });
  it('rejects something that is not a JWT', () => {
    expect(() => deviceClaims('nope')).toThrow(/Not a JWT/);
  });
});
