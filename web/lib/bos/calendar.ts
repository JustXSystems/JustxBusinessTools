export type MonthGridCell = {
  /** Local date for the cell. */
  date: Date;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  /** `YYYY-MM-DD` key for event lookup. */
  key: string;
};

export const BOS_WEEKDAYS_MON_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Monday-first month grid padded with leading/trailing days so every row is a
 * full week (35 or 42 cells). `month` is 0-based like `Date#getMonth`.
 */
export function buildMonthGrid(year: number, month: number, today?: Date): MonthGridCell[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;
  const todayKey = today ? dateKey(today) : "";

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < total; i += 1) {
    const date = new Date(year, month, 1 - leading + i);
    const key = dateKey(date);
    cells.push({
      date,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: key === todayKey,
      key,
    });
  }
  return cells;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export { dateKey as toDateKey };
