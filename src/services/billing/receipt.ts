import type { Bill, Settings } from '@/types';
import { computeBill } from './calc';
import { formatMoney } from '@/utils/money';
import { formatDate, formatTime } from '@/utils/date';

/* Receipt rendering. Produces a self-contained HTML document sized for the
   configured paper width, opened in a hidden iframe and printed — no PDF
   dependency, works with any OS printer driver. (Plan §23) */

const WIDTHS: Record<Settings['receipt']['size'], string> = {
  '58mm': '58mm',
  '80mm': '80mm',
  A4: '210mm',
};

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function receiptHtml(bill: Bill, settings: Settings, opts: { duplicate?: boolean } = {}): string {
  const { business, invoice, receipt } = settings;
  const narrow = receipt.size !== 'A4';
  const width = WIDTHS[receipt.size];

  const computed = computeBill(bill.lines, bill.billDiscount, bill.billDiscountType, {
    pricesIncludeTax: settings.billing.pricesIncludeTax,
    roundTotals: settings.billing.roundTotals,
  });

  const created = new Date(bill.createdAt);

  const lineRows = computed.lines
    .map((c) => {
      const l = c.line;
      const disc = c.itemDiscountPaise + c.billDiscountSharePaise;
      return `
        <tr>
          <td class="name">
            ${esc(l.name)}
            ${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}
          </td>
          <td class="num">${l.qty}</td>
          <td class="num">${formatMoney(l.unitPrice, business.currency)}</td>
          <td class="num strong">${formatMoney(c.totalPaise / 100, business.currency)}</td>
        </tr>
        ${disc > 0 && invoice.showDiscount
          ? `<tr class="sub"><td colspan="4">Discount −${formatMoney(disc / 100, business.currency)}</td></tr>`
          : ''}`;
    })
    .join('');

  const taxRows =
    invoice.showGst && computed.taxBreakup.length
      ? computed.taxBreakup
          .map(
            (b) =>
              `<div class="row"><span>GST ${b.rate}% on ${formatMoney(b.taxable, business.currency)}</span><span>${formatMoney(b.tax, business.currency)}</span></div>`,
          )
          .join('')
      : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(bill.billNo)}</title>
