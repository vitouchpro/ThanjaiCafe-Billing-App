import { describe, it, expect } from 'vitest';
import { buildCorsHeaders, parseAllowedOrigins } from '../cors.ts';

describe('parseAllowedOrigins', () => {
  it('trims entries and drops empties', () => {
    expect(parseAllowedOrigins(' https://a.app , ,http://localhost:5173 ')).toEqual(['https://a.app', 'http://localhost:5173']);
  });
  it('treats undefined as no list', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('buildCorsHeaders', () => {
  it('stays open when no allow-list is configured, so a missing secret never stops ordering', () => {
    for (const csv of [undefined, '', '  ']) {
      const r = buildCorsHeaders('https://anything.example', csv);
      expect(r.allowed).toBe(true);
      expect(r.headers['Access-Control-Allow-Origin']).toBe('*');
    }
  });

  it('echoes an allowed origin exactly', () => {
    const r = buildCorsHeaders('https://cafe.app', 'https://cafe.app,http://localhost:5173');
    expect(r.allowed).toBe(true);
    expect(r.headers['Access-Control-Allow-Origin']).toBe('https://cafe.app');
  });

  it('rejects an origin that is not on the list', () => {
    const r = buildCorsHeaders('https://evil.example', 'https://cafe.app');
    expect(r.allowed).toBe(false);
    expect(r.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('rejects a missing Origin when a list is configured', () => {
    expect(buildCorsHeaders(null, 'https://cafe.app').allowed).toBe(false);
  });

  it('always sends Vary and the headers supabase-js needs', () => {
    const r = buildCorsHeaders('https://cafe.app', 'https://cafe.app');
    expect(r.headers['Vary']).toBe('Origin');
    expect(r.headers['Access-Control-Allow-Headers']).toContain('apikey');
    expect(r.headers['Access-Control-Allow-Headers']).toContain('x-client-info');
  });
});
