create table public.plans (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  name                 text not null,
  device_limit         int not null,
  staff_limit          int not null,
  qr_ordering          boolean not null default false,
  history_window_days  int not null default 90,
  price_paise          bigint not null,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy plans_read on public.plans for select to authenticated using (true);
grant select on public.plans to authenticated;
grant select, insert, update on public.plans to service_role;

create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  shop_id                   uuid not null references public.shops(id),
  plan_id                   uuid not null references public.plans(id),
  razorpay_subscription_id  text unique,
  status                    text not null default 'trialing' check (status in ('trialing','active','past_due','suspended','cancelled')),
  current_period_end        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index subscriptions_shop_idx on public.subscriptions (shop_id);
alter table public.subscriptions enable row level security;
create policy subscriptions_read on public.subscriptions for select to authenticated using (public.has_shop_access(shop_id));
grant select on public.subscriptions to authenticated;
grant select, insert, update on public.subscriptions to service_role;

create table public.entitlements (
  shop_id              uuid primary key references public.shops(id),
  device_limit         int not null,
  staff_limit          int not null,
  qr_ordering          boolean not null default false,
  history_window_days  int not null default 90,
  updated_at           timestamptz not null default now()
);
alter table public.entitlements enable row level security;
create policy entitlements_read on public.entitlements for select to authenticated using (public.has_shop_access(shop_id));
grant select on public.entitlements to authenticated;
grant select, insert, update on public.entitlements to service_role;

create table public.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'razorpay',
  event_id      text not null,
  event_type    text not null,
  payload       jsonb not null,
  processed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (provider, event_id)
);
alter table public.webhook_events enable row level security;
grant select, insert, update on public.webhook_events to service_role;

create table public.payment_events (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid references public.shops(id),
  gateway_payment_id  text not null unique,
  amount_paise        bigint not null,
  status              text not null,
  raw_payload         jsonb not null,
  created_at          timestamptz not null default now()
);
create index payment_events_shop_idx on public.payment_events (shop_id);
alter table public.payment_events enable row level security;
create policy payment_events_read on public.payment_events for select to authenticated using (shop_id is not null and public.has_shop_access(shop_id));
grant select on public.payment_events to authenticated;
grant select, insert, update on public.payment_events to service_role;
