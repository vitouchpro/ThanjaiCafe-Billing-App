-- Row-level security. The anon key ships in the customer's browser, so RLS —
-- not key secrecy — is what protects the data.

alter table menu_items  enable row level security;
alter table customers   enable row level security;
alter table orders      enable row level security;
alter table order_lines enable row level security;

alter table order_tokens enable row level security;

-- order_tokens carries no policy on purpose: RLS on with zero policies denies
-- every ordinary role. The counter is touched only by next_order_token() from
-- the create-order edge function, which runs as service_role and bypasses RLS.

-- The menu is public: a diner reads it before signing in.
create policy menu_public_read on menu_items
  for select using (true);

-- A customer sees and edits only their own profile.
create policy customer_own_row on customers
  for select using (auth.uid() = id);
create policy customer_own_insert on customers
  for insert with check (auth.uid() = id);
create policy customer_own_update on customers
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- A customer reads only their own orders. They never write one directly:
-- orders are created by the create-order edge function, which prices them
-- from menu_items so a tampered client cannot underpay.
create policy order_own_read on orders
  for select using (auth.uid() = customer_id);

create policy order_line_own_read on order_lines
  for select using (
    exists (select 1 from orders o where o.id = order_lines.order_id and o.customer_id = auth.uid())
  );

-- No customer-facing update policy on orders. Status is moved only by the
-- edge functions and by staff, both of which use the service role and bypass
-- RLS entirely. This is what stops a customer marking their own order PAID.
