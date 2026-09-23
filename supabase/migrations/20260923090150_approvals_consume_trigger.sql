-- Fixes a gap found in Task 8's review: the approvals_consume RLS policy
-- restricted which rows were eligible for update (consumed_at is null) but
-- not what the update could change, letting any field on an unconsumed
-- approval be rewritten — defeating the point of a signed, tamper-evident
-- token. This trigger locks every column except consumed_at, and requires
-- consumed_at to actually transition from null to a real timestamp — an
-- already-consumed approval (old.consumed_at not null) can never be
-- re-stamped, not even by service_role (triggers apply to it too).
create or replace function public.approvals_only_consume() returns trigger
language plpgsql as $$
begin
  if old.shop_id is distinct from new.shop_id
     or old.action is distinct from new.action
     or old.target_id is distinct from new.target_id
     or old.manager_staff_id is distinct from new.manager_staff_id
     or old.nonce is distinct from new.nonce
     or old.signature is distinct from new.signature
     or old.expires_at is distinct from new.expires_at
     or old.created_at is distinct from new.created_at
     or old.consumed_at is not null
     or new.consumed_at is null then
    raise exception 'approvals can only be updated to set consumed_at' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists approvals_only_consume on public.approvals;
create trigger approvals_only_consume before update on public.approvals
  for each row execute function public.approvals_only_consume();
