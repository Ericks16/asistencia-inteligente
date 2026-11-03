/**
 * Motor de Cálculo de Horas, Horas Extras y Atrasos
 * ----------------------------------------------------------------------------
 * Reglas de negocio:
 *  - Jornada ordinaria: entrada 08:00, salida 17:00, almuerzo 1 h (12:00–13:00).
 *  - Horas ordinarias efectivas esperadas: 8 h (480 min).
 *  - Entrada ANTES de 08:00  -> Horas Extra de Entrada (EARLY_ENTRY).
 *  - Salida DESPUÉS de 17:00 -> Horas Extra de Salida (LATE_EXIT).
 *  - Entrada DESPUÉS de 08:00 -> Atraso (con tolerancia `graceMinutes`).
 *  - Salida ANTES de 17:00    -> Salida temprana (se descuenta de ordinarias).
 *
 * Los timestamps se almacenan en UTC; todo el cálculo se hace en la zona
 * configurada (`timezone`), por defecto America/Guayaquil (UTC-5, sin DST).
 * ----------------------------------------------------------------------------
 */

export interface ShiftConfig {
  /** "HH:mm" hora oficial de entrada. */
  officialEntry: string;
  /** "HH:mm" hora oficial de salida. */
  officialExit: string;
  /** "HH:mm" inicio del almuerzo. */
  lunchStart: string;
  /** "HH:mm" fin del almuerzo. */
  lunchEnd: string;
  /** Duración del almuerzo en minutos (default 60). */
  lunchMinutes: number;
  /** Horas ordinarias efectivas esperadas en minutos (default 480 = 8 h). */
  ordinaryMinutes: number;
  /** Tolerancia de atraso en minutos (default 5). */
  graceMinutes: number;
}

export const DEFAULT_SHIFT: ShiftConfig = {
  officialEntry: '08:00',
  officialExit: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  lunchMinutes: 60,
  ordinaryMinutes: 480,
  graceMinutes: 5,
};

export interface AttendanceStamp {
  /** Tipo de marca. */
  type: 'CHECK_IN' | 'CHECK_OUT';
  /** Timestamp de la marca (Date). */
  at: Date;
}

export interface DailyComputation {
  date: string;
  entryTime: string | null;
  exitTime: string | null;
  /** Minutos de hora extra por entrar temprano. */
  earlyEntryMinutes: number;
  /** Minutos de hora extra por salir tarde. */
  lateExitMinutes: number;
  /** Minutos de atraso (entrada tardía, ya descontada la tolerancia). */
  lateArrivalMinutes: number;
  /** Minutos de salida temprana. */
  earlyDepartureMinutes: number;
  /** Total de minutos extra (entrada + salida). */
  overtimeMinutes: number;
  /** Minutos ordinarios efectivos trabajados. */
  ordinaryMinutes: number;
  /** Minutos totales trabajados (ordinarios + extras). */
  totalWorkedMinutes: number;
  status: 'COMPLETE' | 'MISSING_ENTRY' | 'MISSING_EXIT' | 'ABSENT';
  notes: string[];
}

export interface MonthlyComputation {
  daysWorked: number;
  absences: number;
  lateArrivalsCount: number;
  totalOrdinaryMinutes: number;
  totalOvertimeMinutes: number;
  days: DailyComputation[];
}

/** Convierte "HH:mm" a minutos desde medianoche. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Convierte minutos desde medianoche a "HH:mm". */
export function toHHMM(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Extrae los minutos desde medianoche de una fecha en una zona horaria IANA. */
export function minutesOfDayInZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = Number(p.value);
    if (p.type === 'minute') minute = Number(p.value);
  }
  return hour * 60 + minute;
}

/** Devuelve la fecha local "YYYY-MM-DD" en la zona indicada. */
export function localDateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Deduplica y empareja marcas de un mismo día: toma la ÚLTIMA entrada y la
 * ÚLTIMA salida registradas. Cada nueva foto de entrada reemplaza la anterior
 * en el resumen del día, mientras las marcas originales permanecen auditables.
 */
export function pairStamps(
  stamps: AttendanceStamp[],
  timeZone: string,
): { entry: AttendanceStamp | null; exit: AttendanceStamp | null; duplicates: number } {
  const ins = stamps.filter((s) => s.type === 'CHECK_IN').sort((a, b) => a.at.getTime() - b.at.getTime());
  const outs = stamps.filter((s) => s.type === 'CHECK_OUT').sort((a, b) => a.at.getTime() - b.at.getTime());

  const entry = ins.length ? ins[ins.length - 1] : null;
  const exit = outs.length ? outs[outs.length - 1] : null;
  const duplicates = Math.max(0, ins.length - 1) + Math.max(0, outs.length - 1);
  return { entry, exit, duplicates };
}

/**
 * Calcula el desglose diario de horas para una entrada y salida dadas.
 * No muta nada; es una función pura (fácil de testear).
 */
