# QR Ordering, Online Payment and Kitchen Display — Design

**Date:** 2026-09-08
**Status:** Approved for planning

## Problem

A customer sitting at a table should be able to scan a QR code, read the menu on
their own phone, order, and pay online. The paid order must reach the billing
portal as a real bill and reach the cooking department as a KOT carrying the
customer's name and contact number.

The app today is device-local: IndexedDB is the source of truth, there is no
server, and the UPI QR is a static payee code with no verification. A customer's
phone is a different device, and a payment gateway needs a server-side webhook to
confirm payment. Both requirements make a backend unavoidable.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Backend | Supabase | Postgres + realtime + edge functions in one hosted service |
| Gateway | Razorpay (test mode first) | Standard for Indian F&B; clean webhook + HMAC signatures |
| Customer identity | Google sign-in + typed phone | Free; Google verifies name and email but never returns a phone |
| Phone verification | Deferred, behind a config switch | SMS OTP in India needs a paid provider and TRAI DLT registration |
| On payment | Auto-accept, KOT immediately, cashier alerted | Fastest service, but the order announces itself rather than appearing silently |
| Cashier alert | Sound + nav badge + banner | A silent arrival is missed during exactly the rush when it matters |
| Where orders live | Dedicated "Online Orders" page, plus a badge on the bill in history | A live view of what is cooking, while reports still treat it as an ordinary sale |
| Daily closing | Counted as sales, shown on its own line | The money is in the bank, not the drawer, so it must not inflate the cash count |
| KOT delivery | In-app Kitchen Display Screen | Uses the `kitchen` role and `kot` permission already in the codebase |
| Table identity | Per-table QR, `/order?t=T04` | Kitchen and cashier know where the food goes |
| Order lifecycle | One payment = one closed order | No open tabs, no partial payments, no bill merging |
| Offline | Till stays fully offline; QR ordering needs internet | Preserves the guarantee the current app is built on |
| Menu source | Explicit publish from Settings | Owner controls what customers see; cost prices never leave the device |
| Totals | Recomputed server-side | A tampered client cannot underpay |
| Hosting | Same Vite app on Vercel, customer routes code-split | One codebase, one deploy; customers never download the POS bundle |

## Architecture

Three surfaces, one repository, one deploy.

| Surface | Route | Audience | Auth |
|---|---|---|---|
| Customer menu | `/order?t=T04` | Diner's phone | Google (Supabase Auth) |
| Billing portal | `/billing`, `/billing/online` | Cashier | existing PIN |
| Kitchen display | `/kitchen` | Cooking department | existing PIN, `kot` permission |

Supabase holds only what must cross devices: published menu, customer identity,
live orders, payment state. **IndexedDB remains the source of truth for bills**,
so the walk-in till keeps working with the network unplugged.

### Flow

```
Customer scans table QR  ->  /order?t=T04
  |- menu loads (public read, anon key)
     |- builds cart, taps Checkout
        |- Google sign-in (Supabase Auth OAuth) -> verified name + email
           |- phone entry, 10 digits validated, remembered for next visit
              |- POST create-order (edge function)
                 . server recomputes total from published prices
                 . rejects if it disagrees with the phone's total
                 . writes order status = AWAITING_PAYMENT
                 |- Razorpay Checkout opens on the phone
                    |- Razorpay --webhook--> verify-payment (edge function)
                       . HMAC signature verified
                       . status -> PAID   (the only place PAID is ever set)
                       |- Postgres realtime broadcast
                          |- Billing portal: auto-accepts, writes Bill to
                          |  IndexedDB, reserves invoice number
                          |- Kitchen display: KOT ticket appears with table,
                             token, customer name, phone, items
                             |- kitchen taps Preparing / Ready
                                |- realtime -> customer's phone
```

### Three guarantees

**Payment truth comes only from the webhook.** The phone reporting success shows
a "confirming payment" state and nothing more. `PAID` is written in exactly one
place — the signed webhook handler — and nowhere else in the codebase.

**No KOT before PAID.** The kitchen display subscribes to `status = PAID` and
later only. An abandoned checkout sitting in `AWAITING_PAYMENT` is invisible to
the kitchen, so nobody cooks food that was never paid for.

**One money engine.** `computeBill` in `src/services/billing/calc.ts` is already
pure and operates in integer paise. It is extracted to a shared module imported by
both the browser and the Deno edge function, so client and server totals cannot
drift. The existing calc tests continue to cover it.

## Data model

### Supabase (Postgres, RLS enabled on every table)

