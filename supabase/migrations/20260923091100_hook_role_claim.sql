-- Adds a top-level `role` claim so Sync Streams queries can read
-- auth.parameter('role') to scope product_costs to back-office devices
-- only (spec section 5: "product_costs syncs only to devices the owner
-- marks back-office"). The original hook (Task 3) only promoted shop_id
-- and device_id to the top level.
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
    claims := jsonb_set(claims, '{device_role}', to_jsonb(d.role::text));
    claims := jsonb_set(
      claims, '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb)
        || jsonb_build_object('shop_id', d.shop_id::text, 'device_id', d.id::text, 'role', 'device', 'device_role', d.role::text)
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;
