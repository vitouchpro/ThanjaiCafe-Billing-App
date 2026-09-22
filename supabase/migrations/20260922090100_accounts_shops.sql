create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.shops (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  name       text not null,
  timezone   text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);
create index shops_account_idx on public.shops (account_id);

alter table public.accounts enable row level security;
alter table public.shops    enable row level security;

-- Accounts and shops are managed by the owner/manager via membership rows
-- (Task 4 creates `memberships`). Until Task 4 lands there is no read
-- policy yet other than service_role; this migration only creates shape.
grant select, insert, update on public.accounts, public.shops to service_role;
