/**
 * The SVG is validated with a real parser, which needs a DOM.
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { productImage, hasIllustration, ILLUSTRATED_PRODUCTS } from '../illustrations';
import { defaultProducts, DEFAULT_CATEGORIES } from '../defaults';

/* The illustrations ship as inline SVG data URIs, so a malformed one would
   silently render as a broken image on the POS rather than throwing. */

describe('productImage', () => {
  it('returns a data URI for an illustrated product', () => {
    const img = productImage('Filter Coffee', 'cat-coffee');
    expect(img).toBeDefined();
    expect(img!.startsWith('data:image/svg+xml;utf8,')).toBe(true);
  });

  it('returns undefined for a product the shop added itself', () => {
    expect(productImage('Chicken Biryani', 'cat-tiffin')).toBeUndefined();
    expect(hasIllustration('Chicken Biryani')).toBe(false);
  });

  it('falls back to a neutral backdrop for an unknown category', () => {
    // A product moved to a custom category must still get its drawing.
    expect(productImage('Vadai', 'cat-made-up')).toBeDefined();
  });

  it('produces well-formed, self-contained SVG', () => {
    for (const name of ILLUSTRATED_PRODUCTS) {
      const uri = productImage(name, 'cat-coffee')!;
      const svg = decodeURIComponent(uri.replace('data:image/svg+xml;utf8,', ''));

      expect(svg.startsWith('<svg'), `${name} opens with <svg`).toBe(true);
      expect(svg.endsWith('</svg>'), `${name} closes`).toBe(true);
      expect(svg).toContain('viewBox="0 0 100 100"');

      // Parse it for real — hand-rolled tag counting misses the cases that
      // actually break rendering (an unclosed <g>, a stray quote).
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const parseError = doc.querySelector('parsererror');
      expect(parseError?.textContent ?? null, `${name} parses as SVG`).toBeNull();
      expect(doc.documentElement.tagName).toBe('svg');
      expect(doc.querySelectorAll('*').length, `${name} draws something`).toBeGreaterThan(3);

      // No external references — these must render with no network. The
      // xmlns declaration is the one permitted http URL.
      const withoutNamespace = svg.replace(/xmlns="[^"]*"/g, '');
      expect(withoutNamespace, `${name} is self-contained`)
        .not.toMatch(/https?:|xlink:href|<image|url\((?!#)/);

      // A stray colour typo (e.g. "#eec severity") would land in a fill.
      const fills = svg.match(/(?:fill|stroke|stop-color)="([^"]+)"/g) ?? [];
      for (const f of fills) {
        const value = f.split('"')[1];
        const ok =
          value === 'none' ||
          value === 'currentColor' ||
          value.startsWith('url(#') ||
          /^#[0-9a-fA-F]{3,8}$/.test(value);
        expect(ok, `${name} has a valid paint value: ${value}`).toBe(true);
      }
    }
  });

  it('draws every item on the seeded menu', () => {
    const missing = defaultProducts().filter((p) => !p.image).map((p) => p.name);
    expect(missing).toEqual([]);
  });

  it('gives each product a visually distinct drawing', () => {
    // Two items sharing byte-identical art would look like a copy-paste slip.
    const seen = new Map<string, string>();
    for (const name of ILLUSTRATED_PRODUCTS) {
      const art = productImage(name, 'cat-coffee')!;
      const clash = seen.get(art);
      expect(clash, `${name} and ${clash} share identical artwork`).toBeUndefined();
      seen.set(art, name);
    }
  });

  it('keeps each image small enough to store inline', () => {
    for (const name of ILLUSTRATED_PRODUCTS) {
      const bytes = new TextEncoder().encode(productImage(name, 'cat-coffee')!).length;
      expect(bytes, `${name} is compact`).toBeLessThan(6000);
    }
  });
});

describe('seeded catalogue', () => {
  it('uses categories that actually exist', () => {
    const ids = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
    for (const p of defaultProducts()) {
      expect(ids.has(p.categoryId), `${p.name} has a real category`).toBe(true);
    }
  });

  it('prices every product above its cost', () => {
    for (const p of defaultProducts()) {
      expect(p.sellingPrice, `${p.name} sells above cost`).toBeGreaterThan(p.costPrice);
    }
  });
});
