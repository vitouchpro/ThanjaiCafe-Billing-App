-- QR ordering: published menu, customers, orders.
-- Bills stay in the till's IndexedDB; only what must cross devices lives here.

create type order_status as enum (
  'AWAITING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING',
  'READY', 'SERVED', 'PAYMENT_FAILED', 'CANCELLED'
);

-- The menu the customer sees. Published explicitly from Settings, so a
-- half-finished price edit never reaches a diner.
-- Deliberately has NO cost column: cost price never leaves the device.
create table menu_items (
  id            text primary key,
  name          text not null,
  category_id   text not null,
  category_name text not null,
  price         numeric(10,2) not null check (price >= 0),
  tax_rate      numeric(5,2) not null default 0 check (tax_rate >= 0),
  image_url     text,
  available     boolean not null default true,
  sort_order    int not null default 0,
  published_at  timestamptz not null default now()
);

-- One row per signed-in diner. Google verifies the email; the phone is typed,
-- so phone_verified stays false until SMS OTP is switched on later.
create table customers (
  id             uuid primary key references auth.users(id) on delete cascade,
  name           text not null default '',
  email          text not null default '',
  email_verified boolean not null default false,
  phone          text not null default '',
  phone_verified boolean not null default false,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create table orders (
  id                  uuid primary key default gen_random_uuid(),
  token               text not null,
  table_code          text not null,
  customer_id         uuid references customers(id) on delete set null,
  -- Name and phone are copied onto the order, not just linked, so a KOT stays
  -- complete and accurate even if the customer later edits their profile.
  customer_name       text not null default '',
  customer_phone      text not null default '',
  status              order_status not null default 'AWAITING_PAYMENT',
  subtotal            numeric(10,2) not null default 0,
  tax                 numeric(10,2) not null default 0,
  total               numeric(10,2) not null default 0,
  razorpay_order_id   text unique,
  -- Idempotency key for the webhook: Razorpay retries, and a repeat delivery
  -- must never produce a second bill or a second KOT.
  razorpay_payment_id text unique,
  bill_id             text,
  note                text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  accepted_at         timestamptz,
  ready_at            timestamptz,
  served_at           timestamptz
);

create index orders_status_created_idx on orders (status, created_at desc);
create index orders_customer_idx on orders (customer_id, created_at desc);

-- Deliberately a priced snapshot, not a live join: name, unit_price and tax_rate
-- are copied at order time, and product_id carries NO foreign key to menu_items.
-- Republishing the menu deletes withdrawn items, and an FK would either block
-- that or cascade away order history. A line must survive its menu item.
create table order_lines (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  product_id text not null,
  name       text not null,
  unit_price numeric(10,2) not null,
  qty        int not null check (qty > 0),
  tax_rate   numeric(5,2) not null default 0,
  note       text
);

create index order_lines_order_idx on order_lines (order_id);

-- Daily token counter: A-01, A-02 ... resets each day. This is the number
-- called out when food is ready, so it must be short and unique per day.
create table order_tokens (
  day        date primary key,
  last_value int not null default 0
);

create or replace function next_order_token()
returns text
language plpgsql
as $$
declare
  n int;
begin
  insert into order_tokens (day, last_value)
    values (current_date, 1)
    on conflict (day) do update set last_value = order_tokens.last_value + 1
    returning last_value into n;
  return 'A-' || lpad(n::text, 2, '0');
end;
$$;

-- Realtime: the till and the kitchen screen both subscribe to orders.
alter publication supabase_realtime add table orders;
