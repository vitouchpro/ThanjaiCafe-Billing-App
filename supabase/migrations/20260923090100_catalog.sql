create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  name        text not null,
  sort_order  int not null default 0,
  rev         int not null default 1,
  deleted_at  timestamptz
);
create index categories_shop_idx on public.categories (shop_id);

create table public.products (
  id           uuid primary key,
  shop_id      uuid not null references public.shops(id),
  category_id  uuid references public.categories(id),
  name         text not null,
  unit         text not null default 'pcs',
  price_paise  bigint not null check (price_paise >= 0),
  hsn_sac      text,
  tax_class    text,
  rev          int not null default 1,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index products_shop_idx on public.products (shop_id);

create table public.product_costs (
  product_id  uuid primary key references public.products(id),
  shop_id     uuid not null references public.shops(id),
  cost_paise  bigint not null check (cost_paise >= 0),
  rev         int not null default 1,
  updated_at  timestamptz not null default now()
);
create index product_costs_shop_idx on public.product_costs (shop_id);

create table public.menu_publications (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id),
  published_at  timestamptz not null default now(),
  snapshot      jsonb not null
);
create index menu_publications_shop_idx on public.menu_publications (shop_id);

create table public.product_variants (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id),
  product_id         uuid not null references public.products(id),
  name               text not null,
  price_delta_paise  bigint not null default 0,
  rev                int not null default 1
);
create index product_variants_shop_idx on public.product_variants (shop_id);

create table public.modifier_groups (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  product_id  uuid not null references public.products(id),
  name        text not null,
  min_select  int not null default 0,
  max_select  int not null default 1,
  rev         int not null default 1
);
create index modifier_groups_shop_idx on public.modifier_groups (shop_id);

create table public.modifiers (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id),
  group_id           uuid not null references public.modifier_groups(id),
  name               text not null,
  price_delta_paise  bigint not null default 0,
  rev                int not null default 1
);
create index modifiers_shop_idx on public.modifiers (shop_id);

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.menu_publications enable row level security;
alter table public.product_variants enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifiers enable row level security;

create policy categories_read on public.categories for select to authenticated using (public.has_shop_access(shop_id));
create policy categories_write on public.categories for insert to authenticated with check (public.has_shop_access(shop_id));
create policy categories_update on public.categories for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy products_read on public.products for select to authenticated using (public.has_shop_access(shop_id));
create policy products_write on public.products for insert to authenticated with check (public.has_shop_access(shop_id));
create policy products_update on public.products for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy product_costs_read on public.product_costs for select to authenticated using (public.has_shop_access(shop_id));
create policy product_costs_write on public.product_costs for insert to authenticated with check (public.has_shop_access(shop_id));
create policy product_costs_update on public.product_costs for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy menu_publications_read on public.menu_publications for select to authenticated using (public.has_shop_access(shop_id));
create policy menu_publications_write on public.menu_publications for insert to authenticated with check (public.has_shop_access(shop_id));

create policy product_variants_read on public.product_variants for select to authenticated using (public.has_shop_access(shop_id));
create policy product_variants_write on public.product_variants for insert to authenticated with check (public.has_shop_access(shop_id));
create policy product_variants_update on public.product_variants for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy modifier_groups_read on public.modifier_groups for select to authenticated using (public.has_shop_access(shop_id));
create policy modifier_groups_write on public.modifier_groups for insert to authenticated with check (public.has_shop_access(shop_id));
create policy modifier_groups_update on public.modifier_groups for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy modifiers_read on public.modifiers for select to authenticated using (public.has_shop_access(shop_id));
create policy modifiers_write on public.modifiers for insert to authenticated with check (public.has_shop_access(shop_id));
create policy modifiers_update on public.modifiers for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

grant select, insert, update on public.categories, public.products, public.product_costs, public.menu_publications, public.product_variants, public.modifier_groups, public.modifiers to authenticated;
