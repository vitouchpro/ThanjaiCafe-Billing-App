create table public.qr_points (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  type        text not null check (type in ('table', 'counter', 'takeaway')),
  label       text not null,
  token       text not null unique,
  active      boolean not null default true,
  rev         int not null default 1
);
create index qr_points_shop_idx on public.qr_points (shop_id);

create table public.stations (
  id      uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name    text not null,
  rev     int not null default 1
);
create index stations_shop_idx on public.stations (shop_id);

create table public.category_stations (
  shop_id     uuid not null references public.shops(id),
  category_id uuid not null references public.categories(id),
  station_id  uuid not null references public.stations(id),
  primary key (category_id, station_id)
);

create table public.qr_orders (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops(id),
  qr_point_id     uuid not null references public.qr_points(id),
  status          text not null default 'PAID' check (status in ('PAID','FIRED','ACKNOWLEDGED','PREPARING','READY','COLLECTED','SERVED','REJECTED','UNACKNOWLEDGED','EXPIRED')),
  token_label     text,
  bill_id         uuid references public.bills(id),
  receipt_token   text not null unique,
  phone           text,
  created_at      timestamptz not null default now()
);
create index qr_orders_shop_idx on public.qr_orders (shop_id);

create table public.qr_order_lines (
  id                uuid primary key default gen_random_uuid(),
  qr_order_id       uuid not null references public.qr_orders(id),
  shop_id           uuid not null references public.shops(id),
  product_id        uuid not null,
  name              text not null,
  qty               numeric(12,3) not null check (qty > 0),
  unit_price_paise  bigint not null check (unit_price_paise >= 0),
  line_total_paise  bigint not null check (line_total_paise >= 0)
);
create index qr_order_lines_order_idx on public.qr_order_lines (qr_order_id);
create index qr_order_lines_shop_idx on public.qr_order_lines (shop_id);

create table public.pending_orders (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  qr_point_id  uuid not null references public.qr_points(id),
  cart         jsonb not null,
  created_at   timestamptz not null default now()
);
create index pending_orders_shop_idx on public.pending_orders (shop_id);

create table public.kots (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id),
  qr_order_id   uuid references public.qr_orders(id),
  bill_id       uuid references public.bills(id),
  station_id    uuid not null references public.stations(id),
  fired_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_device_id uuid references public.devices(id)
);
create index kots_shop_idx on public.kots (shop_id);

create table public.order_events (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  qr_order_id  uuid not null references public.qr_orders(id),
  event        text not null,
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (qr_order_id);
create index order_events_shop_idx on public.order_events (shop_id);

create trigger order_events_append_only before update or delete on public.order_events
  for each row execute function public.forbid_mutation();

alter table public.qr_points enable row level security;
alter table public.stations enable row level security;
alter table public.category_stations enable row level security;
alter table public.qr_orders enable row level security;
alter table public.qr_order_lines enable row level security;
alter table public.pending_orders enable row level security;
alter table public.kots enable row level security;
alter table public.order_events enable row level security;

create policy qr_points_read on public.qr_points for select to authenticated using (public.has_shop_access(shop_id));
create policy qr_points_write on public.qr_points for insert to authenticated with check (public.has_shop_access(shop_id));
create policy qr_points_update on public.qr_points for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy stations_read on public.stations for select to authenticated using (public.has_shop_access(shop_id));
create policy stations_write on public.stations for insert to authenticated with check (public.has_shop_access(shop_id));
create policy stations_update on public.stations for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy category_stations_read on public.category_stations for select to authenticated using (public.has_shop_access(shop_id));
create policy category_stations_write on public.category_stations for insert to authenticated with check (public.has_shop_access(shop_id));

create policy qr_orders_read on public.qr_orders for select to authenticated using (public.has_shop_access(shop_id));
-- qr_orders is created server-side (edge function via service_role, spec 9.3); authenticated devices only read and update lifecycle status.
create policy qr_orders_update on public.qr_orders for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy qr_order_lines_read on public.qr_order_lines for select to authenticated using (public.has_shop_access(shop_id));

create policy pending_orders_read on public.pending_orders for select to authenticated using (public.has_shop_access(shop_id));

create policy kots_read on public.kots for select to authenticated using (public.has_shop_access(shop_id));
create policy kots_update on public.kots for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy order_events_read on public.order_events for select to authenticated using (public.has_shop_access(shop_id));
create policy order_events_insert on public.order_events for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.qr_points, public.stations, public.category_stations to authenticated;
grant select, update on public.qr_orders, public.kots to authenticated;
grant select on public.qr_order_lines, public.pending_orders to authenticated;
grant select, insert on public.order_events to authenticated;
grant select, insert, update, delete on public.qr_orders, public.qr_order_lines, public.pending_orders, public.kots, public.order_events to service_role;
