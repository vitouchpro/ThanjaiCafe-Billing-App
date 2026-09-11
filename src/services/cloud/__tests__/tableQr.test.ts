import { describe, it, expect } from 'vitest';
import { tableOrderUrl, tableQrDataUrl, tableSheetHtml } from '../tableQr';
import jsQR from 'jsqr';

describe('tableOrderUrl', () => {
  it('points at the public order route with the table code', () => {
    expect(tableOrderUrl('https://cafe.example.com', 'T04'))
      .toBe('https://cafe.example.com/order?t=T04');
  });

  it('tolerates a trailing slash on the base url', () => {
    expect(tableOrderUrl('https://cafe.example.com/', 'T04'))
      .toBe('https://cafe.example.com/order?t=T04');
  });

  it('encodes table codes that need it', () => {
    expect(tableOrderUrl('https://x.com', 'A 1')).toBe('https://x.com/order?t=A%201');
  });
});

describe('tableQrDataUrl', () => {
  it('produces a scannable svg data url', () => {
    const url = tableQrDataUrl('https://cafe.example.com', 'T04');
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
  });
});

describe('tableSheetHtml', () => {
  it('renders one printable card per table', () => {
    const html = tableSheetHtml('https://x.com', ['T01', 'T02', 'T03'], 'THANJAI CAFE');
    expect(html.match(/class="card"/g)).toHaveLength(3);
    expect(html).toContain('T01');
    expect(html).toContain('THANJAI CAFE');
  });
});

describe('the QR a diner actually scans', () => {
  /* The prefix assertion above proves only that something SVG-shaped came back.
     This decodes the data URL that tableQrDataUrl ACTUALLY returns, with an
     independent decoder, so the wiring is under test and not just the encoder:
     a refactor that double-encodes the URL, or hands the encoder the wrong
     string, fails here. qr.test.ts covers the encoder itself. */
  const decodeDataUrl = (dataUrl: string): string | undefined => {
    const svg = decodeURIComponent(dataUrl.replace('data:image/svg+xml;utf8,', ''));

    // viewBox carries the module count including the quiet zone.
    const box = svg.match(/viewBox="0 0 (\d+) /);
    const dimModules = Number(box![1]);

    // Each dark module is emitted as `M<c> <r>h1v1h-1z`.
    const dark = new Set<string>();
    for (const m of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
      dark.add(`${m[1]},${m[2]}`);
    }

    const scale = 4;
    const dim = dimModules * scale;
    const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
    for (const key of dark) {
      const [cx, cy] = key.split(',').map(Number);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (cy * scale + dy) * dim + (cx * scale + dx);
          data[px * 4] = 0; data[px * 4 + 1] = 0; data[px * 4 + 2] = 0;
        }
      }
    }
    return jsQR(data, dim, dim)?.data;
  };

  it('decodes back to the ordering URL for that table', () => {
    const decoded = decodeDataUrl(tableQrDataUrl('https://thanjai.example.com', 'T04'));
    expect(decoded).toBe('https://thanjai.example.com/order?t=T04');
  });

  it('survives a table code that needs escaping', () => {
    const decoded = decodeDataUrl(tableQrDataUrl('https://thanjai.example.com', 'A 1'));
    expect(decoded).toBe('https://thanjai.example.com/order?t=A%201');
  });
});
