-- Phase 1 foundation: confirm required extensions. pgcrypto already used by
-- the spike schema (gen_random_uuid()); pg_cron availability on the free
-- tier is recorded in the findings doc, not assumed here.
create extension if not exists pgcrypto;