export function computeDaily(
  entry: Date | null,
  exit: Date | null,
  config: ShiftConfig = DEFAULT_SHIFT,
  timeZone = 'America/Guayaquil',
): DailyComputation {
  const entryMin = config.officialEntry ? toMinutes(config.officialEntry) : 0;
  const exitMin = toMinutes(config.officialExit);
  const lunchStart = toMinutes(config.lunchStart);
  const lunchEnd = toMinutes(config.lunchEnd);
  const notes: string[] = [];

  if (!entry && !exit) {
    return {
      date: '',
      entryTime: null,
      exitTime: null,
      earlyEntryMinutes: 0,
      lateExitMinutes: 0,
      lateArrivalMinutes: 0,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      ordinaryMinutes: 0,
      totalWorkedMinutes: 0,
      status: 'ABSENT',
      notes: ['Sin marcas en el día.'],
    };
  }

  const date = entry ? localDateInZone(entry, timeZone) : localDateInZone(exit!, timeZone);

  if (!entry) {
    return {
      date,
      entryTime: null,
      exitTime: exit ? toHHMM(minutesOfDayInZone(exit, timeZone)) : null,
      earlyEntryMinutes: 0,
      lateExitMinutes: 0,
      lateArrivalMinutes: 0,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      ordinaryMinutes: 0,
      totalWorkedMinutes: 0,
      status: 'MISSING_ENTRY',
      notes: ['Falta marca de entrada; requiere corrección de administrador.'],
    };
  }

  if (!exit) {
    return {
      date,
      entryTime: toHHMM(minutesOfDayInZone(entry, timeZone)),
      exitTime: null,
      earlyEntryMinutes: 0,
      lateExitMinutes: 0,
      lateArrivalMinutes: 0,
      earlyDepartureMinutes: 0,
      overtimeMinutes: 0,
      ordinaryMinutes: 0,
      totalWorkedMinutes: 0,
      status: 'MISSING_EXIT',
      notes: ['Falta marca de salida; requiere corrección de administrador.'],
    };
  }

  const e = minutesOfDayInZone(entry, timeZone);
  const x = minutesOfDayInZone(exit, timeZone);

  // 1) Horas extra de entrada (antes de la hora oficial).
  const earlyEntryMinutes = Math.max(0, entryMin - e);

  // 2) Atraso (entrada después de la hora oficial), aplicando tolerancia.
  const rawLate = Math.max(0, e - entryMin);
  const lateArrivalMinutes = rawLate > config.graceMinutes ? rawLate : 0;
  if (lateArrivalMinutes > 0) notes.push(`Atraso de ${lateArrivalMinutes} min.`);

  // 3) Horas extra de salida (después de la hora oficial).
  const lateExitMinutes = Math.max(0, x - exitMin);

  // 4) Salida temprana (antes de la hora oficial de salida).
  const earlyDepartureMinutes = Math.max(0, exitMin - x);
  if (earlyDepartureMinutes > 0) notes.push(`Salida temprana de ${earlyDepartureMinutes} min.`);

  // 5) Minutos brutos trabajados (neto del almuerzo si el intervalo lo cruza).
  let grossMinutes = x - e;
  // Se descuenta el almuerzo solo si la jornada cubre el intervalo de almuerzo.
  if (e <= lunchStart && x >= lunchEnd) {
    grossMinutes -= config.lunchMinutes;
  } else if (e < lunchEnd && x > lunchStart) {
    // Caso borde: marca dentro del almuerzo — se descuenta la parte solapada.
    const overlap = Math.min(x, lunchEnd) - Math.max(e, lunchStart);
    grossMinutes -= overlap;
    notes.push('Marca registrada durante el almuerzo; se descontó el solape.');
  }

  // 6) Ordinarias efectivas = ordinarias esperadas menos atraso y salida temprana.
  const ordinaryMinutes = Math.max(
    0,
    config.ordinaryMinutes - lateArrivalMinutes - earlyDepartureMinutes,
  );

  const overtimeMinutes = earlyEntryMinutes + lateExitMinutes;
  const totalWorkedMinutes = Math.max(0, grossMinutes);

  return {
    date,
    entryTime: toHHMM(e),
    exitTime: toHHMM(x),
    earlyEntryMinutes,
    lateExitMinutes,
    lateArrivalMinutes,
    earlyDepartureMinutes,
    overtimeMinutes,
    ordinaryMinutes,
    totalWorkedMinutes,
    status: 'COMPLETE',
    notes,
  };
}

/**
 * Consolida un mes de marcas por empleado. `stampsByDate` mapea "YYYY-MM-DD"
 * a la lista de marcas de ese día.
 */
export function computeMonthly(
  stampsByDate: Record<string, AttendanceStamp[]>,
  config: ShiftConfig = DEFAULT_SHIFT,
  timeZone = 'America/Guayaquil',
): MonthlyComputation {
  const days: DailyComputation[] = [];
  let daysWorked = 0;
  let lateArrivalsCount = 0;
  let totalOrdinaryMinutes = 0;
  let totalOvertimeMinutes = 0;

  for (const [date, stamps] of Object.entries(stampsByDate)) {
    const { entry, exit } = pairStamps(stamps, timeZone);
    const day = computeDaily(entry?.at ?? null, exit?.at ?? null, config, timeZone);
    day.date = date;
    days.push(day);

    if (day.status === 'COMPLETE') {
      daysWorked++;
      totalOrdinaryMinutes += day.ordinaryMinutes;
      totalOvertimeMinutes += day.overtimeMinutes;
      if (day.lateArrivalMinutes > 0) lateArrivalsCount++;
    }
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return {
    daysWorked,
    absences: Math.max(0, Object.keys(stampsByDate).length - daysWorked),
    lateArrivalsCount,
    totalOrdinaryMinutes,
    totalOvertimeMinutes,
    days,
  };
}
