import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import { encodeQr } from '../qr';
import { upiUri } from '../upi';

/* The QR encoder is hand-written, so it is verified against an independent
   decoder (jsQR). If a real scanner could not read these, neither can jsQR. */

const SCALE = 4;

/** Render the module matrix into the RGBA bitmap jsQR expects. */
function rasterize(matrix: boolean[][], quiet = 4) {
  const n = matrix.length;
  const size = (n + quiet * 2) * SCALE;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const y = (r + quiet) * SCALE + dy;
          const x = (c + quiet) * SCALE + dx;
          const i = (y * size + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, size };
}

const roundTrip = (text: string): string | null => {
  const { data, size } = rasterize(encodeQr(text));
  return jsQR(data, size, size)?.data ?? null;
};

describe('QR encoder', () => {
  it('encodes a short UPI URI that decodes back exactly', () => {
    const uri = upiUri({ pa: 'thangai@okaxis', pn: 'Thangai Coffee', am: 235 });
    expect(roundTrip(uri)).toBe(uri);
  });

  it('encodes a realistic UPI URI with note and reference', () => {
    const uri = upiUri({
      pa: 'thangaicoffee@okhdfcbank',
      pn: 'Thangai Coffee & Snacks',
      am: 1234.5,
      tn: 'Bill INV-1026',
      tr: 'INV1026',
    });
    expect(roundTrip(uri)).toBe(uri);
  });

  it('round-trips payloads across several versions', () => {
    for (const text of [
      'A',
      'upi://pay?pa=a@b&am=1.00',
      'x'.repeat(40),
      'y'.repeat(90),
      'z'.repeat(150),
      'w'.repeat(213), // version 10, the largest payload supported
    ]) {
      expect(roundTrip(text)).toBe(text);
    }
  });

  it('handles amounts with paise correctly', () => {
    const uri = upiUri({ pa: 'shop@upi', pn: 'Shop', am: 99.99 });
    expect(uri).toContain('am=99.99');
    expect(roundTrip(uri)).toBe(uri);
  });

  it('produces a square matrix with correct finder patterns', () => {
    const m = encodeQr('test');
    expect(m.length).toBe(m[0].length);
    // Finder pattern: dark ring with dark 3x3 core at each corner.
    for (const [r, c] of [[0, 0], [0, m.length - 7], [m.length - 7, 0]]) {
      expect(m[r][c]).toBe(true);
      expect(m[r + 1][c + 1]).toBe(false);
      expect(m[r + 3][c + 3]).toBe(true);
    }
  });

  it('rejects a payload beyond supported versions', () => {
    expect(() => encodeQr('x'.repeat(1000))).toThrow();
  });
});

describe('QR encoder — matches a reference implementation exactly', () => {
  // Byte-mode payloads only (lowercase defeats alphanumeric mode), ECC M,
  // mask 0 — the same parameters this encoder always uses.
  it('produces an identical matrix to node-qrcode for versions 1-10', async () => {
    const QRCode = (await import('qrcode')).default;

    for (const len of [5, 14, 26, 40, 60, 90, 120, 150, 190, 213]) {
      const text = 'x'.repeat(len);
      const mine = encodeQr(text);
      const version = (mine.length - 17) / 4;
      const ref = QRCode.create(text, {
        errorCorrectionLevel: 'M', version, maskPattern: 0,
      });

      const n = ref.modules.size;
      expect(n, `size for length ${len}`).toBe(mine.length);

      let diffs = 0;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (Boolean(ref.modules.data[r * n + c]) !== mine[r][c]) diffs++;
        }
      }
      expect(diffs, `module diffs at length ${len} (version ${version})`).toBe(0);
    }
  });
});
