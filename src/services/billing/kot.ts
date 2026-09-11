import { isKitchenVisible } from '@/services/cloud/status';
import type { CloudOrder } from '@/types/order';

/* The kitchen order ticket. Sized for an 80 mm kitchen printer and printed
   through the same hidden-iframe path as the customer receipt.

   Deliberately carries no prices: the kitchen needs the dish, the quantity,
   the table and who to call — money is the counter's business. */

export function kotHtml(order: CloudOrder, businessName: string): string {
  // A docket exists only for food that has been paid for. Guarding here as
  // well as in the query means no future caller can bypass the rule.
  if (!isKitchenVisible(order.status)) {
    throw new Error('Refusing to print a KOT for an order that is not paid');
  }

  const time = new Date(order.paidAt ?? order.createdAt).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit',
  });

  const rows = order.lines.map((l) => `
    <tr>
      <td class="qty">${l.qty}</td>
      <td>${esc(l.name)}${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>KOT ${esc(order.token)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: system-ui, sans-serif; width: 74mm; margin: 0; color: #000; }
  .shop { text-align: center; font-size: 10pt; }
  .title { text-align: center; font-size: 13pt; font-weight: 700;
           border-bottom: 2px solid #000; padding-bottom: 2mm; margin-bottom: 2mm; }
  .token { font-size: 26pt; font-weight: 800; text-align: center; line-height: 1; }
  .meta { display: flex; justify-content: space-between; font-size: 10pt; margin: 2mm 0; }
  .cust { font-size: 10pt; border-top: 1px dashed #000; border-bottom: 1px dashed #000;
          padding: 2mm 0; margin-bottom: 2mm; }
  table { width: 100%; border-collapse: collapse; font-size: 12pt; }
  td { padding: 1.5mm 0; vertical-align: top; border-bottom: 1px dotted #bbb; }
  .qty { width: 10mm; font-weight: 800; font-size: 14pt; }
  .note { font-size: 9pt; font-style: italic; padding-left: 2mm; }
</style></head><body>
  <div class="shop">${esc(businessName)}</div>
  <div class="title">KITCHEN ORDER</div>
  <div class="token">${esc(order.token)}</div>
  <div class="meta"><span>Table ${esc(order.tableCode)}</span><span>${esc(time)}</span></div>
  <div class="cust">
    <div><strong>${esc(order.customerName || 'Guest')}</strong></div>
    <div>${esc(order.customerPhone)}</div>
  </div>
  <table>${rows}</table>
</body></html>`;
}

/** Print through a hidden iframe — the same approach as printReceipt, so there
    is no PDF dependency and the OS print dialog does the work. */
export function printKot(order: CloudOrder, businessName: string): void {
  const html = kotHtml(order, businessName);
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();

  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
