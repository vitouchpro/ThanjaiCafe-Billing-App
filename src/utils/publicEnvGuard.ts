/* Vite inlines every VITE_* variable into the JavaScript bundle served to
   anyone who opens the site. A value that authorises a privileged write is
   therefore not a secret. This guard stops a production build from shipping
   one by accident. */

export const PUBLISH_TOKEN_VAR = 'VITE_PUBLISH_TOKEN';

/** Set to "1" to knowingly ship the publish token until Phase 1 replaces it. */
export const ACK_VAR = 'ALLOW_PUBLIC_PUBLISH_TOKEN';

const SECRET_LIKE = /^VITE_.*(SECRET|SERVICE_ROLE|PRIVATE_KEY|WEBHOOK)/i;

type Env = Record<string, string | undefined>;

export function findForbiddenPublicEnv(env: Env): string[] {
  return Object.keys(env)
    .filter((key) => key === PUBLISH_TOKEN_VAR || SECRET_LIKE.test(key))
    .filter((key) => (env[key] ?? '').trim() !== '')
    .sort();
}

export interface GuardOptions {
  command: 'build' | 'serve';
  mode: string;
  acknowledged: boolean;
}

export function assertPublicEnvSafe(env: Env, opts: GuardOptions): void {
  if (opts.command !== 'build' || opts.mode !== 'production') return;

  const found = findForbiddenPublicEnv(env);
  if (found.length === 0) return;

  const hardBlocked = found.filter((key) => key !== PUBLISH_TOKEN_VAR);
  if (hardBlocked.length > 0) {
    throw new Error(
      `Refusing to build: ${hardBlocked.join(', ')} would be embedded in the public bundle. ` +
      'Secrets belong in Supabase function secrets, never in VITE_ variables.',
    );
  }

  if (opts.acknowledged) return;

  throw new Error(
    `Refusing to build: ${PUBLISH_TOKEN_VAR} would be embedded in the public bundle, where anyone ` +
    'can read it and use it to publish a menu or write bills. Remove it, or set ' +
    `${ACK_VAR}=1 to ship it knowingly until the token-based functions are replaced.`,
  );
}
