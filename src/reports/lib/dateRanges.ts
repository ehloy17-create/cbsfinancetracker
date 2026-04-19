export function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftDate(value: string, days: number): string {
  const next = new Date(`${value}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

export function getDefaultDateRange(daysBack: number): { from: string; to: string } {
  const to = getTodayDate();
  return {
    from: shiftDate(to, -Math.max(0, daysBack)),
    to,
  };
}
