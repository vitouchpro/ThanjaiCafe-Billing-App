create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  auth_user_id uuid not null unique,
  code         text not null check (code ~ '^[A-Z0-9]{1,4}$'),
  role         text not null default 'till' check (role in ('till', 'kitchen', 'display', 'backoffice')),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (shop_id, code)
);
create index devices_shop_idx on public.devices (shop_id);

alter table public.devices enable row level security;

create policy devices_read on public.devices for select to authenticated
  using (shop_id = ((select auth.jwt()) ->> 'shop_id')::uuid);

grant select on public.devices to authenticated;
grant select, insert, update on public.devices to service_role;
grant usage on schema public to supabase_auth_admin;
grant select on table public.devices to supabase_auth_admin;
create policy devices_auth_admin_read on public.devices for select to supabase_auth_admin using (true);

-- Custom access-token hook: device sessions get shop_id/device_id/role.
-- Owner/manager sessions are left untouched here (Task 4's has_shop_access()
-- checks `memberships` directly at query time instead of via JWT claims, so
-- no owner-side claim injection is needed).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
  d      record;
begin
  select id, shop_id, role into d
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
