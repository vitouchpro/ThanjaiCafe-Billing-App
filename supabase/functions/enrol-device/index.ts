// supabase/functions/enrol-device/index.ts
// Called by an authenticated owner/manager to create a new device identity.
// Authorization (membership check) is completed in Task 4; until then this
// function trusts any authenticated caller, which is why Task 4 must land
// before this function is deployed to a public URL (mirrors the Phase 0
// rule for publish-menu/backup-bills).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const { headers: cors, allowed } = buildCorsHeaders(
    req.headers.get('origin'),
    Deno.env.get('ALLOWED_ORIGINS'),
  );

  if (req.method === 'OPTIONS') {
    return new Response(allowed ? 'ok' : 'forbidden', { status: allowed ? 200 : 403, headers: cors });
  }
  if (!allowed) return json({ error: 'This origin is not allowed.' }, 403, cors);

  const authHeader = req.headers.get('Authorization') ?? '';
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await anon.auth.getUser();
  if (userErr || !user) {
    return json({ error: 'unauthenticated' }, 401, cors);
  }

  const { shopId, code, role } = await req.json();
  if (!shopId || !/^[A-Z0-9]{1,4}$/.test(code) || !['till', 'kitchen', 'display', 'backoffice'].includes(role)) {
    return json({ error: 'invalid input' }, 400, cors);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const password = crypto.randomUUID() + crypto.randomUUID();
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email: `device-${crypto.randomUUID()}@devices.internal`,
    password,
    email_confirm: true,
  });
  if (createErr) return json({ error: createErr.message }, 500, cors);

  const { data: device, error: devErr } = await admin.from('devices')
    .insert({ shop_id: shopId, auth_user_id: newUser.user.id, code, role })
    .select()
    .single();
  if (devErr) return json({ error: devErr.message }, 500, cors);

  // The enrolling owner scans/copies this pairing payload onto the device once;
  // it is never stored server-side beyond the auth user's own credential store.
  return json({ deviceId: device.id, email: newUser.user.email, password }, 200, cors);
});

const json = (
  body: unknown,
  status: number,
  cors: Record<string, string>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
