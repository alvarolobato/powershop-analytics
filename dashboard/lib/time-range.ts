import type { DateRange } from "@/components/DateRangePicker";
import type { TimeRangePreset, DefaultTimeRange } from "@/lib/schema";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function toISODateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function substituteTimeRange(sql: string, from: string, to: string): string {
  return sql.replaceAll("{{date_from}}", from).replaceAll("{{date_to}}", to);
}

/**
 * Lunes de la semana ISO de *d*.
 *
 * Vive aquí y no en `DateRangePicker` porque lo necesitan los dos: el selector
 * (cliente) y la resolución de períodos por defecto (servidor). Al revés no
 * puede ser — importar un componente de cliente desde `lib/` arrastra React a
 * módulos de servidor y rompe todo lo que los importe.
 */
export function isoWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diff = day === 0 ? -6 : 1 - day; // shift so Monday = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

/** Inicio del trimestre natural de *d*. Mismo motivo de ubicación. */
export function currentQuarterStart(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

export function presetToDateRange(preset: TimeRangePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "last_7_days": {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case "yesterday": {
      const ayer = new Date(now);
      ayer.setDate(ayer.getDate() - 1);
      return { from: startOfDay(ayer), to: endOfDay(ayer) };
    }
    case "current_week": {
      return { from: startOfDay(isoWeekMonday(now)), to: endOfDay(now) };
    }
    case "last_week": {
      // Misma aritmética que el preset "Semana anterior" del selector, usando
      // su mismo helper: si divergieran, elegir el período desde la definición
      // y elegirlo a mano darían rangos distintos.
      const lunesDeEstaSemana = isoWeekMonday(now);
      const domingoPasado = new Date(lunesDeEstaSemana);
      domingoPasado.setDate(lunesDeEstaSemana.getDate() - 1);
      const lunesPasado = new Date(lunesDeEstaSemana);
      lunesPasado.setDate(lunesDeEstaSemana.getDate() - 7);
      return { from: startOfDay(lunesPasado), to: endOfDay(domingoPasado) };
    }
    case "current_quarter": {
      return { from: startOfDay(currentQuarterStart(now)), to: endOfDay(now) };
    }
    case "last_quarter": {
      const inicioActual = currentQuarterStart(now);
      const finAnterior = new Date(inicioActual);
      finAnterior.setDate(inicioActual.getDate() - 1);
      const inicioAnterior = currentQuarterStart(finAnterior);
      return { from: startOfDay(inicioAnterior), to: endOfDay(finAnterior) };
    }
    case "current_year": {
      const desde = new Date(now.getFullYear(), 0, 1);
      return { from: startOfDay(desde), to: endOfDay(now) };
    }
    case "last_year": {
      const desde = new Date(now.getFullYear() - 1, 0, 1);
      const hasta = new Date(now.getFullYear() - 1, 11, 31);
      return { from: startOfDay(desde), to: endOfDay(hasta) };
    }
    case "last_30_days": {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case "current_month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case "last_month": {
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
      return { from: startOfDay(lastMonthStart), to: endOfDay(lastMonthEnd) };
    }
    case "year_to_date": {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
  }
}

export function defaultTimeRangeToDateRange(defaultTimeRange: DefaultTimeRange | undefined): DateRange {
  return presetToDateRange(defaultTimeRange?.preset ?? "last_30_days");
}
