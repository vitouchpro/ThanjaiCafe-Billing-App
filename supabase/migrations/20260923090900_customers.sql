create table public.customers (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  phone        text not null,
  name         text,
  consent      jsonb not null default '{}'::jsonb,
  rev          int not null default 1,
  created_at   timestamptz not null default now(),
  unique (shop_id, phone)
);
create index customers_shop_idx on public.customers (shop_id);

create table public.loyalty_ledger (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id),
  customer_id   uuid not null references public.customers(id),
  bill_id       uuid references public.bills(id),
  points_delta  int not null,
  reason        text not null check (reason in ('earn','redeem')),
  created_at    timestamptz not null default now()
);
create index loyalty_ledger_customer_idx on public.loyalty_ledger (customer_id);
create index loyalty_ledger_shop_idx on public.loyalty_ledger (shop_id);

create table public.credit_accounts (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id),
  customer_id   uuid not null references public.customers(id),
  limit_paise   bigint not null default 0,
  rev           int not null default 1,
  unique (shop_id, customer_id)
);
create index credit_accounts_shop_idx on public.credit_accounts (shop_id);

create table public.credit_ledger (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id),
  credit_account_id  uuid not null references public.credit_accounts(id),
  bill_id            uuid references public.bills(id),
  amount_paise       bigint not null,
  type               text not null check (type in ('charge','payment')),
  created_at         timestamptz not null default now()
);
create index credit_ledger_account_idx on public.credit_ledger (credit_account_id);
create index credit_ledger_shop_idx on public.credit_ledger (shop_id);

create trigger loyalty_ledger_append_only before update or delete on public.loyalty_ledger
  for each row execute function public.forbid_mutation();
create trigger credit_ledger_append_only before update or delete on public.credit_ledger
  for each row execute function public.forbid_mutation();

alter table public.customers enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;

create policy customers_read on public.customers for select to authenticated using (public.has_shop_access(shop_id));
create policy customers_write on public.customers for insert to authenticated with check (public.has_shop_access(shop_id));
create policy customers_update on public.customers for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy loyalty_ledger_read on public.loyalty_ledger for select to authenticated using (public.has_shop_access(shop_id));
create policy loyalty_ledger_insert on public.loyalty_ledger for insert to authenticated with check (public.has_shop_access(shop_id));

create policy credit_accounts_read on public.credit_accounts for select to authenticated using (public.has_shop_access(shop_id));
create policy credit_accounts_write on public.credit_accounts for insert to authenticated with check (public.has_shop_access(shop_id));
create policy credit_accounts_update on public.credit_accounts for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy credit_ledger_read on public.credit_ledger for select to authenticated using (public.has_shop_access(shop_id));
create policy credit_ledger_insert on public.credit_ledger for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.customers, public.credit_accounts to authenticated;
grant select, insert on public.loyalty_ledger, public.credit_ledger to authenticated;
grant select, insert, update, delete on public.customers, public.loyalty_ledger, public.credit_accounts, public.credit_ledger to service_role;