**`menu_items`** — published snapshot of the sellable menu.
id, name, category_id, category_name, price, tax_rate, image_url, available,
sort_order, published_at.
Public read via the anon key. **Contains no cost price** — cost never leaves the
device.

**`customers`** — one row per signed-in diner.
id (Supabase auth uid), name, email, email_verified, phone, phone_verified,
created_at, last_seen_at.
`phone_verified` is false under Google sign-in and becomes the switch that phone
OTP flips later. A customer can read and update only their own row.

**`orders`**
id, token (daily counter, e.g. `A-07`), table_code, customer_id, customer_name,
customer_phone, status, subtotal, tax, total, razorpay_order_id,
razorpay_payment_id, kitchen_status, created_at, paid_at, accepted_at, ready_at,
served_at, bill_id (filled by the portal once a local Bill exists).
Customer name and phone are denormalised onto the order so a KOT is complete
without a join and survives a later profile edit.

**`order_lines`**
id, order_id, product_id, name, unit_price, qty, tax_rate, note.
Always priced from `menu_items` server-side; the client's prices are display only.

### Status

One enum is the spine of the feature:

```
AWAITING_PAYMENT -> PAID -> ACCEPTED -> PREPARING -> READY -> SERVED
                 -> PAYMENT_FAILED
                 -> CANCELLED
```

The kitchen sees `PAID` onward. The customer's phone renders the same value as
friendly text. Illegal transitions are rejected server-side — nothing reaches
`PREPARING` without having passed through `PAID`.

### RLS

- `menu_items` — world-readable, writable only by the service role.
- `customers` — a customer reads and writes only `auth.uid() = id`.
- `orders` / `order_lines` — a customer reads only their own orders and may
  insert only through the edge function; staff surfaces read via the service role.

### Local (IndexedDB)

One field is added to the existing `Bill` type:

```ts
sourceOrderId?: ID;   // set when the bill came from a QR order
```

Nothing else in the bill model changes, so reports, day-close, refunds and the
existing tests keep working untouched. Bills without the field are walk-ins.

## Components

### New — customer app (code-split)

- `src/pages/Customer/MenuPage.tsx` — table-scoped menu, category nav, cart
- `src/pages/Customer/CheckoutPage.tsx` — Google sign-in, phone capture, Razorpay
- `src/pages/Customer/OrderStatusPage.tsx` — live status from the kitchen
- `src/features/customer/` — cart store, auth hook, phone capture and validation

### New — staff surfaces

- `src/pages/Kitchen/KitchenPage.tsx` — the KDS; ticket cards, tap to advance
  New -> Preparing -> Ready. Uses the `kitchen` role and `kot` permission that
  already exist in `src/features/auth/permissions.ts` but are currently unused.
- `src/pages/Billing/OnlineOrdersPage.tsx` — live view of paid online orders
- `src/features/orders/useOrderAlerts.ts` — what counts as a newly arrived order
- `src/features/orders/OrderAlertHost.tsx` — the non-blocking arrival banner
- `src/services/billing/kot.ts` — KOT docket rendering, reusing the hidden-iframe
  print path established by `printReceipt` in `receipt.ts`

### New — cloud

- `supabase/migrations/` — schema and RLS policies
- `supabase/functions/create-order/` — recompute totals, create Razorpay order
- `supabase/functions/verify-payment/` — HMAC verification, the sole writer of `PAID`
- `src/services/cloud/` — typed Supabase client, realtime subscriptions, menu publish

### Modified — small and surgical

- `src/types/index.ts` — order types, `Bill.sourceOrderId`
- `src/routes/index.tsx` — public customer routes outside `RequireAuth`;
  `/kitchen` behind the existing `kot` permission
- `src/services/billing/calc.ts` — extract the shared engine, no behaviour change
- `src/pages/Settings/SettingsPage.tsx` — new tab: publish menu, table QR
  generator, Razorpay keys
- `.env.example` — Supabase and Razorpay configuration

The existing from-scratch QR encoder (`qrToDataUrl` in `src/services/billing/qr.ts`)
renders the printed table QR codes. No new dependency.

## What the cashier sees

The paid order must announce itself. A bill that appears silently in history is
one the counter finds out about when the customer asks where their food is.

**The alert.** When an order reaches `PAID`, three things happen on every till
that has the portal open:

1. A short chime plays. Muteable in Settings, and it never fires for an order
   that arrived while the app was closed — only for one that arrives while
   someone is watching, so opening the till in the morning is not a fanfare.
