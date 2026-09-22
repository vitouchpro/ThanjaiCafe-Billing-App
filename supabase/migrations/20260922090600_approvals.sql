create table public.approvals (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops(id),
  action            text not null check (action in ('refund', 'void_after_kot', 'discount_override', 'price_override', 'no_sale_open')),
  target_id         uuid not null,
  manager_staff_id  uuid not null references public.staff(id),
  nonce             text not null,
  signature         text not null,
  expires_at        timestamptz not null,
  consumed_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (shop_id, nonce)
);
create index approvals_shop_idx on public.approvals (shop_id);

alter table public.approvals enable row level security;

create policy approvals_read on public.approvals for select to authenticated
  using (public.has_shop_access(shop_id));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (public.has_shop_access(shop_id));
-- Approvals are append-only except for consuming them exactly once; a
-- narrow update policy allows only setting consumed_at from null.
create policy approvals_consume on public.approvals for update to authenticated
  using (public.has_shop_access(shop_id) and consumed_at is null)
  with check (public.has_shop_access(shop_id));

grant select, insert, update on public.approvals to authenticated;
