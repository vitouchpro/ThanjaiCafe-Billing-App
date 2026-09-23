-- Fixes a gap found in the final whole-branch review: devices_read checked
-- only the device's own shop_id JWT claim, which is null for an owner/
-- manager session (no device context) -- so owners could never list or
-- manage their shop's devices. Use has_shop_access() like every other
-- table, which covers both the device case and the membership case.
drop policy if exists devices_read on public.devices;
create policy devices_read on public.devices for select to authenticated
  using (public.has_shop_access(shop_id));
