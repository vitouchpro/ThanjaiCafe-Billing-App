-- 0003 was never applied to any database: the migration it once named was
-- dropped before release. The number is reserved so history reads 0001..0005
-- without a gap and `supabase db push` has nothing to reconcile.
select 1;
