create table public.settings (
  shop_id           uuid primary key references public.shops(id),
  day_cutover_hour  int not null default 0 check (day_cutover_hour between 0 and 23),
  receipt_language  text not null default 'en' check (receipt_language in ('en', 'ta')),
  rev               int not null default 1,
  updated_at        timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy settings_read on public.settings for select to authenticated
  using (public.has_shop_access(shop_id));
create policy settings_write on public.settings for insert to authenticated
  with check (public.has_shop_access(shop_id));
create policy settings_update on public.settings for update to authenticated
  using (public.has_shop_access(shop_id))
  with check (public.has_shop_access(shop_id));

grant select, insert, update on public.settings to authenticated;
