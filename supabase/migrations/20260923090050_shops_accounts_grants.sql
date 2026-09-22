-- Fixes a gap from Tasks 2/4: shops_read and accounts_read policies (added
-- in 20260922090300_memberships.sql) make these tables RLS-readable by
-- authenticated, but neither migration granted table-level SELECT to that
-- role — Postgres denies the query before RLS runs without it. Found in
-- Task 4's review.
grant select on public.shops, public.accounts to authenticated;
