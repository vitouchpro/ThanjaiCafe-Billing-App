import { describe, it, expect } from 'vitest';
import { CUT_PARTIAL, DRAWER_KICK, INIT, escposTestTicket } from '../escpos';

const has = (bytes: Uint8Array, seq: number[]) =>
  bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b));

describe('escposTestTicket', () => {
  it('starts with printer init and encodes ASCII text', () => {
    const b = escposTestTicket(['HI']);
    expect([...b.slice(0, 2)]).toEqual(INIT);
    expect(has(b, [0x48, 0x49, 0x0a])).toBe(true);
  });
  it('replaces non-ASCII characters with a question mark', () => {
    expect(has(escposTestTicket(['₹5']), [0x3f, 0x35])).toBe(true);
  });
  it('ends the ticket with a cut', () => {
    const b = escposTestTicket(['x']);
    expect([...b.slice(-CUT_PARTIAL.length)]).toEqual(CUT_PARTIAL);
  });
  it('kicks the drawer only when asked, after the cut', () => {
    expect(has(escposTestTicket(['x']), DRAWER_KICK)).toBe(false);
    const b = escposTestTicket(['x'], { kickDrawer: true });
    expect([...b.slice(-DRAWER_KICK.length)]).toEqual(DRAWER_KICK);
  });
});
