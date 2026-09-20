import { escposTestTicket } from './escpos';

const LINES = ['SPIKE PRINT TEST', new Date().toISOString(), 'If you can read this, direct ESC/POS works.'];

/** WebUSB: pick the first interface with a bulk OUT endpoint and write to it. */
export async function printViaWebUsb(kickDrawer: boolean): Promise<string> {
  const device = await navigator.usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);

  let target: { iface: number; endpoint: number } | null = null;
  for (const iface of device.configuration!.interfaces) {
    const ep = iface.alternates[0].endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
    if (ep) { target = { iface: iface.interfaceNumber, endpoint: ep.endpointNumber }; break; }
  }
  if (!target) throw new Error('No bulk OUT endpoint found on this device');

  await device.claimInterface(target.iface);
  // Copy into a fresh Uint8Array<ArrayBuffer>: TS 6 rejects the ArrayBufferLike-backed one as BufferSource.
  await device.transferOut(target.endpoint, new Uint8Array(escposTestTicket(LINES, { kickDrawer })));
  await device.close();
  return `WebUSB ok: ${device.productName ?? 'device'} interface ${target.iface} endpoint ${target.endpoint}`;
}

/** Web Serial: for printers that appear as a COM port. */
export async function printViaWebSerial(kickDrawer: boolean): Promise<string> {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  const writer = port.writable!.getWriter();
  await writer.write(escposTestTicket(LINES, { kickDrawer }));
  writer.releaseLock();
  await port.close();
  return 'Web Serial ok';
}

/** The browser print path with a hidden iframe: the same technique printKot uses.
    With Chrome started with --kiosk-printing it should print with no dialog. */
export function printBrowserTest(): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write('<!doctype html><html><body style="font-family:sans-serif;width:74mm"><h2>SPIKE KOT TEST</h2><p>Browser print path</p></body></html>');
  doc.close();
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
}
