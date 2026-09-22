-- Fixes a gap found in the final whole-branch review: product_costs_read
-- only checked has_shop_access(), letting any till/kitchen device read
-- margin data. Spec section 5: "product_costs syncs only to devices the
-- owner marks back-office." Tighten RLS to match: a device must carry
-- device_role = 'backoffice', or the caller must be an owner/manager
-- (no device_id claim at all).
drop policy if exists product_costs_read on public.product_costs;
create policy product_costs_read on public.product_costs for select to authenticated
  using (
    public.has_shop_access(shop_id)
    and (
      nullif((select auth.jwt()) ->> 'device_id', '') is null
      or (select auth.jwt()) ->> 'device_role' = 'backoffice'
    )
  );
