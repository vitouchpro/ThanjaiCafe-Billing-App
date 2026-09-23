create table public.tables (
  id      uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  zone    text,
  label   text not null,
  seats   int not null default 2,
  rev     int not null default 1
);
create index tables_shop_idx on public.tables (shop_id);

create table public.tabs (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  table_id    uuid not null references public.tables(id),
  status      text not null default 'open' check (status in ('open','settled','merged','transferred')),
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);
create index tabs_shop_idx on public.tabs (shop_id);

create table public.tab_lines (
  id                uuid primary key default gen_random_uuid(),
  tab_id            uuid not null references public.tabs(id),
  shop_id           uuid not null references public.shops(id),
  event             text not null check (event in ('add','void','transfer','merge')),
  product_id        uuid,
  qty               numeric(12,3),
  unit_price_paise  bigint,
  staff_id          uuid references public.staff(id),
  created_at        timestamptz not null default now()
);
create index tab_lines_tab_idx on public.tab_lines (tab_id);
create index tab_lines_shop_idx on public.tab_lines (shop_id);

create trigger tab_lines_append_only before update or delete on public.tab_lines
  for each row execute function public.forbid_mutation();

alter table public.tables enable row level security;
alter table public.tabs enable row level security;
alter table public.tab_lines enable row level security;

create policy tables_read on public.tables for select to authenticated using (public.has_shop_access(shop_id));
create policy tables_write on public.tables for insert to authenticated with check (public.has_shop_access(shop_id));
create policy tables_update on public.tables for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy tabs_read on public.tabs for select to authenticated using (public.has_shop_access(shop_id));
create policy tabs_write on public.tabs for insert to authenticated with check (public.has_shop_access(shop_id));
create policy tabs_update on public.tabs for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy tab_lines_read on public.tab_lines for select to authenticated using (public.has_shop_access(shop_id));
create policy tab_lines_insert on public.tab_lines for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.tabs t where t.id = tab_lines.tab_id and t.shop_id = tab_lines.shop_id)
  );

grant select, insert, update on public.tables, public.tabs to authenticated;
grant select, insert on public.tab_lines to authenticated;
grant select, insert, update, delete on public.tables, public.tabs, public.tab_lines to service_role;
