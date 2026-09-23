import { describe, it, expect, vi } from 'vitest';
import { assertRecentMfa, requiresRecentMfa, SENSITIVE_ACTIONS } from '../mfaGate';

describe('SENSITIVE_ACTIONS', () => {
  it('lists exactly the spec 4.1 actions', () => {
    expect(SENSITIVE_ACTIONS).toEqual(['enrol_device', 'revoke_device', 'change_plan', 'export_all_data']);
  });
});

describe('requiresRecentMfa', () => {
  it('is true for a listed action, false otherwise', () => {
    expect(requiresRecentMfa('enrol_device')).toBe(true);
    expect(requiresRecentMfa('create_bill' as never)).toBe(false);
  });
});

describe('assertRecentMfa', () => {
  it('throws when the session AAL is aal1', async () => {
    const supabase = { auth: { mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null }) } } };
    await expect(assertRecentMfa(supabase as never)).rejects.toThrow(/MFA/);
  });

  it('resolves when the session AAL is aal2', async () => {
    const supabase = { auth: { mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }) } } };
    await expect(assertRecentMfa(supabase as never)).resolves.toBeUndefined();
  });
});
