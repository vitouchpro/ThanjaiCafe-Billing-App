-- Fixes I4 from the Phase 1 final whole-branch review: spec section 5's
-- Config class says "Only owner/manager write," but every config-class
-- table's insert/update policy used has_shop_access(), which is also true
-- for a device session -- letting any till/kitchen/display device rewrite
-- prices, tax rates, staff PIN records, settings, promotions, etc. with no
-- approval token and no audit trail. Introduces has_manager_access(), which
-- (unlike has_shop_access()) is true ONLY for an owner/manager membership
-- session, never for a device session, and switches every config-class
-- table's write/update policy to it. Read policies are untouched (devices
-- still sync config data read-only, exactly as before).
--
-- Scope decision (owner-confirmed 2026-09-23): tables where a real counter
-- operation legitimately creates/updates the row (customers captured during
-- billing, advance orders taken at the counter, stock movements/wastage
-- logged through the day, tabs/tab_lines already device-scoped) are left on
-- has_shop_access() -- they are operational data a till creates in the
-- normal course of business, not owner-controlled configuration.

create or replace function public.has_manager_access(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.shop_id = target_shop_id
      and m.active
  );
$$;

grant execute on function public.has_manager_access to authenticated;

-- categories
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- products
drop policy if exists products_write on public.products;
create policy products_write on public.products for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- product_costs
drop policy if exists product_costs_write on public.product_costs;
create policy product_costs_write on public.product_costs for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists product_costs_update on public.product_costs;
create policy product_costs_update on public.product_costs for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- menu_publications (insert only)
drop policy if exists menu_publications_write on public.menu_publications;
create policy menu_publications_write on public.menu_publications for insert to authenticated with check (public.has_manager_access(shop_id));

-- product_variants
drop policy if exists product_variants_write on public.product_variants;
create policy product_variants_write on public.product_variants for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists product_variants_update on public.product_variants;
create policy product_variants_update on public.product_variants for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- modifier_groups
drop policy if exists modifier_groups_write on public.modifier_groups;
create policy modifier_groups_write on public.modifier_groups for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists modifier_groups_update on public.modifier_groups;
create policy modifier_groups_update on public.modifier_groups for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- modifiers
drop policy if exists modifiers_write on public.modifiers;
create policy modifiers_write on public.modifiers for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists modifiers_update on public.modifiers;
create policy modifiers_update on public.modifiers for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- staff
drop policy if exists staff_write on public.staff;
create policy staff_write on public.staff for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists staff_update on public.staff;
create policy staff_update on public.staff for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- settings
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- tax_profiles
drop policy if exists tax_profiles_write on public.tax_profiles;
create policy tax_profiles_write on public.tax_profiles for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists tax_profiles_update on public.tax_profiles;
create policy tax_profiles_update on public.tax_profiles for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- tax_rules
drop policy if exists tax_rules_write on public.tax_rules;
create policy tax_rules_write on public.tax_rules for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists tax_rules_update on public.tax_rules;
create policy tax_rules_update on public.tax_rules for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- tables
drop policy if exists tables_write on public.tables;
create policy tables_write on public.tables for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists tables_update on public.tables;
create policy tables_update on public.tables for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- stock_items
drop policy if exists stock_items_write on public.stock_items;
create policy stock_items_write on public.stock_items for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists stock_items_update on public.stock_items;
create policy stock_items_update on public.stock_items for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- stock_batches
drop policy if exists stock_batches_write on public.stock_batches;
create policy stock_batches_write on public.stock_batches for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists stock_batches_update on public.stock_batches;
create policy stock_batches_update on public.stock_batches for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- charges
drop policy if exists charges_write on public.charges;
create policy charges_write on public.charges for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists charges_update on public.charges;
create policy charges_update on public.charges for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- promotions
drop policy if exists promotions_write on public.promotions;
create policy promotions_write on public.promotions for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists promotions_update on public.promotions;
create policy promotions_update on public.promotions for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- price_lists
drop policy if exists price_lists_write on public.price_lists;
create policy price_lists_write on public.price_lists for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists price_lists_update on public.price_lists;
create policy price_lists_update on public.price_lists for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- availability_schedules
drop policy if exists availability_schedules_write on public.availability_schedules;
create policy availability_schedules_write on public.availability_schedules for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists availability_schedules_update on public.availability_schedules;
create policy availability_schedules_update on public.availability_schedules for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- qr_points
drop policy if exists qr_points_write on public.qr_points;
create policy qr_points_write on public.qr_points for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists qr_points_update on public.qr_points;
create policy qr_points_update on public.qr_points for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- stations
drop policy if exists stations_write on public.stations;
create policy stations_write on public.stations for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists stations_update on public.stations;
create policy stations_update on public.stations for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- category_stations (insert only)
drop policy if exists category_stations_write on public.category_stations;
create policy category_stations_write on public.category_stations for insert to authenticated with check (public.has_manager_access(shop_id));

-- channels
drop policy if exists channels_write on public.channels;
create policy channels_write on public.channels for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- message_templates
drop policy if exists message_templates_write on public.message_templates;
create policy message_templates_write on public.message_templates for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists message_templates_update on public.message_templates;
create policy message_templates_update on public.message_templates for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));

-- credit_accounts
drop policy if exists credit_accounts_write on public.credit_accounts;
create policy credit_accounts_write on public.credit_accounts for insert to authenticated with check (public.has_manager_access(shop_id));
drop policy if exists credit_accounts_update on public.credit_accounts;
create policy credit_accounts_update on public.credit_accounts for update to authenticated using (public.has_manager_access(shop_id)) with check (public.has_manager_access(shop_id));
