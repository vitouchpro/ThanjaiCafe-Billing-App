import { useMemo, useState } from 'react';
import { AlertTriangle, Printer, QrCode, UploadCloud } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Button, Card, Field, Input, SectionTitle, toast } from '@/components/ui';
import { isCloudConfigured } from '@/services/cloud/client';
import { publishMenu } from '@/services/cloud/menu';
import { tableQrDataUrl, tableSheetHtml } from '@/services/cloud/tableQr';

/* Online Ordering (Plan §27-ish) — publish the local menu upstream and print
   table QR codes. Mirrors the SystemSection layout: action rows for
   irreversible / network operations, disabled outright when cloud isn't
   configured so Settings still opens and works with no network. */

const PUBLIC_ORDER_URL: string = import.meta.env.VITE_PUBLIC_ORDER_URL ?? '';

const MIN_TABLES = 1;
const MAX_TABLES = 60;
const PREVIEW_COUNT = 4;

function tableCode(n: number): string {
  return `T${String(n).padStart(2, '0')}`;
}

/** Prints via a hidden iframe — same technique as printReceipt in
    src/services/billing/receipt.ts, so no PDF/print dependency is added. */
function printTableSheet(html: string): void {
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
      setTimeout(() => frame.remove(), 1000);
    }
  };

  if (doc.readyState === 'complete') setTimeout(run, 60);
  else frame.onload = () => setTimeout(run, 60);
}

export function OnlineOrderingSection() {
  const products = useAppStore((s) => s.products);
  const categories = useAppStore((s) => s.categories);
  const businessName = useAppStore((s) => s.settings.business.name);

  const configured = isCloudConfigured();
  const hasPublicUrl = PUBLIC_ORDER_URL.length > 0;

  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [tableCount, setTableCount] = useState(10);

  const tables = useMemo(
    () => Array.from({ length: tableCount }, (_, i) => tableCode(i + 1)),
    [tableCount],
  );
  const previewTables = tables.slice(0, PREVIEW_COUNT);

  const clampTableCount = (n: number) => {
    if (!Number.isFinite(n)) return MIN_TABLES;
    return Math.min(MAX_TABLES, Math.max(MIN_TABLES, Math.round(n)));
  };

  async function doPublish() {
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    try {
      const { published } = await publishMenu(products, categories);
      setPublishResult(`Published ${published} item${published === 1 ? '' : 's'}`);
      toast('Menu published', 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not publish the menu';
      setPublishError(message);
      toast(message, 'danger');
    } finally {
      setPublishing(false);
    }
  }

  function doPrint() {
    const html = tableSheetHtml(PUBLIC_ORDER_URL, tables, businessName);
    printTableSheet(html);
  }

  const controlsDisabled = !configured;
  const printDisabled = !configured || !hasPublicUrl;

  return (
    <>
      <Card>
        <SectionTitle
          title="Online Ordering"
          subtitle="Publish the menu so customers can order from their phone"
          icon={<QrCode size={17} className="text-accent" />}
        />

        {!configured && (
          <div className="mb-4 p-3.5 rounded-xl bg-warning-bg border border-warning/25 flex gap-2.5">
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              Online ordering is not configured on this device. Add{' '}
              <code className="px-1 py-0.5 rounded bg-surface-3 text-[11.5px]">VITE_SUPABASE_URL</code>{' '}
              and{' '}
              <code className="px-1 py-0.5 rounded bg-surface-3 text-[11.5px]">VITE_SUPABASE_ANON_KEY</code>{' '}
              to a <code className="px-1 py-0.5 rounded bg-surface-3 text-[11.5px]">.env.local</code> file
              and restart the app to enable it. Everything else in Settings keeps working offline.
            </p>
          </div>
        )}

        <div className="p-3.5 rounded-xl border border-line bg-surface-2">
          <div className="flex items-center gap-3.5">
            <span className="w-10 h-10 rounded-xl bg-surface-3 text-ink-2 grid place-items-center shrink-0">
              <UploadCloud size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-ink">Publish menu</p>
              <p className="text-[12.5px] text-ink-3 leading-relaxed">
                Sends product names, prices and categories to the online menu. Cost prices are
                never published — they never leave this device.
              </p>
            </div>
            <div className="shrink-0">
              <Button
                variant="primary"
                loading={publishing}
                disabled={controlsDisabled}
                onClick={doPublish}
              >
                Publish
              </Button>
            </div>
          </div>
          {publishResult && (
            <p className="text-[12.5px] font-semibold text-success mt-3">{publishResult}</p>
          )}
          {publishError && (
            <p className="text-[12.5px] font-semibold text-danger mt-3">{publishError}</p>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Table QR codes" subtitle="Print a card for each table so guests can scan to order" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Number of tables" hint={`Between ${MIN_TABLES} and ${MAX_TABLES}.`}>
            <Input
              type="number"
              min={MIN_TABLES}
              max={MAX_TABLES}
              value={tableCount}
              disabled={controlsDisabled}
              onChange={(e) => setTableCount(clampTableCount(Number(e.target.value)))}
              className="tnum"
            />
          </Field>
        </div>

        <div className="mt-4">
          <span className="block text-[13px] font-semibold text-ink-2 mb-2">Preview</span>
          {printDisabled ? (
            <p className="text-[12.5px] text-ink-3">
              Set a public order URL below to preview and print table QR codes.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {previewTables.map((t) => (
                <div
                  key={t}
                  className="w-24 p-2.5 rounded-xl border border-line bg-surface-2 text-center"
                >
                  <img
                    src={tableQrDataUrl(PUBLIC_ORDER_URL, t)}
                    alt={`QR for table ${t}`}
                    className="w-full aspect-square"
                  />
                  <span className="block text-[12px] font-bold text-ink mt-1.5">{t}</span>
                </div>
              ))}
              {tables.length > previewTables.length && (
                <div className="w-24 p-2.5 rounded-xl border border-dashed border-line grid place-items-center text-center">
                  <span className="text-[12px] text-ink-3">
                    +{tables.length - previewTables.length} more
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-line">
          <Button
            variant="outline"
            icon={<Printer size={16} />}
            disabled={printDisabled}
            onClick={doPrint}
          >
            Print table QR codes
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle title="Public order URL" subtitle="Where the QR codes point customers to" />
        <Field
          label="VITE_PUBLIC_ORDER_URL"
          hint={
            hasPublicUrl
              ? 'This must be the deployed public origin — a phone cannot reach a localhost address.'
              : 'Not set. Add VITE_PUBLIC_ORDER_URL to .env.local and restart the app so a phone can reach the order page.'
          }
        >
          <Input value={hasPublicUrl ? PUBLIC_ORDER_URL : 'Not set'} readOnly disabled={!hasPublicUrl} />
        </Field>
      </Card>
    </>
  );
}
