create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id),
  shop_id    uuid not null references public.shops(id),
  role       text not null check (role in ('owner', 'manager')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, shop_id)
);
create index memberships_user_idx on public.memberships (user_id);
create index memberships_shop_idx on public.memberships (shop_id);

alter table public.memberships enable row level security;

create policy memberships_read_own on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.memberships to authenticated;
grant select, insert, update on public.memberships to service_role;

-- The single access predicate every later shop-scoped table's RLS policies
-- reuse: true for a device whose JWT carries this shop_id, or for a user
-- with an active membership on this shop.
create or replace function public.has_shop_access(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_shop_id = nullif((select auth.jwt()) ->> 'shop_id', '')::uuid
    or exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.shop_id = target_shop_id
        and m.active
    );
$$;

grant execute on function public.has_shop_access to authenticated;

-- Now that has_shop_access() exists, give accounts/shops real read policies.
create policy shops_read on public.shops for select to authenticated
  using (public.has_shop_access(id));
create policy accounts_read on public.accounts for select to authenticated
  using (exists (select 1 from public.shops s where s.account_id = accounts.id and public.has_shop_access(s.id)));
