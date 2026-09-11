import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PHOTO_CREDITS, PHOTOGRAPHED_PRODUCTS, productPhoto, hasPhoto } from '../photos';
import { defaultProducts } from '../defaults';
import { hasIllustration } from '../illustrations';

/* The photographs are bundled files referenced by path, so a rename or a
   failed download would show up as a broken image on the till rather than a
   build error. These tests catch that. */

const PUBLIC = path.resolve(import.meta.dirname, '../../../public');

describe('bundled product photos', () => {
  it('every referenced photo exists on disk', () => {
    const missing = PHOTOGRAPHED_PRODUCTS
      .map((name) => ({ name, file: productPhoto(name)! }))
      .filter(({ file }) => !fs.existsSync(path.join(PUBLIC, file)));
    expect(missing).toEqual([]);
  });

  it('serves them from an absolute path so nested routes resolve', () => {
    // A relative path would 404 on /billing/history but work on /billing.
    for (const name of PHOTOGRAPHED_PRODUCTS) {
      expect(productPhoto(name)!.startsWith('/products/'), name).toBe(true);
    }
  });

  it('keeps each photo small enough to precache for offline use', () => {
    for (const name of PHOTOGRAPHED_PRODUCTS) {
      const bytes = fs.statSync(path.join(PUBLIC, productPhoto(name)!)).size;
      expect(bytes, `${name} is under 40 KB`).toBeLessThan(40_000);
    }
  });

  it('keeps the whole set within a sensible bundle budget', () => {
    const total = PHOTOGRAPHED_PRODUCTS.reduce(
      (a, name) => a + fs.statSync(path.join(PUBLIC, productPhoto(name)!)).size,
      0,
    );
    expect(total, 'all photos under 700 KB').toBeLessThan(700_000);
  });

  it('ships WebP', () => {
    for (const name of PHOTOGRAPHED_PRODUCTS) {
      const file = path.join(PUBLIC, productPhoto(name)!);
      const head = fs.readFileSync(file).subarray(0, 12);
      // RIFF....WEBP
      expect(head.subarray(0, 4).toString('ascii'), name).toBe('RIFF');
      expect(head.subarray(8, 12).toString('ascii'), name).toBe('WEBP');
    }
  });

  it('credits every photograph, since CC BY-SA requires attribution', () => {
    for (const name of PHOTOGRAPHED_PRODUCTS) {
      const credit = PHOTO_CREDITS[name];
      expect(credit, `${name} has a credit`).toBeDefined();
      expect(credit.title.length, `${name} names its source file`).toBeGreaterThan(0);
      expect(credit.license.length, `${name} records its licence`).toBeGreaterThan(0);
    }
  });

  it('carries no unreferenced credits', () => {
    for (const name of Object.keys(PHOTO_CREDITS)) {
      expect(hasPhoto(name), `${name} credit matches a bundled photo`).toBe(true);
    }
  });
});

describe('photo and illustration together', () => {
  it('gives every seeded product an image from one source or the other', () => {
    const missing = defaultProducts().filter((p) => !p.image).map((p) => p.name);
    expect(missing).toEqual([]);
  });

  it('prefers a photograph when one exists', () => {
    const products = defaultProducts();
    for (const p of products) {
      if (hasPhoto(p.name)) {
        expect(p.image, `${p.name} uses its photo`).toBe(productPhoto(p.name));
      }
    }
  });

  it('falls back to an illustration where no photo was sourced', () => {
    // Ragi malt (ragi koozh) has no usable stock photograph — a drawing is
    // better than a picture of the wrong drink.
    const products = defaultProducts();
    for (const p of products) {
      if (hasPhoto(p.name)) continue;
      expect(hasIllustration(p.name), `${p.name} has a drawing to fall back on`).toBe(true);
      expect(p.image!.startsWith('data:image/svg+xml'), p.name).toBe(true);
    }
  });
});
