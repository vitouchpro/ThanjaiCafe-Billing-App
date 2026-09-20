create table public.spike_webhook_log (
  id              bigint generated always as identity primary key,
  received_at     timestamptz not null default now(),
  event_id        text,
  signature_valid boolean not null,
  body            jsonb not null
);
alter table public.spike_webhook_log enable row level security;
-- No policies: only the service role (edge functions) can read or write it.
-- Explicit grant for edge functions to log webhooks.
grant select, insert on public.spike_webhook_log to service_role;
