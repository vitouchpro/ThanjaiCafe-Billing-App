-- supabase/migrations/20260923091200_execute_readonly_sql.sql
-- Used only by the CI agreement test (Task 22) to compare a Sync Stream's
-- literal query against RLS-scoped access. Restricted to service_role and
-- to statements starting with "select" (case-insensitive) to prevent
-- misuse if this function is ever called from a wider context by mistake.
--
-- Returns `table(id text)`, not `setof record`: PostgREST cannot call a
-- record-returning function without an explicit column definition list
-- ("a column definition list is required for functions returning record").
-- The agreement test only ever needs an identity set, so every caller
-- projects exactly one text column aliased `id` (see the IDENTITY_COLUMNS
-- map in supabase/tests/agreement/sync-rls-agreement.mjs for tables whose
-- primary key is not a single `id` column).
-- `create or replace` cannot change an existing function's return type, and
-- an earlier revision of this file already shipped the `setof record`
-- version, so drop first to make re-application idempotent.
drop function if exists public.execute_readonly_sql(text);

create or replace function public.execute_readonly_sql(query text)
returns table(id text)
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
