const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const INIT = [ESC, 0x40];
export const CUT_PARTIAL = [GS, 0x56, 0x42, 0x00];
/** ESC p m t1 t2: pulse pin 2 to open the cash drawer. */
export const DRAWER_KICK = [ESC, 0x70, 0x00, 0x19, 0xfa];

export function escposTestTicket(lines: string[], opts: { kickDrawer?: boolean } = {}): Uint8Array {
  const bytes: number[] = [...INIT];
  for (const line of lines) {
    for (const ch of line) bytes.push(ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : 0x3f);
    bytes.push(LF);
  }
  bytes.push(LF, LF, LF, ...CUT_PARTIAL);
  if (opts.kickDrawer) bytes.push(...DRAWER_KICK);
  return Uint8Array.from(bytes);
}
