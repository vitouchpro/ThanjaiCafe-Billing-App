import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBill as browserCompute } from '../../../../src/services/billing/calc';
import { computeBill as denoCompute } from '../calc';
import type { BillLine } from '../../../../src/types';

const line = (over: Partial<BillLine>): BillLine => ({
  id: 'l', productId: 'p', name: 'Item', unitPrice: 25, costPrice: 9.8,
  qty: 1, discount: 0, discountType: 'percent', taxRate: 5, ...over,
});

const OPTS = { pricesIncludeTax: false, roundTotals: false };

describe('server money engine', () => {
  it('is a verbatim copy of the browser engine below the shim', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const browser = readFileSync(join(root, 'src/services/billing/calc.ts'), 'utf8');
    const deno = readFileSync(join(root, 'supabase/functions/_shared/calc.ts'), 'utf8');

    // The Deno file is the shim followed by calc.ts with its import lines
    // removed. Comparing the remainder is what catches drift.
    // Normalize line endings (CRLF to LF) for Windows compatibility.
    const belowShim = deno.replace(/^[\s\S]*?\/\* END SHIM \*\/\n/, '').trim().replace(/\r\n/g, '\n');
    const withoutImports = browser.split('\n').filter((l) => !l.startsWith('import ')).join('\n').trim().replace(/\r\n/g, '\n');
    expect(belowShim).toBe(withoutImports);
  });

  it('agrees with the browser on the plan §6 worked example', () => {
    const lines = [
      line({ unitPrice: 25, qty: 2, taxRate: 5 }),
      line({ unitPrice: 15, qty: 3, taxRate: 5 }),
      line({ unitPrice: 20, qty: 1, taxRate: 5 }),
    ];
    expect(denoCompute(lines, 10, 'fixed', OPTS)).toEqual(browserCompute(lines, 10, 'fixed', OPTS));
  });

  it('agrees on a mixed GST bill', () => {
    const lines = [
      line({ unitPrice: 120, qty: 1, taxRate: 12 }),
      line({ unitPrice: 45, qty: 3, taxRate: 5, discount: 10, discountType: 'percent' }),
    ];
    expect(denoCompute(lines, 5, 'percent', OPTS)).toEqual(browserCompute(lines, 5, 'percent', OPTS));
  });
});
