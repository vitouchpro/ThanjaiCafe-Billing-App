-- Spike schema: production-shaped, minimal. Throwaway project only.
create extension if not exists pgcrypto;

create table public.shops (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  auth_user_id uuid not null unique,
  code         text not null check (code ~ '^[A-Z0-9]{1,4}$'),
  revoked_at   timestamptz,
  unique (shop_id, code)
);

create table public.products (
  id          uuid primary key,
  shop_id     uuid not null references public.shops(id),
  name        text not null,
  unit        text not null default 'pcs',
  price_paise bigint not null check (price_paise >= 0),
  rev         int not null default 1,
  updated_at  timestamptz not null default now()
);

create table public.bills (
  id             uuid primary key,
  shop_id        uuid not null references public.shops(id),
  device_id      uuid not null references public.devices(id),
  invoice_no     text not null,
  fy             text not null,
  seq            int  not null,
  business_date  date not null,
  payment_method text not null,
  total_paise    bigint not null check (total_paise >= 0),
  created_at     timestamptz not null,
  received_at    timestamptz not null default now(),
  unique (shop_id, device_id, fy, seq)
);
create index bills_shop_created_idx on public.bills (shop_id, created_at desc);
create index bills_shop_date_idx on public.bills (shop_id, business_date);

create table public.bill_lines (
  id               uuid primary key,
  bill_id          uuid not null references public.bills(id),
  shop_id          uuid not null references public.shops(id),
  product_id       uuid not null,
  name             text not null,
  qty              numeric(12,3) not null check (qty > 0),
  unit             text not null,
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_total_paise bigint not null check (line_total_paise >= 0)
);
create index bill_lines_bill_idx on public.bill_lines (bill_id);
create index bill_lines_shop_idx on public.bill_lines (shop_id);

-- Transactions are append-only: a trigger blocks edits and deletes even for owners of the table.
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'append-only table: % cannot be edited', tg_table_name using errcode = '42501';
end $$;
create trigger bills_append_only before update or delete on public.bills
  for each row execute function public.forbid_mutation();
create trigger bill_lines_append_only before update or delete on public.bill_lines
  for each row execute function public.forbid_mutation();

-- RLS: a device sees and writes only its own shop, read from the JWT.
alter table public.shops      enable row level security;
alter table public.devices    enable row level security;
alter table public.products   enable row level security;
alter table public.bills      enable row level security;
alter table public.bill_lines enable row level security;

create policy shops_read on public.shops for select to authenticated
  using (id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy devices_read on public.devices for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);

create policy products_read on public.products for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy products_insert on public.products for insert to authenticated
  with check (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy products_update on public.products for update to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid)
  with check (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);

create policy bills_read on public.bills for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy bills_insert on public.bills for insert to authenticated
  with check (
    shop_id   = ((select auth.jwt()) ->> 'shop_id')::uuid
    and device_id = ((select auth.jwt()) ->> 'device_id')::uuid
  );

create policy bill_lines_read on public.bill_lines for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);
create policy bill_lines_insert on public.bill_lines for insert to authenticated
  with check (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);

-- Explicit grants (Data API exposure is opt-in from 30 Oct 2026).
grant select on public.shops, public.devices to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert on public.bills, public.bill_lines to authenticated;

-- Custom access token hook: adds shop_id and device_id from the devices table,
-- never from anything the user can edit.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
  d      record;
begin
  select id, shop_id into d
  from public.devices
  where auth_user_id = (event ->> 'user_id')::uuid and revoked_at is null;

  if found then
    claims := jsonb_set(claims, '{shop_id}',   to_jsonb(d.shop_id::text));
    claims := jsonb_set(claims, '{device_id}', to_jsonb(d.id::text));
    claims := jsonb_set(
      claims, '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb)
        || jsonb_build_object('shop_id', d.shop_id::text, 'device_id', d.id::text, 'role', 'device')
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on table public.devices to supabase_auth_admin;
create policy devices_auth_admin_read on public.devices for select to supabase_auth_admin using (true);
