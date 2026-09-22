-- Back up the till's bills to the database.
--
-- Until now every bill lived only in the cashier's browser. Each one is saved
-- with `synced: 0`, and a drain queue was written for them — but nothing ever
-- called it, and there was nowhere upstream to send them. So a laptop failure
-- would have taken the shop's entire trading history with it.
--
-- These tables are a MIRROR, not a second source of truth. The till stays
-- authoritative: it writes locally first so a cashier never waits on the
-- network, and pushes afterwards. That ordering is deliberate — a shop must be
-- able to take money during an outage, and a bill that exists locally but not
-- yet upstream is merely un-backed-up, never lost or wrong.

create table if not exists bills (
  -- The till's own id, so a repeated push is an upsert rather than a duplicate.
  id                 text primary key,
  bill_no            text not null,
  seq                int  not null,
  created_at         timestamptz not null,

  /* Lines are stored whole. Nothing queries inside them — reporting runs on the
     till, and this copy exists to restore from, so a faithful snapshot beats a
     normalised shape that could drift from the original. */
  lines              jsonb not null,
  totals             jsonb not null,

  bill_discount      numeric(10,2) not null default 0,
  bill_discount_type text not null default 'fixed',
  payment            text not null,
  cash_received      numeric(10,2),
  change_given       numeric(10,2),
  status             text not null,
  customer_name      text,
  customer_phone     text,
  cashier_id         text not null,
  cashier_name       text not null,
  note               text,
  refunded_at        timestamptz,
  refund_amount      numeric(10,2),
  cancelled_at       timestamptz,
  held_label         text,
  -- Ties a bill back to the QR order it came from, when it had one.
  source_order_id    uuid,
  -- When this row was last written upstream, not when the sale happened.
  backed_up_at       timestamptz not null default now()
);

create index if not exists bills_created_idx on bills (created_at desc);
create index if not exists bills_seq_idx on bills (seq desc);
create index if not exists bills_status_idx on bills (status);

create table if not exists day_closes (
  id             text primary key,
  date           date not null,
  closed_at      timestamptz not null,
  total_sales    numeric(10,2) not null default 0,
  cash_sales     numeric(10,2) not null default 0,
  upi_sales      numeric(10,2) not null default 0,
  card_sales     numeric(10,2) not null default 0,
  -- Absent on days closed before QR ordering existed, hence nullable.
  online_sales   numeric(10,2),
  discounts      numeric(10,2) not null default 0,
  refunds        numeric(10,2) not null default 0,
  orders         int not null default 0,
  expected_cash  numeric(10,2) not null default 0,
  actual_cash    numeric(10,2) not null default 0,
  difference     numeric(10,2) not null default 0,
  note           text,
  closed_by      text not null,
  backed_up_at   timestamptz not null default now()
);

create index if not exists day_closes_date_idx on day_closes (date desc);

alter table bills       enable row level security;
alter table day_closes  enable row level security;

/* Deliberately no policy on either: RLS on with zero policies denies every
   ordinary role, so the anon key shipped in the browser cannot read a single
   bill. These are the shop's financial records — a diner scanning a QR code
   holds the same key and must never be able to list the day's takings.

   The till writes through an edge function holding the service-role key, which
   bypasses RLS. That is the only path in or out. */
