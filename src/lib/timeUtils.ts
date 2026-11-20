export type TimeUnit = "MINUTES" | "HOURS" | "DAYS";

export const UNIT_MS: Record<TimeUnit, number> = {
  MINUTES: 60 * 1000,
  HOURS: 60 * 60 * 1000,
  DAYS: 24 * 60 * 60 * 1000,
};

export function getUnitLabel(unit: TimeUnit, amount?: number): string {
  const isSingular = amount !== undefined && Math.abs(Math.round(amount * 100) / 100) === 1;
  switch (unit) {
    case "MINUTES":
      return isSingular ? "minuto" : "minutos";
    case "HOURS":
      return isSingular ? "hora" : "horas";
    case "DAYS":
      return isSingular ? "día" : "días";
  }
}

export function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatNumberEs(value: number): string {
  const rounded = roundToTwoDecimals(value);
  if (Number.isInteger(rounded)) {
    return rounded.toString();
  }
  return rounded
    .toFixed(2)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}

export function formatDurationWithUnit(amount: number, unit: TimeUnit): string {
  const rounded = roundToTwoDecimals(amount);
  return `${formatNumberEs(rounded)} ${getUnitLabel(unit, rounded)}`;
}

export function formatTotalDurationMs(totalMs: number): string {
  if (totalMs <= 0) {
    return "0 horas";
  }

  const twentyFourHoursMs = 24 * UNIT_MS.HOURS;

  if (totalMs <= twentyFourHoursMs) {
    const hours = roundToTwoDecimals(totalMs / UNIT_MS.HOURS);
    return `${formatNumberEs(hours)} ${getUnitLabel("HOURS", hours)}`;
  }

  const totalMinutes = Math.round(totalMs / UNIT_MS.MINUTES);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remMinutesAfterDays = totalMinutes % (24 * 60);
  const hours = Math.floor(remMinutesAfterDays / 60);
  const minutes = remMinutesAfterDays % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} ${days === 1 ? "día" : "días"}`);
  }
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hora" : "horas"}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minuto" : "minutos"}`);
  }

  return parts.length > 0 ? parts.join(", ") : "0 horas";
}

export function calculateEstimatedEndDate(
  startDate: Date,
  estimatedAmount: number,
  estimatedUnit: TimeUnit
): Date {
  const msToAdd = estimatedAmount * UNIT_MS[estimatedUnit];
  return new Date(startDate.getTime() + msToAdd);
}

export interface TimeComparison {
  estimatedAmount: number;
  actualAmount: number;
  differenceAmount: number;
  unit: TimeUnit;
  estimatedText: string;
  actualText: string;
  differenceText: string;
  status: "BEFORE" | "ON_TIME" | "AFTER";
  statusLabel: string;
}

export function calculateTimeComparison(
  startDate: Date | string,
  actualEndDate: Date | string,
  estimatedAmount: number,
  estimatedUnit: TimeUnit
): TimeComparison {
  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  const end = typeof actualEndDate === "string" ? new Date(actualEndDate) : actualEndDate;

  const actualDurationMs = end.getTime() - start.getTime();
  const rawActualInUnit = actualDurationMs / UNIT_MS[estimatedUnit];
  const rawDiffInUnit = rawActualInUnit - estimatedAmount;

  const actualRounded = roundToTwoDecimals(rawActualInUnit);
  const diffRounded = roundToTwoDecimals(rawDiffInUnit);
  const estimatedRounded = roundToTwoDecimals(estimatedAmount);

  const estimatedText = formatDurationWithUnit(estimatedRounded, estimatedUnit);
  const actualText = formatDurationWithUnit(actualRounded, estimatedUnit);

  let status: "BEFORE" | "ON_TIME" | "AFTER";
  let statusLabel: string;
  let differenceText: string;

  if (Math.abs(diffRounded) === 0) {
    status = "ON_TIME";
    statusLabel = "Terminó a tiempo";
    differenceText = `0 ${getUnitLabel(estimatedUnit, 0)} (terminó a tiempo según lo estimado)`;
  } else if (diffRounded > 0) {
    status = "AFTER";
    statusLabel = "Terminó después de lo estimado";
    const absText = formatDurationWithUnit(Math.abs(diffRounded), estimatedUnit);
    differenceText = `${absText} más de lo estimado (terminó después)`;
  } else {
    status = "BEFORE";
    statusLabel = "Terminó antes de lo estimado";
    const absText = formatDurationWithUnit(Math.abs(diffRounded), estimatedUnit);
    differenceText = `${absText} menos de lo estimado (terminó antes)`;
  }

  return {
    estimatedAmount: estimatedRounded,
    actualAmount: actualRounded,
    differenceAmount: diffRounded,
    unit: estimatedUnit,
    estimatedText,
    actualText,
    differenceText,
    status,
    statusLabel,
  };
}

