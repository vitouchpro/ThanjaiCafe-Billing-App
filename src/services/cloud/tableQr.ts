import { qrToDataUrl } from '@/services/billing/qr';

/* Table QR codes use the app's own QR encoder — the same one that renders UPI
   codes — so printing table cards needs no new dependency and works offline. */

export function tableOrderUrl(baseUrl: string, tableCode: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/order?t=${encodeURIComponent(tableCode)}`;
}

export const tableQrDataUrl = (baseUrl: string, tableCode: string): string =>
  qrToDataUrl(tableOrderUrl(baseUrl, tableCode));

/** A printable sheet of table cards — cut out and stand on the tables. */
export function tableSheetHtml(baseUrl: string, tables: string[], businessName: string): string {
  const cards = tables.map((t) => `
    <div class="card">
      <div class="shop">${escapeHtml(businessName)}</div>
      <img src="${tableQrDataUrl(baseUrl, t)}" alt="QR for table ${escapeHtml(t)}" />
      <div class="table">${escapeHtml(t)}</div>
      <div class="hint">Scan to see the menu and order</div>
    </div>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>Table QR codes</title>
<style>
  @page { margin: 10mm; }
  body { font-family: system-ui, sans-serif; margin: 0;
         display: grid; grid-template-columns: repeat(2, 1fr); gap: 10mm; }
  .card { border: 1px dashed #999; border-radius: 8px; padding: 8mm;
          text-align: center; break-inside: avoid; }
  .shop { font-size: 12pt; font-weight: 700; margin-bottom: 4mm; }
  .card img { width: 55mm; height: 55mm; }
  .table { font-size: 20pt; font-weight: 700; margin-top: 3mm; }
  .hint { font-size: 9pt; color: #555; margin-top: 1mm; }
</style></head><body>${cards}</body></html>`;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
