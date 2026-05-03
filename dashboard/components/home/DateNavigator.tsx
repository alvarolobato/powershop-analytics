"use client";

interface DateNavigatorProps {
  /** ISO YYYY-MM-DD string of the currently selected date. */
  value: string;
  onChange: (next: string) => void;
  /** Disable the next-day arrow when we're already on the most recent
   *  available date. The hint label still shows the as-of-day clamp. */
  maxDate?: string;
}

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];
const DAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map((p) => parseInt(p, 10));
  return new Date(y, m - 1, d);
}

function toISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDateEs(s: string): string {
  const d = parseISO(s);
  return `${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

const arrowBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border-strong)",
  color: "var(--fg)",
  width: 32,
  height: 32,
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 14,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const labelBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border-strong)",
  color: "var(--fg)",
  height: 32,
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 500,
  padding: "0 12px",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  position: "relative",
};

export function DateNavigator({ value, onChange, maxDate }: DateNavigatorProps) {
  const shift = (days: number) => {
    const d = parseISO(value);
    d.setDate(d.getDate() + days);
    const next = toISO(d);
    if (maxDate && next > maxDate) return;
    onChange(next);
  };

  const atMax = !!maxDate && value >= maxDate;

  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      data-testid="date-navigator"
    >
      <button
        type="button"
        style={arrowBtn}
        onClick={() => shift(-1)}
        aria-label="Día anterior"
        data-testid="date-prev"
      >
        ‹
      </button>

      {/* The label is also a real <input type="date">; the calendar UI is
          the browser-native picker. The label sits on top of the input so
          the visible text is the formatted Spanish date while the input
          handles keyboard / picker interactions. */}
      <label style={labelBtn} data-testid="date-label">
        <span style={{ fontFamily: "var(--font-jetbrains, monospace)" }}>📅</span>
        <span>{fmtDateEs(value)}</span>
        <input
          type="date"
          value={value}
          max={maxDate}
          onChange={(e) => {
            const v = e.target.value;
            if (v) onChange(v);
          }}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
          aria-label="Elegir fecha"
          data-testid="date-input"
        />
      </label>

      <button
        type="button"
        style={{
          ...arrowBtn,
          opacity: atMax ? 0.4 : 1,
          cursor: atMax ? "not-allowed" : "pointer",
        }}
        onClick={() => shift(1)}
        disabled={atMax}
        aria-label="Día siguiente"
        data-testid="date-next"
      >
        ›
      </button>
    </div>
  );
}
