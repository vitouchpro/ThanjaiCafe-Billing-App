# THE CAFE — Coffee Shop Billing App

A React + TypeScript point-of-sale and billing application for a coffee shop,
implementing the V1 scope from the implementation plan: **Dashboard, Billing/POS,
Products, Reports, Settings**, plus daily closing and offline operation.

Everything runs on the device. There is no backend requirement — bills are written
to IndexedDB the moment payment completes, and the app keeps taking payments with
the network unplugged.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 207 unit tests
npm run build    # production build + service worker
```

**Demo PINs** — Owner `1234` · Manager `2345` · Cashier `3456` · Kitchen `4567`

First run seeds a 28-item South Indian menu and ~90 days of plausible trading
history, so the dashboard and reports have real distributions to display.

---

## What is built

| Plan section | Status |
|---|---|
| §2 Responsive UI (desktop / tablet / mobile) | Sidebar, bottom nav, POS reflows to Products → Cart → Payment |
| §4–5 Owner dashboard | KPI cards, sales trend, top/low sellers, peak hours, best category, payment split, discounts |
| §6–7 POS + product cards | Two-pane desktop layout, photographed product cards, tap to add / tap again for quantity |
| §8–10 Products | Add/edit with image upload, list with availability, detail view |
| §11 Discounts | Item-level and bill-level, percent or fixed, apportioned correctly |
| §12–13 Payment & success | Cash tendering with change, UPI QR, card; success screen with New Bill primary |
| §14 Bill history | Search, detail, reprint, share, refund, cancel |
| §15–19 Reports | Daily/weekly/monthly × sales, products, payments, discounts, refunds; all six product sorts; CSV export |
| §20–26 Settings | Business, invoice, receipt, billing/tax, appearance, users & roles, notifications, backup |
| §27 Daily closing | Cash reconciliation with over/short, closing ID |
| §32 Offline mode | Service worker + IndexedDB; verified working with the network disabled |

Out of scope by design (§29): inventory, purchase, recipe, production, wastage,
suppliers. The data model reserves hooks for them (`Product.recipeId`,
`trackInventory`) so they attach without migrating bills.

---

## Architecture

```
src/
├── components/      ui/ layout/ charts/ product/ billing/
├── pages/           Dashboard/ Billing/ Products/ Reports/ Settings/ Auth/
├── features/auth/   role and permission rules
├── services/
│   ├── billing/     calc.ts (money engine) · receipt.ts · qr.ts · upi.ts
│   ├── reports/     analytics.ts · export.ts
│   ├── db/          Dexie schema, backup/restore
│   └── api/         sync queue
├── store/           useAppStore (app state) · useCartStore (POS cart)
├── hooks/  utils/  types/  data/  routes/
```

### Money is never floating point

Every bill computation runs in integer paise and converts back at the boundary
(`services/billing/calc.ts`). Bill-level discounts are **apportioned across lines**
by largest-remainder rather than subtracted at the end, and GST is rounded **per
tax slab** then apportioned within it. This is what keeps a mixed 5%/12% bill
adding up exactly, and per-product discount reporting honest.

A worked case from the plan (§6): Filter Coffee ×2, Vadai ×3, Thattai ×1 with a
₹10 bill discount → subtotal ₹115, taxable ₹105, GST ₹5.25, total ₹110.25 —
covered by tests.

### Offline-first

IndexedDB (Dexie) is the source of truth. Bills carry `synced: 0` until a backend
accepts them; `services/api/sync.ts` is the drain loop with exponential backoff,
and `pushBills` is the single seam a real server plugs into. With no server
configured the UI says *"saved on this device"* rather than pretending to sync.

Invoice numbers are reserved inside a Dexie transaction, so two rapid
**Complete Bill** taps can never issue the same bill number.

### The QR encoder

`services/billing/qr.ts` is a from-scratch QR encoder (byte mode, ECC M,
versions 1–10) so UPI codes work with no network and no vendored bundle. It is
verified two ways in the test suite: decoded by an independent decoder (jsQR),
and compared module-for-module against a reference encoder across every
supported version.

### Product photography

26 of the 28 seeded items ship with real photographs (`data/photos.ts`), bundled
as 400 px WebP — 4:3 pre-cropped, ~380 KB for the whole menu, and precached by
the service worker so they render with the network unplugged.

**Every photo was checked against the actual dish.** Stock search for South
Indian food is unreliable: "masala dosa" returned tacos and a painting, "filter
coffee" returned espresso rigs and street portraits, and "poori" returned Chole
Bhature. Nothing here was accepted on search ranking alone — candidates were
rendered to contact sheets, inspected, and re-picked where the crop cut the dish
out of frame.

Each bundled photo also went through a local cleanup pass (`process-photos.mjs`
at the project root; pristine originals kept in `photo-backups/`): a tighter
crop to pull an unrelated prop, a watermark, or an extra object out of frame —
a laptop keyboard behind Filter Coffee, a stray water glass next to Lemon Tea,
a blog watermark on Rava Kesari, a decorative flower next to Murukku, a hand in
frame behind Cold Coffee — and, only where the source background was already
light, a soft fade to a clean white card. On a dark or patterned background
that fade just looks hazy without ever reaching white, so those keep their
real background, tightened but otherwise honest; the product card's own frame
(white padding, rounded corners, a soft shadow) carries the rest of the
"clean app tile" feel.

Sources are Wikimedia Commons (CC BY / CC BY-SA / CC0), which carries genuine
documentary photographs of regional dishes, and Unsplash for the generic drinks.
CC BY-SA requires attribution, so credits ship in **Settings → Backup & Data →
Photo credits** rather than a file nobody reads.

**Ragi Malt and Masala Tea keep their hand-drawn illustration** — no stock
library has a usable photo of ragi koozh, and the bundled masala tea photo was
too blurred and cluttered to salvage even with cropping; an honest drawing
beats a picture of the wrong drink or an unusable one. The illustration set
(`data/illustrations.ts`) remains as the fallback for these and for any
product a shop adds whose name matches a drawing; anything else falls back to
a theme-aware initials tile. Its art is a bold, flat, animated style — CSS
embedded in each SVG (respecting `prefers-reduced-motion`) gives it a light
pop-in, plus a slow steam/shimmer loop for hot and cold drinks — but it only
ever appears where there is no usable photo.

A shop replaces any image with its own photo through **Add/Edit Product** (the
upload downscales to 640 px JPEG). Installs created before the artwork existed
are upgraded on next launch — the backfill replaces our own bundled SVGs but
never touches a photo the shop uploaded.

### Permissions

Role defaults live in `features/auth/permissions.ts` and are enforced at the
route level, not just in the nav. A cashier signing in lands on the POS, sees no
cost or margin figures anywhere, and deep-linking to `/reports` gets an
explanation rather than a blank screen.

---

## QR ordering

A diner at a table can order and pay from their own phone, with no app to
install and no PIN. This is additive: the till still runs exactly as above
with the network unplugged, and QR ordering degrades cleanly (a clear
"not configured" message) wherever its cloud pieces are absent.

### The customer flow

1. Scan the QR code printed on the table. It opens `/order?t=T04` — `T04` is
   the table code baked into that table's code, so the cafe always knows
   which table an order came from without asking.
2. The menu loads from Supabase (never from the device's own IndexedDB — a
   diner's phone must never fetch cost price or anything staff-only). Adding
   items keeps a running total.
3. At checkout, the diner signs in with Google — this is what makes the
   order theirs, gives a name for the kitchen ticket, and lets the status
   page be reopened later without a PIN.
4. First-time diners type a phone number (typed, not yet OTP-verified — see
   `customers.phone_verified` in the schema for the seam a future SMS step
   plugs into).
5. Paying opens Razorpay Checkout. The order is re-priced from the published
   menu on the server first (`create-order`), so nothing a phone sends is
   trusted for money.
6. The diner lands on a live status page and watches their token move
   through Paid → Accepted → Preparing → Ready, sourced from the database,
   never guessed client-side.

### The three surfaces

| Who | URL | What they see |
|---|---|---|
| Customer | `/order?t=T04` (per-table QR code) | Menu, cart, checkout, live order status |
| Cashier | `/billing/online` | Every online order in progress, its bill, KOT reprint, "mark served" |
| Kitchen | `/kitchen` | A large-type board of what to cook now, grouped New → Preparing → Ready |

### Setup (once, before going live)

1. Apply both migrations — `supabase/migrations/0001_qr_ordering.sql` (the
   schema) and `0002_rls.sql` (row-level security) — via the SQL editor or
   `npx supabase db push`.
2. Enable the Google provider in Supabase Auth, backed by a Google Cloud
   OAuth client. This is the only sign-in method for customers; staff PINs
   are unrelated and unaffected.
3. Deploy the two edge functions: `npx supabase functions deploy create-order
   verify-payment`.
4. Set the three Razorpay secrets on the *functions*, never in `.env.local`:
   `npx supabase secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=…
   RAZORPAY_WEBHOOK_SECRET=…`. Only `VITE_RAZORPAY_KEY_ID` (the public key
   id) belongs in `.env.local` — the key secret and webhook secret would ship
   in the browser bundle if they were placed there.
5. Register the Razorpay webhook to call `/functions/v1/verify-payment` for
   `payment.captured` and `payment.failed`.
6. Publish the menu from **Settings → Online Ordering** — this is a
   deliberate, explicit step, so a half-finished price edit on the till
   never reaches a diner's phone mid-edit.
7. Print the table QR codes, also from **Settings → Online Ordering**. Each
   one encodes that table's `t=` code, which is how an order is attributed
   to a table with zero typing.

### How a paid order reaches the cashier and the kitchen

Nothing pushes to the till — the till and the kitchen board both *watch*.
`useOrderIntake` subscribes to Supabase Realtime on the `orders` table (with
a 30s poll as a fallback, in case a socket drops silently) and reacts the
moment a row turns `PAID`:

- A chime plays and a badge appears on the Online Orders nav item — audible
  and visible even if a cashier is mid-bill on another screen.
- A non-blocking banner surfaces the new order without interrupting whatever
  the cashier is doing with a walk-in customer.
- A bill is created automatically from the order (`orderToBill`) and filed
  into the same Bill History a walk-in bill lands in, carrying `sourceOrderId`
  and the "Online" badge so it's never confused with a till-rung sale.
- The order's KOT reprints from `/kitchen` or `/billing/online` on demand,
  same as any other ticket.

Two tills can be watching the same order at once, so claiming it into a bill
is a conditional update (`status` must still be `PAID`) — exactly one device
wins the race and writes the bill; the other does nothing. That is what
stops a single paid order from ever becoming two bills with two invoice
numbers.

### The single-writer rule

`PAID` is written in exactly **one** place in the entire system:
`supabase/functions/verify-payment`, the Razorpay webhook handler — and
only after it has verified the webhook's HMAC signature. No client, no
button, and no other function ever sets an order to `PAID`. That single
choke point is what releases food to the kitchen: `/kitchen` and
`/billing/online` only ever query `KITCHEN_VISIBLE` statuses
(`PAID`/`ACCEPTED`/`PREPARING`/`READY`), so an order sitting in
`AWAITING_PAYMENT` is structurally invisible to the kitchen — not filtered
out by a UI check that could be bypassed, but never selected by the query
in the first place.

### Daily Closing

Online sales appear at Daily Closing on their **own line**, separate from
cash sales, and deliberately do **not** affect the expected cash figure or
the till's cash-in-drawer count. That money settled to the bank through
Razorpay — it was never in the cashier's hand — so folding it into the cash
reconciliation would make a cashier responsible for balancing money they
never touched.

---

## Testing

```
npm test
```

207 tests covering the areas where a mistake costs real money:

- **Bill maths** — discount stacking, mixed GST slabs, tax-inclusive pricing,
  apportioning, float drift, discounts capped at the bill value
- **QR encoding** — round-trip decode, reference-encoder equivalence
- **Analytics** — refunded/cancelled bills excluded from sales, peak-hour
  windows, discount apportioning to products, never-sold items kept out of the
  "low selling" list
- **Dates** — local-time day keys (a 12:30 AM bill files under the right day),
  Monday week starts, leap years
- **Illustrations** — each parses as valid SVG, none reference the network,
  and no two share identical artwork
- **Photos** — every referenced file exists, is valid WebP, stays within the
  offline cache budget, and carries the attribution its licence requires

Browser verification scripts live in `.verify/` (Playwright): end-to-end sale,
mobile layout, dark mode, offline operation, permission enforcement, the
customer-facing routes with no staff session, and a full QR-order round trip
(`qr-order-e2e.mjs`) covering menu → cart → checkout → payment → kitchen →
cashier → live status. The last one needs a reachable Supabase project and,
for its payment-bypassing assertions, a `SUPABASE_SERVICE_ROLE_KEY` in the
environment (never committed); it skips cleanly and explains why whenever
either is unavailable.

---

## Notes for going further

- **Payments** for walk-in bills are confirmed manually, as the plan specifies
  for V1 — the UPI QR is real and scannable, but the cashier taps "paid" on
  trust. This is no longer true for QR orders: those are gateway-verified by
  `supabase/functions/verify-payment`, which checks Razorpay's HMAC signature
  before ever writing `PAID`, and no human confirmation is in that path at all.
- **Printing** uses a hidden iframe and the OS print dialog, sized for 58 mm,
  80 mm or A4. No PDF dependency.
- **Sync** needs a `SyncTransport` implementation and a server; nothing else in
  the pipeline changes.
