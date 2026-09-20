-- Fixed-window rate limiter for anonymous edge functions.
create table if not exists public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;
-- No policies: deny-all for anon and authenticated. service_role bypasses RLS.
revoke all on table public.rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.rate_limits to service_role;

create or replace function public.bump_rate_limit(p_key text, p_window_seconds int)
returns int
language plpgsql
as $$
declare
  v_window timestamptz;
  v_count  int;
begin
  if p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'window out of range';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  -- Cheap housekeeping on about 1% of calls; nothing reads old windows.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count;
end;
$$;

revoke all on function public.bump_rate_limit(text, int) from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text, int) to service_role;
