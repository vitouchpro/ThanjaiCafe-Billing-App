# Supabase setup

Project ref `hiwufsjnhfrzevjvfefp` — <https://hiwufsjnhfrzevjvfefp.supabase.co>

## Applying migrations

Either paste each file, in order, into **SQL Editor** in the dashboard, or link
the CLI and push:

```bash
npx supabase login
npx supabase link --project-ref hiwufsjnhfrzevjvfefp
npx supabase db push
```

## Secrets the edge functions need

Set these once. They are never committed and never reach the browser:

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx
npx supabase secrets set RAZORPAY_KEY_SECRET=xxx
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxx
```

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
