import { describe, it, expect } from 'vitest';
import { toMenuRows, assertPublishableIds } from '../menu';
import type { Category, Product } from '@/types';

const product = (over: Partial<Product>): Product => ({
  id: 'p1', name: 'Filter Coffee', categoryId: 'c1', sellingPrice: 25,
  costPrice: 9.8, discount: 0, discountType: 'percent', taxRate: 5,
  available: true, unit: 'cup', createdAt: '', updatedAt: '', ...over,
});

const categories: Category[] = [{ id: 'c1', name: 'Beverages', icon: 'coffee', sortOrder: 1 }];

describe('toMenuRows', () => {
  it('never publishes cost price', () => {
    const rows = toMenuRows([product({ costPrice: 9.8 })], categories);
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('9.8');
    expect(serialised).not.toMatch(/cost/i);
  });

  it('carries the price, tax rate and availability a diner needs', () => {
    const [row] = toMenuRows([product({ sellingPrice: 25, taxRate: 5, available: false })], categories);
    expect(row.price).toBe(25);
    expect(row.tax_rate).toBe(5);
    expect(row.available).toBe(false);
  });

  it('denormalises the category name so the menu needs no join', () => {
    const [row] = toMenuRows([product({})], categories);
    expect(row.category_name).toBe('Beverages');
  });

  it('publishes the discounted price a customer will actually pay', () => {
    const [row] = toMenuRows(
      [product({ sellingPrice: 100, discount: 10, discountType: 'percent' })],
      categories,
    );
    expect(row.price).toBe(90);
  });

  it('leaves out archived products entirely', () => {
    const rows = toMenuRows(
      [product({ id: 'p1' }), product({ id: 'p2', archived: true })],
      categories,
    );
    expect(rows.map((r) => r.id)).toEqual(['p1']);
  });
});

describe('assertPublishableIds', () => {
  // The withdraw query interpolates ids into a PostgREST `not.in` filter that
  // the client does not sanitise, so anything but a plain id must be refused
  // BEFORE a DELETE runs. An allowlist is what makes that provable: the earlier
  // blocklist (" ( ) ,) let a backslash through, which can escape the closing
  // quote of the filter's quoted value.

  it('accepts the id shapes the app actually generates', () => {
    expect(() => assertPublishableIds(['prd-m8x2k9abc', 'cat-coffee', 'a_B-9'])).not.toThrow();
  });

  it('refuses ids carrying filter metacharacters', () => {
    for (const bad of ['a"b', 'a,b', 'a)b', 'a(b']) {
      expect(() => assertPublishableIds([bad])).toThrow(/invalid characters/);
    }
  });

  it('refuses a backslash, which the previous blocklist let through', () => {
    expect(() => assertPublishableIds(['a\\"b'])).toThrow(/invalid characters/);
    expect(() => assertPublishableIds(['a\b'])).toThrow(/invalid characters/);
  });

  it('refuses whitespace and an empty id', () => {
    expect(() => assertPublishableIds(['a b'])).toThrow(/invalid characters/);
    expect(() => assertPublishableIds([''])).toThrow(/invalid characters/);
  });

  it('names the offending id so the owner can find it', () => {
    expect(() => assertPublishableIds(['good-1', 'ba;d'])).toThrow(/ba;d/);
  });

  it('passes an empty list — an empty menu is a valid publish', () => {
    expect(() => assertPublishableIds([])).not.toThrow();
  });
});
