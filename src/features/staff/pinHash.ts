const ITERATIONS = 210_000; // OWASP 2023 minimum for PBKDF2-SHA256

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  return derive(pin, salt);
}

export async function verifyPin(pin: string, salt: Uint8Array, hash: string): Promise<boolean> {
  const candidate = await derive(pin, salt);
  // Constant-time-ish comparison; both strings are fixed-length base64 of a 256-bit digest.
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