<style>
  @page { size: ${width} auto; margin: ${narrow ? '3mm' : '12mm'}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    width: ${narrow ? width : 'auto'};
    font-family: ${narrow ? "'Courier New', monospace" : "system-ui, sans-serif"};
    font-size: ${narrow ? '11px' : '13px'};
    line-height: 1.45; color: #000; background: #fff;
  }
  .center { text-align: center; }
  .logo { max-width: ${narrow ? '40mm' : '60mm'}; max-height: 20mm; margin: 0 auto 4px; display: block; }
  h1 { font-size: ${narrow ? '15px' : '20px'}; margin: 0 0 2px; letter-spacing: .3px; }
  .muted { color: #444; font-size: ${narrow ? '10px' : '12px'}; }
  hr { border: 0; border-top: 1px dashed #999; margin: 7px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: ${narrow ? '10px' : '12px'}; border-bottom: 1px solid #000; padding: 3px 0; }
  td { padding: 3px 0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; padding-left: 5px; font-variant-numeric: tabular-nums; }
  .strong { font-weight: 700; }
  .name { word-break: break-word; }
  .note { font-size: ${narrow ? '9px' : '11px'}; color: #555; font-style: italic; }
  .sub td { font-size: ${narrow ? '9.5px' : '11px'}; color: #555; padding-top: 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 1.5px 0; }
  .total { font-size: ${narrow ? '15px' : '18px'}; font-weight: 800; border-top: 2px solid #000; margin-top: 5px; padding-top: 5px; }
  .badge { display: inline-block; border: 1px solid #000; padding: 1px 6px; font-size: 10px; font-weight: 700; }
  .foot { margin-top: 9px; font-size: ${narrow ? '10px' : '12px'}; }
  .void { color: #b00; font-weight: 800; letter-spacing: 2px; }
</style></head>
<body>
  <div class="center">
    ${invoice.showLogo && business.logo ? `<img class="logo" src="${business.logo}" alt="">` : ''}
    <h1>${esc(business.name)}</h1>
    ${business.address ? `<div class="muted">${esc(business.address)}</div>` : ''}
    ${business.phone ? `<div class="muted">${esc(business.phone)}</div>` : ''}
    ${invoice.showGst && business.gstin ? `<div class="muted">GSTIN: ${esc(business.gstin)}</div>` : ''}
    ${opts.duplicate ? '<div class="badge">DUPLICATE</div>' : ''}
    ${bill.status === 'refunded' ? '<div class="void">REFUNDED</div>' : ''}
    ${bill.status === 'cancelled' ? '<div class="void">CANCELLED</div>' : ''}
  </div>

  <hr>

  <div class="row"><span>Bill</span><span class="strong">${esc(bill.billNo)}</span></div>
  <div class="row"><span>Date</span><span>${formatDate(created)}</span></div>
  <div class="row"><span>Time</span><span>${formatTime(created)}</span></div>
  ${invoice.showCashier ? `<div class="row"><span>Cashier</span><span>${esc(bill.cashierName)}</span></div>` : ''}
  ${bill.customerName ? `<div class="row"><span>Customer</span><span>${esc(bill.customerName)}</span></div>` : ''}
  ${invoice.showCustomerPhone && bill.customerPhone ? `<div class="row"><span>Phone</span><span>${esc(bill.customerPhone)}</span></div>` : ''}

  <hr>

  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <hr>

  <div class="row"><span>Subtotal</span><span>${formatMoney(bill.totals.subtotal, business.currency)}</span></div>
  ${invoice.showDiscount && bill.totals.itemDiscount > 0
    ? `<div class="row"><span>Item discount</span><span>−${formatMoney(bill.totals.itemDiscount, business.currency)}</span></div>` : ''}
  ${invoice.showDiscount && bill.totals.billDiscount > 0
    ? `<div class="row"><span>Bill discount</span><span>−${formatMoney(bill.totals.billDiscount, business.currency)}</span></div>` : ''}
  ${taxRows}
  <div class="row total"><span>TOTAL</span><span>${formatMoney(bill.totals.total, business.currency)}</span></div>

  <div class="row" style="margin-top:5px"><span>Paid by</span><span class="strong">${bill.payment.toUpperCase()}</span></div>
  ${bill.payment === 'cash' && bill.cashReceived
    ? `<div class="row"><span>Received</span><span>${formatMoney(bill.cashReceived, business.currency)}</span></div>
       <div class="row"><span>Change</span><span>${formatMoney(bill.change ?? 0, business.currency)}</span></div>` : ''}
  ${bill.status === 'refunded'
    ? `<div class="row"><span>Refunded</span><span>${formatMoney(bill.refundAmount ?? bill.totals.total, business.currency)}</span></div>` : ''}

  <hr>
  <div class="center foot">
    ${esc(invoice.footerMessage)}
    <div class="muted" style="margin-top:4px">${bill.lines.reduce((a, l) => a + l.qty, 0)} item(s)</div>
  </div>
</body></html>`;
}

/** Prints via a hidden iframe so the app itself never navigates away. */
export function printReceipt(bill: Bill, settings: Settings, opts: { duplicate?: boolean } = {}): void {
  const html = receiptHtml(bill, settings, opts);

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }

  doc.open();
  doc.write(html);
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
}

/** Plain-text receipt for WhatsApp / SMS sharing. */
export function receiptText(bill: Bill, settings: Settings): string {
  const c = settings.business.currency;
  const lines = bill.lines
    .map((l) => `${l.name} x${l.qty} — ${formatMoney(l.unitPrice * l.qty, c)}`)
    .join('\n');

  const discount = bill.totals.itemDiscount + bill.totals.billDiscount;

  return [
    `*${settings.business.name}*`,
    `Bill ${bill.billNo} · ${formatDate(bill.createdAt)} ${formatTime(bill.createdAt)}`,
    '',
    lines,
    '',
    `Subtotal: ${formatMoney(bill.totals.subtotal, c)}`,
    discount > 0 ? `Discount: −${formatMoney(discount, c)}` : '',
    bill.totals.tax > 0 ? `GST: ${formatMoney(bill.totals.tax, c)}` : '',
    `*Total: ${formatMoney(bill.totals.total, c)}*`,
    `Paid by ${bill.payment.toUpperCase()}`,
    '',
    settings.invoice.footerMessage,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Share sheet where supported, clipboard everywhere else. */
export async function shareReceipt(bill: Bill, settings: Settings): Promise<'shared' | 'copied' | 'failed'> {
  const text = receiptText(bill, settings);
  try {
    if (navigator.share) {
      await navigator.share({ title: `Bill ${bill.billNo}`, text });
      return 'shared';
    }
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch (err) {
    // A user dismissing the share sheet is not a failure worth reporting.
    if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    return 'failed';
  }
}
