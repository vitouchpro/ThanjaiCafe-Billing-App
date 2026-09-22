-- supabase/migrations/20260923091200_execute_readonly_sql.sql
-- Used only by the CI agreement test (Task 22) to compare a Sync Stream's
-- literal query against RLS-scoped access. Restricted to service_role and
-- to statements starting with "select" (case-insensitive) to prevent
-- misuse if this function is ever called from a wider context by mistake.
create or replace function public.execute_readonly_sql(query text)
returns setof record
language plpgsql
security definer
set search_path = public
as $$
begin
  if left(trim(lower(query)), 6) <> 'select' then
    raise exception 'execute_readonly_sql only accepts SELECT statements';
  end if;
  return query execute query;
end;
$$;

revoke all on function public.execute_readonly_sql from public, anon, authenticated;
grant execute on function public.execute_readonly_sql to service_role;
