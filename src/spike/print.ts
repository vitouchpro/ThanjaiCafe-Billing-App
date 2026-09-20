import { escposTestTicket } from './escpos';

const LINES = ['SPIKE PRINT TEST', new Date().toISOString(), 'If you can read this, direct ESC/POS works.'];

/** WebUSB: pick the first interface with a bulk OUT endpoint and write to it. */
export async function printViaWebUsb(kickDrawer: boolean): Promise<string> {
  // Guard first, before any await, so the user gesture is preserved for requestDevice.
  if (!('usb' in navigator)) {
    throw new Error('WebUSB is not available in this browser (use Chrome or Edge over HTTPS or localhost)');
  }
  const device = await navigator.usb.requestDevice({ filters: [] });
  let claimed: number | null = null;
  try {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    let target: { iface: number; endpoint: number } | null = null;
    for (const iface of device.configuration!.interfaces) {
      const ep = iface.alternates[0].endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (ep) { target = { iface: iface.interfaceNumber, endpoint: ep.endpointNumber }; break; }
    }
    if (!target) throw new Error('No bulk OUT endpoint found on this device');

    await device.claimInterface(target.iface);
    claimed = target.iface;
    // Copy into a fresh Uint8Array<ArrayBuffer>: TS 6 rejects the ArrayBufferLike-backed one as BufferSource.
    const result = await device.transferOut(target.endpoint, new Uint8Array(escposTestTicket(LINES, { kickDrawer })));
    if (result.status !== 'ok') throw new Error(`transferOut status: ${result.status}`);
    return `WebUSB ok: ${device.productName ?? 'device'} interface ${target.iface} endpoint ${target.endpoint}`;
  } finally {
    try { if (claimed !== null) await device.releaseInterface(claimed); } catch { /* best effort */ }
    try { await device.close(); } catch { /* best effort */ }
  }
}

/** Web Serial: for printers that appear as a COM port. */
export async function printViaWebSerial(kickDrawer: boolean, baudRate = 9600): Promise<string> {
  // Guard first, before any await, so the user gesture is preserved for requestPort.
  if (!('serial' in navigator)) {
    throw new Error('Web Serial is not available in this browser (use Chrome or Edge over HTTPS or localhost)');
  }
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate });
  try {
    const writer = port.writable!.getWriter();
    try {
      await writer.write(escposTestTicket(LINES, { kickDrawer }));
    } finally {
      writer.releaseLock();
    }
    return 'Web Serial ok';
  } finally {
    try { await port.close(); } catch { /* best effort */ }
  }
}

/** The browser print path with a hidden iframe: the same technique printKot uses.
    With Chrome started with --kiosk-printing it should print with no dialog. */
export function printBrowserTest(): string {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); throw new Error('Could not create the print frame'); }
  doc.open();
  doc.write('<!doctype html><html><body style="font-family:sans-serif;width:74mm"><h2>SPIKE KOT TEST</h2><p>Browser print path</p></body></html>');
  doc.close();

  const run = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      // Give the print dialog time to take a snapshot before teardown.
      setTimeout(() => frame.remove(), 1000);
    }
  };

  if (doc.readyState === 'complete') setTimeout(run, 60);
  else frame.onload = () => setTimeout(run, 60);
  return 'print scheduled (check the paper)';
}
