import type { SupabaseClient } from '@supabase/supabase-js';

export const SENSITIVE_ACTIONS = ['enrol_device', 'revoke_device', 'change_plan', 'export_all_data'] as const;
export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];

export function requiresRecentMfa(action: string): action is SensitiveAction {
  return (SENSITIVE_ACTIONS as readonly string[]).includes(action);
}

/** Throws if the current session has not completed AAL2 (TOTP) verification.
    Supabase's own AAL tracking is session-scoped, not time-scoped, so "recent"
    here means "this session ever completed AAL2" — a fresh re-verification
    prompt on each sensitive action is a UI decision, not enforced here. */
export async function assertRecentMfa(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data.currentLevel !== 'aal2') {
    throw new Error('This action requires MFA verification. Please complete your authenticator check.');
  }
}
