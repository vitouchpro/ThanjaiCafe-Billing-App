# Supabase setup

Project ref `hiwufsjnhfrzevjvfefp` — <https://hiwufsjnhfrzevjvfefp.supabase.co>

## Applying migrations

Migrations are code. Never paste SQL into the dashboard to change the schema.

First time on a machine:

```bash
npx supabase login
npx supabase link --project-ref hiwufsjnhfrzevjvfefp
```

Then, for each change:

```bash
npx supabase migration new <name>   # creates supabase/migrations/<timestamp>_<name>.sql
npx supabase db push --dry-run      # preview
npx supabase db push                # apply
```

Every migration enables RLS on its tables and includes explicit GRANTs.

### First push after adopting migrations-as-code

The live database's migration history predates the CLI. Before the first `db push`, the
owner must mark what already exists as applied:

```bash
npx supabase migration repair --status applied 0001 0002 0003
```

Add `0004` and/or `0005` only if `npx supabase migration list --linked` and the tables show
them already applied. This is needed because `0003_reserved.sql` sorts before the
already-applied `0004`/`0005`, so a plain push would refuse. Then run
`npx supabase db push --dry-run` to confirm the remote is "up to date" before pushing.

## Public environment variables

Every `VITE_*` value is public. `npm run build` refuses to ship `VITE_PUBLISH_TOKEN` or any
secret-looking `VITE_` value unless `ALLOW_PUBLIC_PUBLISH_TOKEN=1` is set (token only).

## Secrets the edge functions need

Set these once. They are never committed and never reach the browser:

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx
npx supabase secrets set RAZORPAY_KEY_SECRET=xxx
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxx
npx supabase secrets set ALLOWED_ORIGINS="https://your-site.example,http://localhost:5173"
```

`ALLOWED_ORIGINS` is a comma-separated list of exact origins (scheme + host, no trailing
slash) allowed to call `create-order`. If it is unset, the function stays open to any origin.

## Google sign-in

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web).
2. Authorised redirect URI: `https://hiwufsjnhfrzevjvfefp.supabase.co/auth/v1/callback`
3. Supabase dashboard → Authentication → Providers → Google → paste the client
   ID and secret.

## Razorpay webhook

Dashboard → Settings → Webhooks → add:

- URL: `https://hiwufsjnhfrzevjvfefp.supabase.co/functions/v1/verify-payment`
- Active events: `payment.captured`, `payment.failed`
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET` above.
