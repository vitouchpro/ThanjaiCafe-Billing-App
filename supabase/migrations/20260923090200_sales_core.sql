-- The append-only guard every transaction-class table in this plan reuses,
-- proven in the PowerSync spike (see the findings doc).
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'append-only table: % cannot be edited', tg_table_name using errcode = '42501';
end $$;

create table public.invoice_series (
  shop_id    uuid not null references public.shops(id),
  device_id  uuid not null references public.devices(id),
  fy         text not null,
  last_seq   int not null default 0,
  primary key (shop_id, device_id, fy)
);

create table public.bills (
  id             uuid primary key,
  shop_id        uuid not null references public.shops(id),
  device_id      uuid not null references public.devices(id),
  staff_id       uuid references public.staff(id),
  invoice_no     text not null,
  fy             text not null,
  seq            int  not null,
  source         text not null default 'till' check (source in ('till', 'qr')),
  business_date  date not null,
  payment_method text not null,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise      bigint not null default 0 check (tax_paise >= 0),
  total_paise    bigint not null check (total_paise >= 0),
  created_at     timestamptz not null,
  received_at    timestamptz not null default now(),
  unique (shop_id, device_id, fy, seq)
);
create index bills_shop_created_idx on public.bills (shop_id, created_at desc);
create index bills_shop_date_idx on public.bills (shop_id, business_date);

create table public.bill_lines (
  id                uuid primary key,
  bill_id           uuid not null references public.bills(id),
  shop_id           uuid not null references public.shops(id),
  product_id        uuid not null,
  name              text not null,
  qty               numeric(12,3) not null check (qty > 0),
  unit              text not null,
  unit_price_paise  bigint not null check (unit_price_paise >= 0),
  tax_rule_snapshot jsonb,
  line_total_paise  bigint not null check (line_total_paise >= 0)
);
create index bill_lines_bill_idx on public.bill_lines (bill_id);
create index bill_lines_shop_idx on public.bill_lines (shop_id);

create table public.bill_payments (
  id                  uuid primary key default gen_random_uuid(),
  bill_id             uuid not null references public.bills(id),
  shop_id             uuid not null references public.shops(id),
  method              text not null check (method in ('cash','upi','card','credit')),
  verification        text not null default 'manual' check (verification in ('verified','manual','offline_unverified')),
  gateway_payment_id  text,
  amount_paise        bigint not null check (amount_paise > 0),
  created_at          timestamptz not null default now()
);
create index bill_payments_bill_idx on public.bill_payments (bill_id);
create index bill_payments_shop_idx on public.bill_payments (shop_id);

create table public.bill_events (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.bills(id),
  shop_id       uuid not null references public.shops(id),
  type          text not null check (type in ('void','refund','partial_refund')),
  amount_paise  bigint,
  reason        text,
  staff_id      uuid references public.staff(id),
  approval_id   uuid references public.approvals(id),
  created_at    timestamptz not null default now()
);
create index bill_events_bill_idx on public.bill_events (bill_id);
create index bill_events_shop_idx on public.bill_events (shop_id);

create table public.day_closes (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null references public.shops(id),
  device_id             uuid not null references public.devices(id),
  business_date         date not null,
  opening_float_paise   bigint not null default 0,
  closing_count_paise   bigint,
  closed_by_staff_id    uuid references public.staff(id),
  closed_at             timestamptz not null default now(),
  unique (shop_id, device_id, business_date)
);
create index day_closes_shop_idx on public.day_closes (shop_id);

create trigger bills_append_only before update or delete on public.bills
  for each row execute function public.forbid_mutation();
create trigger bill_lines_append_only before update or delete on public.bill_lines
  for each row execute function public.forbid_mutation();
create trigger bill_payments_append_only before update or delete on public.bill_payments
  for each row execute function public.forbid_mutation();
create trigger bill_events_append_only before update or delete on public.bill_events
  for each row execute function public.forbid_mutation();
create trigger day_closes_append_only before update or delete on public.day_closes
  for each row execute function public.forbid_mutation();

alter table public.invoice_series enable row level security;
alter table public.bills enable row level security;
alter table public.bill_lines enable row level security;
alter table public.bill_payments enable row level security;
alter table public.bill_events enable row level security;
alter table public.day_closes enable row level security;

create policy invoice_series_read on public.invoice_series for select to authenticated using (public.has_shop_access(shop_id));

create policy bills_read on public.bills for select to authenticated using (public.has_shop_access(shop_id));
-- Bills are created only by a device session acting as itself — never by an
-- owner/manager session, which has no till context to bill from (spec: every
-- write records staff_id and device_id; corrections go through bill_events /
-- credit_notes, never a direct bill insert by an admin session).
create policy bills_insert on public.bills for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and device_id = nullif((select auth.jwt()) ->> 'device_id', '')::uuid
  );

create policy bill_lines_read on public.bill_lines for select to authenticated using (public.has_shop_access(shop_id));
create policy bill_lines_insert on public.bill_lines for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.bills b where b.id = bill_lines.bill_id and b.shop_id = bill_lines.shop_id)
  );

create policy bill_payments_read on public.bill_payments for select to authenticated using (public.has_shop_access(shop_id));
create policy bill_payments_insert on public.bill_payments for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.bills b where b.id = bill_payments.bill_id and b.shop_id = bill_payments.shop_id)
  );

create policy bill_events_read on public.bill_events for select to authenticated using (public.has_shop_access(shop_id));
create policy bill_events_insert on public.bill_events for insert to authenticated
  with check (
    public.has_shop_access(shop_id)
    and exists (select 1 from public.bills b where b.id = bill_events.bill_id and b.shop_id = bill_events.shop_id)
  );

create policy day_closes_read on public.day_closes for select to authenticated using (public.has_shop_access(shop_id));
-- Same device-only insert rule as bills (Task 11): a day close is that
-- device's own drawer close, never fabricated by an owner/manager session.
create policy day_closes_insert on public.day_closes for insert to authenticated
  with check (public.has_shop_access(shop_id) and device_id = nullif((select auth.jwt()) ->> 'device_id', '')::uuid);

grant select on public.bills, public.bill_lines, public.bill_payments, public.bill_events, public.day_closes, public.invoice_series to authenticated;
grant insert on public.bills, public.bill_lines, public.bill_payments, public.bill_events, public.day_closes to authenticated;
grant select, insert, update, delete on public.bills, public.bill_lines, public.bill_payments, public.bill_events, public.day_closes, public.invoice_series to service_role;
