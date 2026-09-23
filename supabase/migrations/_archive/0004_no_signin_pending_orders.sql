-- Ordering without an account.
--
-- The shop decided a diner should give nothing at all: scan, pick food, pay,
-- and see a token. No Google, no name, no phone. And nothing may reach the
-- kitchen or the billing portal until the payment has actually succeeded.
--
-- That second rule is why `pending_orders` exists. A cart has to be stored
-- somewhere before the customer pays — the alternative, stuffing it into
-- Razorpay's `notes`, splits a real cart across 15 fields capped at 256 chars
-- each, and a single truncated field would mean a customer has paid for an
-- order nobody can reconstruct. A draft the kitchen cannot see gives the same
-- guarantee with no such failure: staff read `orders`, and a row only lands
-- there when the signed webhook confirms the money arrived.

/* A cart held between "Pay" and the webhook. Invisible to every staff surface.
   The lines are stored as JSON because nothing queries inside them — the draft
   is written once, read once by the webhook, and then deleted. */
create table if not exists pending_orders (
  id                uuid primary key default gen_random_uuid(),
  token             text not null,
  table_code        text not null,
  lines             jsonb not null,
  subtotal          numeric(10,2) not null,
  tax               numeric(10,2) not null,
  total             numeric(10,2) not null,
  razorpay_order_id text unique,
  created_at        timestamptz not null default now()
);

create index if not exists pending_orders_rzp_idx on pending_orders (razorpay_order_id);
create index if not exists pending_orders_created_idx on pending_orders (created_at);

alter table pending_orders enable row level security;

-- Deliberately no policy: deny-all for every ordinary role. Only the edge
-- functions touch this table, and they run as service_role, which bypasses RLS.
-- A diner must not be able to read back or alter their own draft: the prices in
-- it are what they are about to be charged.

/* There is no account any more, so an order has no owner to reference. */
alter table orders alter column customer_id drop not null;

do $do$ begin
  alter table orders drop constraint if exists orders_customer_id_fkey;
exception when undefined_object then null;
end $do$;

/* A diner is identified by their table and the token called out to them —
   the way a cafe already works — so the name and phone columns stay but are
   no longer filled. They are kept rather than dropped because a shop that
   later wants to ask for a name should not need a migration to do it. */

/* Abandoned drafts are litter, not history: someone opened the payment sheet
   and walked away. Nothing references them once they are older than the
   payment window, and nobody can see them, so they are safe to purge. Called
   by the webhook on each delivery, which is often enough without a scheduler. */
create or replace function purge_stale_drafts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from pending_orders where created_at < now() - interval '2 hours';
$$;
