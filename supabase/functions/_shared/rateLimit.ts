/* Helpers for the fixed-window limiter in Postgres (public.bump_rate_limit).
   The counter lives in the database so it holds across edge-function instances. */

export const CREATE_ORDER_LIMITS = {
  perIpPerTable: { max: 10, windowSeconds: 60 },
  perTable: { max: 60, windowSeconds: 60 },
} as const;

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

export function rateLimitKey(scope: string, ...parts: string[]): string {
  const clean = parts.map((p) => p.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 64));
  return [scope, ...clean].join(':');
}

export function isOverLimit(count: number, max: number): boolean {
  return Number.isFinite(count) && count > max;
}
