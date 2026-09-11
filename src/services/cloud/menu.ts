import { supabase } from './client';
import { effectivePrice } from '@/services/billing/calc';
import type { Category, Product } from '@/types';

/* The published menu is a deliberate snapshot, not a mirror. The owner presses
   Publish; until then a half-finished price edit stays on the device.

   Cost price is not in this shape at all — the only reliable way to guarantee
   it never reaches a customer is for it never to enter the payload. */

/* PostgREST's `not.in` filter has to be built as a string and is NOT sanitised
   by the client library ("used as-is", per its own docs). The withdraw query
   below interpolates ids into that filter, so an id must be provably inert
   first — and on a DELETE path that means an allowlist, not a blocklist: a
   blocklist has to anticipate every metacharacter (a backslash escaping the
   closing quote, say), while this says only what an id may contain.

   Every id the app produces is `<prefix>-<base36>` from uid(), and every seeded
   id looks like `cat-coffee`, so nothing legitimate is excluded. Ids restored
   from a user-supplied backup file are the realistic source of anything else. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Throws unless every id is provably inert in a PostgREST filter. Exported so
    the guard itself is under test, not merely the pattern behind it. */
export function assertPublishableIds(ids: string[]): void {
  // findIndex, not find: an empty-string id fails SAFE_ID but is itself falsy,
  // so `if (found)` would wave it through to the DELETE.
  const i = ids.findIndex((id) => !SAFE_ID.test(id));
  if (i !== -1) {
    throw new Error(`Cannot publish menu: product id contains invalid characters: ${ids[i]}`);
  }
}

export interface MenuRow {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  price: number;
  tax_rate: number;
  image_url: string | null;
  available: boolean;
  sort_order: number;
}

export function toMenuRows(products: Product[], categories: Category[]): MenuRow[] {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const catOrder = new Map(categories.map((c) => [c.id, c.sortOrder]));

  return products
    .filter((p) => !p.archived)
    .map((p) => ({
      id: p.id,
      name: p.name,
      category_id: p.categoryId,
      category_name: catName.get(p.categoryId) ?? 'Other',
      // The price the customer actually pays, product discount already applied.
      price: effectivePrice(p),
      tax_rate: p.taxRate,
      image_url: p.image ?? null,
      available: p.available,
      sort_order: catOrder.get(p.categoryId) ?? 0,
    }));
}

export async function publishMenu(
  products: Product[],
  categories: Category[],
): Promise<{ published: number }> {
  if (!supabase) throw new Error('Online ordering is not configured');

  const token = import.meta.env.VITE_PUBLISH_TOKEN ?? '';
  if (!token) {
    throw new Error(
      'Publishing is not set up. Add VITE_PUBLISH_TOKEN to .env.local, matching the ' +
      'PUBLISH_TOKEN secret set on the publish-menu function.',
    );
  }

  const rows = toMenuRows(products, categories);

  /* Validated here as well as on the server. The server is the boundary that
     matters, but catching it locally names the offending product while the
     owner is looking at their own menu, rather than returning a 400. */
  assertPublishableIds(rows.map((r) => r.id));

  /* The write itself happens in an edge function, not here.

     `menu_items` is world-readable and writable by nobody: a customer holding
     the anon key must not be able to edit prices. The Publish button lives in
     this browser, which holds exactly that anon key — so writing from here
     failed, correctly, with a row-level security violation. The alternative,
     putting a service-role key in the bundle, would hand every customer the
     ability to rewrite the menu. */
  const { data, error } = await supabase.functions.invoke<{ published?: number; error?: string }>(
    'publish-menu',
    { body: { rows }, headers: { 'x-publish-token': token } },
  );

  if (error) {
    // The function's own message is the useful one — it names a bad product id
    // or explains that publishing is not allowed.
    const detail = (data as { error?: string } | null)?.error;
    throw new Error(detail || error.message);
  }
  if (data?.error) throw new Error(data.error);

  return { published: data?.published ?? rows.length };
}


export async function fetchPublishedMenu(): Promise<MenuRow[]> {
  if (!supabase) throw new Error('Online ordering is not configured');
  const { data, error } = await supabase
    .from('menu_items').select('*').order('sort_order').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as MenuRow[];
}
