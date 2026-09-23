-- Fixes a design gap found in the final whole-branch review: message_log
-- had a forbid_mutation() append-only trigger, but its own status column
-- is meant to transition queued -> sent/failed -- which the trigger made
-- permanently impossible (triggers apply to service_role too). Drop the
-- trigger; add a narrow update policy allowing only the status column to
-- change, mirroring the pattern used for approvals.consumed_at.
--
-- NOTE: message_log_append_only covered `update or delete`; the replacement
-- trigger below is `before update` only. authenticated has no delete grant
-- and no delete policy on message_log, so this widens deletes for
-- service_role only.
drop trigger if exists message_log_append_only on public.message_log;
drop function if exists public.message_log_append_only_guard();

create or replace function public.message_log_only_status() returns trigger
language plpgsql as $$
begin
  if old.shop_id is distinct from new.shop_id
     or old.customer_id is distinct from new.customer_id
     or old.channel is distinct from new.channel
     or old.template_id is distinct from new.template_id
     or old.created_at is distinct from new.created_at then
    raise exception 'message_log rows can only have their status updated' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists message_log_only_status on public.message_log;
create trigger message_log_only_status before update on public.message_log
  for each row execute function public.message_log_only_status();

drop policy if exists message_log_update on public.message_log;
create policy message_log_update on public.message_log for update to authenticated
  using (public.has_shop_access(shop_id))
  with check (public.has_shop_access(shop_id));

grant update on public.message_log to authenticated;
grant update on public.message_log to service_role;
