import { supabase } from '../../lib/supabase';
import { InvLocation, PosShift, PosTerminal, Profile } from '../../lib/types';

type ShiftRow = Record<string, unknown>;

export function mapShiftRow(raw: ShiftRow): PosShift {
  return {
    ...(raw as unknown as PosShift),
    business_date: String(raw.shift_date ?? raw.business_date ?? ''),
    shift_open_time: String(raw.opened_at ?? raw.shift_open_time ?? ''),
    shift_close_time: (raw.closed_at ?? raw.shift_close_time ?? null) as string | null,
    opening_cash: Number(raw.opening_cash ?? 0),
    expected_cash_count: raw.expected_cash != null ? Number(raw.expected_cash) : Number(raw.expected_cash_count ?? 0),
    actual_cash_count: raw.actual_cash != null ? Number(raw.actual_cash) : raw.actual_cash_count != null ? Number(raw.actual_cash_count) : null,
    cash_over_short: raw.over_short != null ? Number(raw.over_short) : raw.cash_over_short != null ? Number(raw.cash_over_short) : null,
  };
}

export async function enrichShifts(rows: ShiftRow[]): Promise<PosShift[]> {
  const shifts = rows.map(mapShiftRow);

  const terminalIds = [...new Set(shifts.map(shift => shift.terminal_id).filter(Boolean))];
  const locationIds = [...new Set(shifts.map(shift => shift.location_id).filter(Boolean))];
  const cashierIds = [...new Set(shifts.map(shift => shift.cashier_id).filter(Boolean))];

  const [terminalRes, locationRes, cashierRes] = await Promise.all([
    terminalIds.length > 0
      ? supabase.from('pos_terminals').select('*').in('terminal_id', terminalIds)
      : Promise.resolve({ data: [] as PosTerminal[] }),
    locationIds.length > 0
      ? supabase.from('inv_locations').select('*').in('id', locationIds)
      : Promise.resolve({ data: [] as InvLocation[] }),
    cashierIds.length > 0
      ? supabase.from('profiles').select('id, name').in('id', cashierIds)
      : Promise.resolve({ data: [] as Profile[] }),
  ]);

  const terminals = new Map<string, PosTerminal>(
    ((terminalRes.data ?? []) as PosTerminal[]).map(terminal => [terminal.terminal_id, terminal]),
  );
  const locations = new Map<string, InvLocation>(
    ((locationRes.data ?? []) as InvLocation[]).map(location => [location.id, location]),
  );
  const cashiers = new Map<string, Profile>(
    ((cashierRes.data ?? []) as Profile[]).map(profile => [profile.id, profile]),
  );

  return shifts.map(shift => ({
    ...shift,
    pos_terminals: terminals.get(shift.terminal_id),
    inv_locations: locations.get(shift.location_id),
    cashier: cashiers.get(shift.cashier_id),
  }));
}
