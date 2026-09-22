create table public.staff (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id),
  name       text not null,
  pin_hash   text not null,
  pin_salt   text not null,
  role       text not null check (role in ('cashier', 'kitchen')),
  active     boolean not null default true,
  rev        int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_shop_idx on public.staff (shop_id);

alter table public.staff enable row level security;

create policy staff_read on public.staff for select to authenticated
  using (public.has_shop_access(shop_id));
create policy staff_write on public.staff for insert to authenticated
  with check (public.has_shop_access(shop_id));
create policy staff_update on public.staff for update to authenticated
  using (public.has_shop_access(shop_id))
  with check (public.has_shop_access(shop_id));

grant select, insert, update on public.staff to authenticated;