export function formatDateTimeLocalInput(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function snapDateTo15Minutes(dateInput: Date | string): Date {
  const d =
    typeof dateInput === "string" ? new Date(dateInput) : new Date(dateInput.getTime());
  const roundedMinutes = Math.round(d.getMinutes() / 15) * 15;
  d.setMinutes(roundedMinutes, 0, 0);
  return d;
}

export interface TimeSlotOption {
  value: string;
  label: string;
}

export const TIME_SLOTS_15_MIN: TimeSlotOption[] = (() => {
  const slots: TimeSlotOption[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh24 = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const period = h < 12 ? "AM" : "PM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const hh12 = String(h12).padStart(2, "0");
      slots.push({
        value: `${hh24}:${mm}`,
        // Formato de 12 horas, ej.: "07:00 AM" / "07:00 PM"
        label: `${hh12}:${mm} ${period}`,
      });
    }
  }
  return slots;
})();

export function formatDateTimeDisplay(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export type CompletedFilterPeriod = "day" | "week" | "month";

export function getPeriodBounds(
  period: CompletedFilterPeriod,
  referenceDate: Date = new Date()
): { start: Date; end: Date; label: string } {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const date = referenceDate.getDate();

  if (period === "day") {
    const start = new Date(year, month, date, 0, 0, 0, 0);
    const end = new Date(year, month, date, 23, 59, 59, 999);
    const dayStr = `${String(date).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}/${year}`;
    return { start, end, label: `Hoy (${dayStr})` };
  }

  if (period === "week") {
    // Semana calendario de lunes a domingo
    const dayOfWeek = referenceDate.getDay(); // 0 = domingo, 1 = lunes, ..., 6 = sábado
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(year, month, date + diffToMonday, 0, 0, 0, 0);
    const sunday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 6,
      23,
      59,
      59,
      999
    );
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    return {
      start: monday,
      end: sunday,
      label: `Semana actual (${fmt(monday)} al ${fmt(sunday)})`,
    };
  }

  // Mes calendario actual
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const monthNames = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  return {
    start,
    end,
    label: `${monthNames[month]} ${year}`,
  };
}

export const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export const WEEKDAY_NAMES_ES = [
  "Lun",
  "Mar",
  "Mié",
  "Jue",
  "Vie",
  "Sáb",
  "Dom",
];

export function formatDateKey(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateKeyDisplay(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  if (!y || !m || !d) return dateKey;
  return `${d}/${m}/${y}`;
}

export interface CalendarCell {
  date: Date;
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export function getCalendarGridDays(year: number, month: number): CalendarCell[] {
  const todayKey = formatDateKey(new Date());
  const firstDayOfMonth = new Date(year, month, 1);
  const dayOfWeek = firstDayOfMonth.getDay(); // 0 = Dom, 1 = Lun, ..., 6 = Sáb
  const offsetFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const lastDayOfMonth = new Date(year, month + 1, 0);
  const totalDaysInMonth = lastDayOfMonth.getDate();

  const totalCells = Math.ceil((offsetFromMonday + totalDaysInMonth) / 7) * 7;
  const cells: CalendarCell[] = [];

  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(year, month, 1 - offsetFromMonday + i);
    const dateKey = formatDateKey(cellDate);
    cells.push({
      date: cellDate,
      dateKey,
      dayNumber: cellDate.getDate(),
      isCurrentMonth: cellDate.getMonth() === month && cellDate.getFullYear() === year,
      isToday: dateKey === todayKey,
    });
  }

  return cells;
}

export function doesActivityOccurOnDateKey(
  startDateInput: Date | string,
  endDateInput: Date | string,
  targetDateKey: string
): boolean {
  const start =
    typeof startDateInput === "string" ? new Date(startDateInput) : startDateInput;
  const end =
    typeof endDateInput === "string" ? new Date(endDateInput) : endDateInput;

  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
  const endDay = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate(),
    23,
    59,
    59,
    999
  ).getTime();

  const [ty, tm, td] = targetDateKey.split("-").map(Number);
  const targetMid = new Date(ty, tm - 1, td, 12, 0, 0, 0).getTime();

  return targetMid >= startDay && targetMid <= endDay;
}