2. A count badge appears on the **Online Orders** nav item and stays until the
   order is served.
3. A banner slides in naming the token, the table and the item count, with one
   action: *View order*. It does not block the screen — a cashier mid-bill for a
   walk-in customer must not be interrupted — and it auto-dismisses, leaving the
   badge behind as the persistent signal.

**Online Orders page** (`/billing/online`). The live view: every order not yet
served, newest first, each showing token, table, customer name and phone, the
items, the total, its kitchen status, and the bill number once one exists.
Actions are *Print KOT* and *Mark served*. An order needing attention — a
sold-out item, a refund owed — is flagged here rather than left to be discovered.

**In Bill History.** The bill is an ordinary bill: it carries an invoice number,
prints the same receipt, and can be refunded or cancelled through the existing
flow. It is marked with an **Online** badge and is filterable, so a cashier can
tell at a glance where a sale came from without it being a separate kind of
record.

**Daily closing.** Online orders count in total sales like any other bill, and
appear on their own line beside Cash / UPI / Card. They deliberately do **not**
affect the expected cash figure: `cashInDrawer()` already filters to
`payment === 'cash'`, so gateway money never inflates the drawer count. The
closing screen therefore reconciles the physical drawer exactly as it does today,
while the day's totals include what was sold online. `DayClose` gains one field,
`onlineSales`, so a closed day records the split it was reconciled against.

## Error handling

The cases that cost real money, handled explicitly:

**Payment succeeds, webhook delayed.** The customer sees "confirming payment".
The portal polls as a fallback. The order is never lost.

**Customer pays, item sold out or cafe closed.** The order is flagged for refund
on the portal instead of silently reaching the kitchen.

**Portal offline when an order arrives.** The order waits in Supabase and is
picked up on reconnect. Nothing depends on the till being awake.

**Duplicate webhook.** Razorpay retries on non-200. The handler is idempotent
keyed on `razorpay_payment_id`, so one payment can never produce two bills or
two KOTs.

**Two portals open at once.** Auto-accept is claimed with a conditional update on
the order row (`accepted_at IS NULL`), and only the device that wins the claim
writes the local bill. A second till seeing the same realtime event finds the
order already accepted and does nothing, so one order cannot become two bills
with two invoice numbers.

**Payment fails or is abandoned.** Status becomes `PAYMENT_FAILED`; no KOT, no
bill, and the cart is preserved so the customer can retry.

## Testing

Following the repository's existing standard (84 unit tests, Playwright scripts
in `.verify/`), written test-first.

**Unit**

- Server-side recomputation matches `computeBill` exactly, including mixed GST
  slabs and the apportioning rules
- A tampered client total is rejected before any payment is created
- Webhook HMAC verification accepts a valid signature and rejects a forged one
- Status transitions reject illegal jumps
- Token numbers are unique per day
- A duplicate webhook produces exactly one bill and one KOT

**Playwright (`.verify/`)**

- Full journey: scan -> menu -> sign in -> pay -> bill on portal -> KOT in kitchen
- Payment failure leaves no KOT and no bill
- Kitchen status changes reach the customer's phone
- Customer routes work without a staff session; `/kitchen` refuses a cashier

## Prerequisites

1. **Supabase project** — created: project ref `hiwufsjnhfrzevjvfefp`,
   URL `https://hiwufsjnhfrzevjvfefp.supabase.co`.
2. **Razorpay test keys** — key id, key secret, and a webhook secret. Live keys are
   a configuration change at the end, not a code change.
3. **Google OAuth client** — created free in Google Cloud Console and registered as
   a Supabase Auth provider.

### Credential handling

The owner applies all schema changes themselves. Migrations are written as
versioned SQL files under `supabase/migrations/` and run either through the
Supabase SQL editor or with `supabase db push` under the owner's own login.

**The `service_role` key is never shared and never committed.** It bypasses every
RLS policy, so it belongs only in edge-function secrets (`supabase secrets set`)
and in `.env.local`, which `.gitignore` already excludes via `*.local`. Only
`.env.example`, carrying placeholders, is committed. The anon key is safe in the
browser bundle by design — RLS is what protects the data, not the key's secrecy.

## Out of scope

Deliberately excluded, consistent with the existing plan's §29 boundaries:

- Open table tabs, multi-round ordering, split bills
- Phone OTP verification (designed for, not built)
- Delivery, takeaway logistics, third-party aggregator integration
- Inventory deduction on order (the `trackInventory` hook stays unused)
- Customer order history and loyalty
