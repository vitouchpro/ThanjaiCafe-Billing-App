create table public.advance_orders (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  customer_name  text not null,
  customer_phone text,
  description    text,
  reference_photo_url text,
  pickup_at      timestamptz,
  discount_paise bigint not null default 0,
  status         text not null default 'pending' check (status in ('pending','ready','collected','cancelled')),
  created_at     timestamptz not null default now()
);
create index advance_orders_shop_idx on public.advance_orders (shop_id);

create table public.advance_payments (
  id                uuid primary key default gen_random_uuid(),
  advance_order_id  uuid not null references public.advance_orders(id),
  shop_id           uuid not null references public.shops(id),
  amount_paise      bigint not null check (amount_paise > 0),
  series            text not null default 'ADV',
  fy                text not null,
  seq               int not null,
  created_at        timestamptz not null default now(),
  unique (shop_id, series, fy, seq)
);
create index advance_payments_shop_idx on public.advance_payments (shop_id);

create table public.stock_items (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  product_id  uuid references public.products(id),
  name        text not null,
  unit        text not null default 'pcs',
  low_stock_at numeric(12,3),
  rev         int not null default 1
);
create index stock_items_shop_idx on public.stock_items (shop_id);

create table public.stock_batches (
  id             uuid primary key default gen_random_uuid(),
  stock_item_id  uuid not null references public.stock_items(id),
  shop_id        uuid not null references public.shops(id),
  production_date date,
  expiry_date    date,
  mrp_paise      bigint,
  rev            int not null default 1
);
create index stock_batches_shop_idx on public.stock_batches (shop_id);

create table public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  stock_item_id  uuid not null references public.stock_items(id),
  batch_id       uuid references public.stock_batches(id),
  reason         text not null check (reason in ('sale','receipt','adjustment','wastage','production')),
  qty_delta      numeric(12,3) not null,
  created_at     timestamptz not null default now()
);
create index stock_movements_item_idx on public.stock_movements (stock_item_id);
create index stock_movements_shop_idx on public.stock_movements (shop_id);

create table public.wastage_entries (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  stock_item_id  uuid not null references public.stock_items(id),
  qty            numeric(12,3) not null check (qty > 0),
  reason         text,
  staff_id       uuid,
  created_at     timestamptz not null default now()
);
create index wastage_entries_shop_idx on public.wastage_entries (shop_id);

create trigger advance_payments_append_only before update or delete on public.advance_payments
  for each row execute function public.forbid_mutation();
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function public.forbid_mutation();
create trigger wastage_entries_append_only before update or delete on public.wastage_entries
  for each row execute function public.forbid_mutation();

alter table public.advance_orders enable row level security;
alter table public.advance_payments enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.wastage_entries enable row level security;

create policy advance_orders_read on public.advance_orders for select to authenticated using (public.has_shop_access(shop_id));
create policy advance_orders_write on public.advance_orders for insert to authenticated with check (public.has_shop_access(shop_id));
create policy advance_orders_update on public.advance_orders for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy advance_payments_read on public.advance_payments for select to authenticated using (public.has_shop_access(shop_id));
create policy advance_payments_insert on public.advance_payments for insert to authenticated with check (public.has_shop_access(shop_id));

create policy stock_items_read on public.stock_items for select to authenticated using (public.has_shop_access(shop_id));
create policy stock_items_write on public.stock_items for insert to authenticated with check (public.has_shop_access(shop_id));
create policy stock_items_update on public.stock_items for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy stock_batches_read on public.stock_batches for select to authenticated using (public.has_shop_access(shop_id));
create policy stock_batches_write on public.stock_batches for insert to authenticated with check (public.has_shop_access(shop_id));
create policy stock_batches_update on public.stock_batches for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy stock_movements_read on public.stock_movements for select to authenticated using (public.has_shop_access(shop_id));
create policy stock_movements_insert on public.stock_movements for insert to authenticated with check (public.has_shop_access(shop_id));

create policy wastage_entries_read on public.wastage_entries for select to authenticated using (public.has_shop_access(shop_id));
create policy wastage_entries_insert on public.wastage_entries for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.advance_orders, public.stock_items, public.stock_batches to authenticated;
grant select, insert on public.advance_payments, public.stock_movements, public.wastage_entries to authenticated;
grant select, insert, update, delete on public.advance_orders, public.advance_payments, public.stock_items, public.stock_batches, public.stock_movements, public.wastage_entries to service_role;
