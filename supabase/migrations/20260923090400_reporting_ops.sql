create table public.shop_daily_stats (
  shop_id        uuid not null references public.shops(id),
  business_date  date not null,
  bill_count     int not null default 0,
  gross_paise    bigint not null default 0,
  tax_paise      bigint not null default 0,
  computed_at    timestamptz not null default now(),
  primary key (shop_id, business_date)
);

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  actor_type  text not null check (actor_type in ('owner','manager','device','system')),
  actor_id    uuid,
  action      text not null,
  target_id   uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_shop_idx on public.audit_log (shop_id, created_at desc);

create table public.sync_errors (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid references public.shops(id),
  device_id   uuid references public.devices(id),
  message     text not null,
  stack       text,
  context     jsonb,
  created_at  timestamptz not null default now()
);
create index sync_errors_shop_idx on public.sync_errors (shop_id);

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();
create trigger sync_errors_append_only before update or delete on public.sync_errors
  for each row execute function public.forbid_mutation();

alter table public.shop_daily_stats enable row level security;
alter table public.audit_log enable row level security;
alter table public.sync_errors enable row level security;

create policy shop_daily_stats_read on public.shop_daily_stats for select to authenticated using (public.has_shop_access(shop_id));
create policy audit_log_read on public.audit_log for select to authenticated using (public.has_shop_access(shop_id));
create policy sync_errors_read on public.sync_errors for select to authenticated using (shop_id is not null and public.has_shop_access(shop_id));
create policy sync_errors_insert on public.sync_errors for insert to authenticated with check (shop_id is null or public.has_shop_access(shop_id));

grant select on public.shop_daily_stats, public.audit_log to authenticated;
grant select, insert on public.sync_errors to authenticated;
grant select, insert, update on public.shop_daily_stats to service_role;
grant select, insert on public.audit_log, public.sync_errors to service_role;
