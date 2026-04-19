import { supabase } from './supabase';

export const POS_ALLOW_NEGATIVE_QTY_KEY = 'pos_allow_negative_qty';
export const POS_SENIOR_DISCOUNT_KEY = 'pos_senior_discount_enabled';

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

export async function getSystemStateValue(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('system_state')
    .select('setting_key, value')
    .eq('setting_key', key)
    .maybeSingle();

  if (error) throw new Error(error.message || `Failed to load setting "${key}"`);

  if (!data) return null;
  return String((data as Record<string, unknown>).value ?? '');
}

export async function setSystemStateValue(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('system_state')
    .select('setting_key')
    .eq('setting_key', key)
    .maybeSingle();

  if (error) throw new Error(error.message || `Failed to load setting "${key}"`);

  if (data) {
    const { error: updateError } = await supabase
      .from('system_state')
      .update({ value, updated_at: now })
      .eq('setting_key', key);

    if (updateError) throw new Error(updateError.message || `Failed to save setting "${key}"`);
    return;
  }

  const { error: insertError } = await supabase
    .from('system_state')
    .insert({
      setting_key: key,
      value,
      updated_at: now,
    });

  if (insertError) throw new Error(insertError.message || `Failed to save setting "${key}"`);
}

export async function getBooleanSystemState(key: string, fallback = false): Promise<boolean> {
  const value = await getSystemStateValue(key);
  return normalizeBoolean(value, fallback);
}

export async function setBooleanSystemState(key: string, value: boolean): Promise<void> {
  await setSystemStateValue(key, value ? 'true' : 'false');
}
