create table public.channels (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  type        text not null check (type in ('till','qr','phone','whatsapp','swiggy','zomato','ondc','magicpin')),
  config      jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  rev         int not null default 1
);
create index channels_shop_idx on public.channels (shop_id);

create table public.channel_orders (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops(id),
  channel_id        uuid not null references public.channels(id),
  external_order_id text,
  bill_id           uuid references public.bills(id),
  commission_paise  bigint not null default 0,
  raw_payload       jsonb,
  created_at        timestamptz not null default now()
);
create index channel_orders_shop_idx on public.channel_orders (shop_id);

create table public.message_templates (
  id       uuid primary key default gen_random_uuid(),
  shop_id  uuid not null references public.shops(id),
  purpose  text not null check (purpose in ('order_ready','receipt','loyalty','birthday')),
  body     text not null,
  rev      int not null default 1
);
create index message_templates_shop_idx on public.message_templates (shop_id);

create table public.message_log (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  customer_id  uuid,
  channel      text not null check (channel in ('whatsapp','sms','push')),
  template_id  uuid references public.message_templates(id),
  status       text not null default 'queued' check (status in ('queued','sent','failed')),
  created_at   timestamptz not null default now()
);
create index message_log_shop_idx on public.message_log (shop_id);

create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  customer_id  uuid not null,
  purpose      text not null check (purpose in ('messaging','marketing','data_processing')),
  granted      boolean not null,
  created_at   timestamptz not null default now()
);
create index consents_shop_idx on public.consents (shop_id);

create trigger channel_orders_append_only before update or delete on public.channel_orders
  for each row execute function public.forbid_mutation();
create trigger message_log_append_only before update or delete on public.message_log
  for each row execute function public.forbid_mutation();
create trigger consents_append_only before update or delete on public.consents
  for each row execute function public.forbid_mutation();

alter table public.channels enable row level security;
alter table public.channel_orders enable row level security;
alter table public.message_templates enable row level security;
alter table public.message_log enable row level security;
alter table public.consents enable row level security;

create policy channels_read on public.channels for select to authenticated using (public.has_shop_access(shop_id));
create policy channels_write on public.channels for insert to authenticated with check (public.has_shop_access(shop_id));
create policy channels_update on public.channels for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy channel_orders_read on public.channel_orders for select to authenticated using (public.has_shop_access(shop_id));
create policy channel_orders_insert on public.channel_orders for insert to authenticated with check (public.has_shop_access(shop_id));

create policy message_templates_read on public.message_templates for select to authenticated using (public.has_shop_access(shop_id));
create policy message_templates_write on public.message_templates for insert to authenticated with check (public.has_shop_access(shop_id));
create policy message_templates_update on public.message_templates for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy message_log_read on public.message_log for select to authenticated using (public.has_shop_access(shop_id));
create policy message_log_insert on public.message_log for insert to authenticated with check (public.has_shop_access(shop_id));

create policy consents_read on public.consents for select to authenticated using (public.has_shop_access(shop_id));
create policy consents_insert on public.consents for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.channels, public.message_templates to authenticated;
grant select, insert on public.channel_orders, public.message_log, public.consents to authenticated;
grant select, insert, update, delete on public.channels, public.channel_orders, public.message_templates, public.message_log, public.consents to service_role;
