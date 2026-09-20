/* CORS for the anonymous, browser-called edge functions.

   An allow-list stops other websites from driving a diner's browser at these
   endpoints. It is NOT authentication: any non-browser client can send any
   Origin header it likes, so rate limiting is the real defence. */

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';

export interface CorsDecision {
  headers: Record<string, string>;
  allowed: boolean;
}

export function parseAllowedOrigins(csv: string | undefined): string[] {
  return (csv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function buildCorsHeaders(origin: string | null, allowedCsv: string | undefined): CorsDecision {
  const base = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const allowList = parseAllowedOrigins(allowedCsv);

  // Not configured: keep the historical open behaviour.
  if (allowList.length === 0) {
    return { headers: { ...base, 'Access-Control-Allow-Origin': '*' }, allowed: true };
  }
  if (origin && allowList.includes(origin)) {
    return { headers: { ...base, 'Access-Control-Allow-Origin': origin }, allowed: true };
  }
  return { headers: base, allowed: false };
}
