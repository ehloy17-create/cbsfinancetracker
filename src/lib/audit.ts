import { supabase } from './supabase';

export async function writeAuditLog(
  userId: string | null,
  action: string,
  module: string,
  recordId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      const { data } = await supabase.auth.getSession();
      resolvedUserId = data?.session?.user?.id ?? null;
    }

    await supabase.from('audit_logs').insert({
      user_id: resolvedUserId,
      action,
      module,
      record_id: recordId || '',
      details: details || {},
      created_at: new Date().toISOString(),
    });
  } catch {
    // Silently fail audit logging to not block main operations
  }
}
