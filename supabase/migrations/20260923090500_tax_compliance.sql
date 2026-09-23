create table public.tax_profiles (
  shop_id    uuid primary key references public.shops(id),
  regime     text not null check (regime in ('regular','composition','unregistered')),
  gstin      text,
  state      text,
  fssai_no   text,
  rev        int not null default 1,
  updated_at timestamptz not null default now()
);

create table public.tax_rules (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  hsn_sac      text not null,
  order_type   text not null check (order_type in ('dine_in','takeaway','delivery','any')),
  rate_bps     int not null check (rate_bps >= 0),
  cess_bps     int not null default 0 check (cess_bps >= 0),
  valid_from   date not null,
  valid_to     date,
  rev          int not null default 1
);
create index tax_rules_shop_idx on public.tax_rules (shop_id);

create table public.credit_notes (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  device_id      uuid not null references public.devices(id),
  bill_id        uuid not null references public.bills(id),
  series         text not null check (series in ('C','WC')),
  fy             text not null,
  seq            int not null,
  amount_paise   bigint not null check (amount_paise > 0),
  reason         text not null,
  amends_bill_id uuid references public.bills(id),
  created_at     timestamptz not null default now(),
  unique (shop_id, series, fy, seq)
);
create index credit_notes_shop_idx on public.credit_notes (shop_id);

create trigger credit_notes_append_only before update or delete on public.credit_notes
  for each row execute function public.forbid_mutation();

alter table public.tax_profiles enable row level security;
alter table public.tax_rules enable row level security;
alter table public.credit_notes enable row level security;

create policy tax_profiles_read on public.tax_profiles for select to authenticated using (public.has_shop_access(shop_id));
create policy tax_profiles_write on public.tax_profiles for insert to authenticated with check (public.has_shop_access(shop_id));
create policy tax_profiles_update on public.tax_profiles for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy tax_rules_read on public.tax_rules for select to authenticated using (public.has_shop_access(shop_id));
create policy tax_rules_write on public.tax_rules for insert to authenticated with check (public.has_shop_access(shop_id));
create policy tax_rules_update on public.tax_rules for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy credit_notes_read on public.credit_notes for select to authenticated using (public.has_shop_access(shop_id));
create policy credit_notes_insert on public.credit_notes for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.bills b where b.id = credit_notes.bill_id and b.shop_id = credit_notes.shop_id)
  );

grant select, insert, update on public.tax_profiles, public.tax_rules to authenticated;
grant select, insert on public.credit_notes to authenticated;
grant select, insert, update, delete on public.tax_profiles, public.tax_rules, public.credit_notes to service_role;
