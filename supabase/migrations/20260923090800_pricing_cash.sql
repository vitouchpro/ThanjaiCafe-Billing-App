create table public.charges (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  type         text not null check (type in ('service_charge','packaging','delivery','tip')),
  amount_paise bigint,
  percent_bps  int,
  taxable      boolean not null default true,
  rev          int not null default 1
);
create index charges_shop_idx on public.charges (shop_id);

create table public.promotions (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  code         text,
  type         text not null check (type in ('coupon','combo','bogo','happy_hour')),
  rules        jsonb not null,
  active       boolean not null default true,
  rev          int not null default 1
);
create index promotions_shop_idx on public.promotions (shop_id);

create table public.price_lists (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  name         text not null,
  order_type   text check (order_type in ('dine_in','takeaway','delivery','any')),
  channel      text,
  zone         text,
  rules        jsonb not null,
  rev          int not null default 1
);
create index price_lists_shop_idx on public.price_lists (shop_id);

create table public.availability_schedules (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  product_id   uuid references public.products(id),
  category_id  uuid references public.categories(id),
  days_of_week int[] not null default '{0,1,2,3,4,5,6}',
  start_time   time not null,
  end_time     time not null,
  rev          int not null default 1
);
create index availability_schedules_shop_idx on public.availability_schedules (shop_id);

create table public.shifts (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shops(id),
  device_id            uuid not null references public.devices(id),
  staff_id             uuid references public.staff(id),
  opening_float_paise  bigint not null default 0,
  closing_count_paise  bigint,
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz
);
create index shifts_shop_idx on public.shifts (shop_id);

create table public.cash_movements (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  shift_id     uuid references public.shifts(id),
  type         text not null check (type in ('paid_in','paid_out','expense','cash_drop')),
  amount_paise bigint not null check (amount_paise > 0),
  reason       text not null,
  staff_id     uuid references public.staff(id),
  created_at   timestamptz not null default now()
);
create index cash_movements_shop_idx on public.cash_movements (shop_id);

create table public.exceptions (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  type         text not null check (type in ('void_after_payment','discount_over_threshold','refund','no_sale_open','unverified_upi','deactivated_staff_bill')),
  bill_id      uuid,
  staff_id     uuid references public.staff(id),
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index exceptions_shop_idx on public.exceptions (shop_id);

create trigger cash_movements_append_only before update or delete on public.cash_movements
  for each row execute function public.forbid_mutation();
create trigger exceptions_append_only before update or delete on public.exceptions
  for each row execute function public.forbid_mutation();

alter table public.charges enable row level security;
alter table public.promotions enable row level security;
alter table public.price_lists enable row level security;
alter table public.availability_schedules enable row level security;
alter table public.shifts enable row level security;
alter table public.cash_movements enable row level security;
alter table public.exceptions enable row level security;

create policy charges_read on public.charges for select to authenticated using (public.has_shop_access(shop_id));
create policy charges_write on public.charges for insert to authenticated with check (public.has_shop_access(shop_id));
create policy charges_update on public.charges for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy promotions_read on public.promotions for select to authenticated using (public.has_shop_access(shop_id));
create policy promotions_write on public.promotions for insert to authenticated with check (public.has_shop_access(shop_id));
create policy promotions_update on public.promotions for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy price_lists_read on public.price_lists for select to authenticated using (public.has_shop_access(shop_id));
create policy price_lists_write on public.price_lists for insert to authenticated with check (public.has_shop_access(shop_id));
create policy price_lists_update on public.price_lists for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy availability_schedules_read on public.availability_schedules for select to authenticated using (public.has_shop_access(shop_id));
create policy availability_schedules_write on public.availability_schedules for insert to authenticated with check (public.has_shop_access(shop_id));
create policy availability_schedules_update on public.availability_schedules for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy shifts_read on public.shifts for select to authenticated using (public.has_shop_access(shop_id));
-- Same device-only insert rule as bills (Task 11): a shift belongs to the
-- device that opened it, never fabricated by an owner/manager session.
create policy shifts_write on public.shifts for insert to authenticated
  with check (public.has_shop_access(shop_id) and device_id = nullif((select auth.jwt()) ->> 'device_id', '')::uuid);
create policy shifts_update on public.shifts for update to authenticated using (public.has_shop_access(shop_id)) with check (public.has_shop_access(shop_id));

create policy cash_movements_read on public.cash_movements for select to authenticated using (public.has_shop_access(shop_id));
create policy cash_movements_insert on public.cash_movements for insert to authenticated with check (public.has_shop_access(shop_id));

create policy exceptions_read on public.exceptions for select to authenticated using (public.has_shop_access(shop_id));
create policy exceptions_insert on public.exceptions for insert to authenticated with check (public.has_shop_access(shop_id));

grant select, insert, update on public.charges, public.promotions, public.price_lists, public.availability_schedules, public.shifts to authenticated;
grant select, insert on public.cash_movements, public.exceptions to authenticated;
grant select, insert, update, delete on public.charges, public.promotions, public.price_lists, public.availability_schedules, public.shifts, public.cash_movements, public.exceptions to service_role;
