"use client";

import { useState, useMemo } from "react";
import type { TableWidget as TableWidgetSpec, GlossaryItem } from "@/lib/schema";
import type { OnDataPointClick, WidgetData } from "./types";
import { EMPTY_MESSAGE } from "./types";
import { applyGlossary } from "@/lib/glossary";
import { toTitleCase } from "./format";
import { ExportButton } from "./ExportButton";
import { celdaACodigo, celdaARef, resolveArticleColumns } from "./articulo";
import { useArticlePhotos, type Slot } from "@/lib/use-article-photos";
import { ArticlePhotoHover } from "@/components/ArticlePhotoHover";
import { urlFoto } from "@/components/PhotoLightbox";

interface TableWidgetProps {
  widget: TableWidgetSpec;
  data: WidgetData | null;
  glossary?: GlossaryItem[];
  onDataPointClick?: OnDataPointClick;
  /** When false, removes internal padding so the table is edge-to-edge. Default true. */
  padded?: boolean;
}

type SortDir = "asc" | "desc";

/** El artículo de una fila, si tiene foto (D-068). */
interface FotoDeFila {
  codigo: string;
  slots: Slot[];
  referencia?: string;
  descripcion?: string;
}

const SIN_TEXTOS: string[] = [];

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Detect format hints from column name suffixes. */
function detectFormat(colName: string): string {
  const lower = colName.toLowerCase();
  if (lower.includes("ref") || lower.startsWith("ref")) return "ref";
  if (lower.includes("familia") || lower.includes("family") || lower.includes("tag")) return "tag";
  if (lower.includes("margen") || lower.includes("margin") || lower.includes("pct") || lower.includes("%")) return "margin_pct";
  return "default";
}

function formatCellValue(value: unknown): string {
  if (isNullish(value)) return "—";
  if (typeof value === "number") {
    return value.toLocaleString("es-ES", { maximumFractionDigits: 2 });
  }
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num.toLocaleString("es-ES", { maximumFractionDigits: 2 });
    }
  }
  return String(value);
}

function HeatCell({
  value,
  max,
  color = "var(--accent)",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const barWidthPx = max > 0 ? Math.min(80, (Math.abs(value) / max) * 80) : 0;
  const display = value.toLocaleString("es-ES", { maximumFractionDigits: 0 });
  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "flex-end",
        minWidth: 120,
      }}
    >
      <div
        style={{
          position: "absolute",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          width: barWidthPx,
          height: 14,
          background: color,
          opacity: 0.15,
          borderRadius: 2,
          zIndex: 0,
        }}
      />
      <span
        style={{
          position: "relative",
          zIndex: 1,
          fontFamily: "var(--font-jetbrains, monospace)",
          fontSize: 11,
        }}
      >
        {display}
      </span>
    </div>
  );
}

export function TableWidget({
  widget,
  data,
  glossary,
  onDataPointClick,
  padded = true,
}: TableWidgetProps) {
  const titleNode = applyGlossary(widget.title, glossary);

  /**
   * ¿Se pintan las barras de calor detrás de los números?
   *
   * Manda el spec si lo dice. Si no, se decide por el número de columnas
   * numéricas: cada celda con barra reserva 120 px de ancho mínimo, así que a
   * partir de cierto punto la tabla no cabe y hay que desplazarla en
   * horizontal para leer nada. Con 30 columnas —una tabla pivotada por tallas—
   * son 3.600 px, y además nadie compara treinta barras entre sí: el adorno
   * deja de informar justo cuando empieza a estorbar.
   */
  const MAX_COLUMNAS_CON_BARRAS = 8;
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedRows = useMemo(() => {
    if (!data || sortCol === null) return data?.rows ?? [];
    const rows = [...data.rows];
    rows.sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (isNullish(va) && isNullish(vb)) return 0;
      if (isNullish(va)) return 1;
      if (isNullish(vb)) return -1;
      const na = Number(va);
      const nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        return sortDir === "asc" ? na - nb : nb - na;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDir === "asc"
        ? sa.localeCompare(sb, "es")
        : sb.localeCompare(sa, "es");
    });
    return rows;
  }, [data, sortCol, sortDir]);

  function handleSort(colIdx: number) {
    if (sortCol === colIdx) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(colIdx);
      setSortDir("asc");
    }
  }

  // Compute column max values for heat cells
  const colMaxValues = useMemo(() => {
    if (!data) return [];
    return data.columns.map((_, cIdx) => {
      let max = 0;
      for (const row of data.rows) {
        const v = Number(row[cIdx]);
        if (Number.isFinite(v) && v > max) max = v;
      }
      return max;
    });
  }, [data]);

  // Fotos de artículo (D-068). Qué columnas identifican el artículo de cada
  // fila, y una sola pregunta al servidor por widget para saber cuáles tienen
  // foto. Sin columnas de artículo las listas van vacías y no se pregunta nada.
  const articulo = useMemo(
    () =>
      resolveArticleColumns(data?.columns ?? [], {
        articulo_codigo_col: widget.articulo_codigo_col,
        articulo_ref_col: widget.articulo_ref_col,
      }),
    [data, widget.articulo_codigo_col, widget.articulo_ref_col],
  );
  const { codigosVisibles, refsVisibles } = useMemo(() => {
    const { codigoIdx, refIdx } = articulo;
    if (!data || (codigoIdx === null && refIdx === null)) {
      return { codigosVisibles: SIN_TEXTOS, refsVisibles: SIN_TEXTOS };
    }
    const codigos = new Set<string>();
    const refs = new Set<string>();
    for (const row of data.rows) {
      const codigo = codigoIdx !== null ? celdaACodigo(row[codigoIdx]) : null;
      if (codigo) {
        codigos.add(codigo);
        continue;
      }
      // La referencia solo se pregunta para las filas sin código.
      const ref = refIdx !== null ? celdaARef(row[refIdx]) : null;
      if (ref) refs.add(ref);
    }
    return { codigosVisibles: [...codigos], refsVisibles: [...refs] };
  }, [data, articulo]);
  const fotos = useArticlePhotos(codigosVisibles, refsVisibles);

  /** El artículo de la fila, solo si tiene alguna foto. */
  function fotoDeFila(row: unknown[]): FotoDeFila | null {
    const { codigoIdx, refIdx, descIdx } = articulo;
    const referencia = refIdx !== null ? (celdaARef(row[refIdx]) ?? undefined) : undefined;
    let codigo = codigoIdx !== null ? celdaACodigo(row[codigoIdx]) : null;
    let slots: Slot[] = [];
    if (codigo) {
      slots = fotos.slotsDeCodigo(codigo);
    } else if (referencia) {
      const deRef = fotos.deRef(referencia);
      if (deRef) {
        codigo = deRef.codigo;
        slots = deRef.slots;
      }
    }
    if (!codigo || slots.length === 0) return null;
    const desc = descIdx !== null ? row[descIdx] : null;
    return {
      codigo,
      slots,
      referencia,
      descripcion: typeof desc === "string" && desc.trim() ? desc.trim() : undefined,
    };
  }

  if (!data || data.rows.length === 0) {
    return (
      <div
        style={{
          background: "var(--bg-1)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <div className="panel-header" style={{ paddingTop: 12, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>
            {titleNode}
          </h3>
        </div>
        <p style={{ padding: "16px 12px", textAlign: "center", fontSize: 13, color: "var(--fg-muted)" }}>
          {EMPTY_MESSAGE}
        </p>
      </div>
    );
  }

  const colFormats = data.columns.map(detectFormat);

  // Per-column numeric detection (right-aligned headers + cells).
  //
  // A column counts as numeric when the clear majority (≥80%) of non-null
  // cells are finite numbers. The "at least one" rule we used before
  // misclassified identifier columns like "Temporada" — values are mostly
  // codes ("S26", "VER", "P25-V") but a few rows happen to be a pure year
  // ("2024"). With the old rule the header right-aligned, the numeric rows
  // rendered as right-aligned heat cells, and the text rows fell through to
  // left-aligned text — so each row in the same column landed in a different
  // place. The majority rule keeps mixed-content identifier columns
  // consistently left-aligned. `ref` and `tag` formatted columns stay
  // left-aligned by design; `margin_pct` is always numeric.
  const colIsNumericRight = data.columns.map((_col, idx) => {
    const fmt = colFormats[idx];
    // Un código de artículo es un identificador aunque sea todo dígitos.
    if (idx === articulo.codigoIdx) return false;
    if (fmt === "ref" || fmt === "tag") return false;
    if (fmt === "margin_pct") return true;
    let total = 0;
    let numeric = 0;
    for (const row of data.rows) {
      const cell = row[idx];
      if (cell === null || cell === undefined || cell === "") continue;
      total += 1;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        numeric += 1;
        continue;
      }
      if (typeof cell === "string") {
        const n = Number(cell);
        if (Number.isFinite(n)) numeric += 1;
      }
    }
    if (total === 0) return false;
    return numeric / total >= 0.8;
  });

  // El spec manda; si no dice nada, se decide por el número de columnas
  // numéricas. Ver `MAX_COLUMNAS_CON_BARRAS` arriba.
  // Se cuentan sólo las columnas que DE VERDAD pintarían una barra, no todas
  // las numéricas: `margin_pct` se renderiza con su propio formato de
  // porcentaje y nunca usa `HeatCell`, y una columna cuyo máximo es 0 tampoco
  // (por eso la "85 V" del panel del dueño salía estrecha). Contarlas inflaba
  // el total y podía apagar las barras sin que el ancho creciera. Lo señaló una
  // revisión de Copilot que nadie había leído.
  const columnasNumericas = colIsNumericRight.filter(
    (esNumerica, idx) =>
      esNumerica && colFormats[idx] !== "margin_pct" && colMaxValues[idx] > 0,
  ).length;
  const conBarras = widget.heat ?? columnasNumericas <= MAX_COLUMNAS_CON_BARRAS;

  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header. Left/right padding lives in `.panel-header`
          (globals.css) — unconditional base matches the 16px literal,
          phone media query narrows to `--pad-x`. */}
      <div
        className="panel-header"
        style={{
          paddingTop: 12,
          paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--fg)", letterSpacing: "-0.005em" }}>
          {titleNode}
        </h3>
        {/* Exporta las filas ORDENADAS como se ven, no el orden de origen: si
            el usuario ha ordenado por margen y exporta, espera ese orden. */}
        <ExportButton data={data ? { columns: data.columns, rows: sortedRows } : null} titulo={widget.title} />
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", padding: padded ? "var(--pad, 0)" : 0 }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          title={onDataPointClick ? "Clic para explorar" : undefined}
        >
          <thead>
            <tr>
              {widget.mostrar_fotos && (
                <th
                  className="table-widget-cell"
                  style={{
                    textAlign: "left",
                    paddingTop: 10,
                    paddingBottom: 10,
                    fontWeight: 500,
                    borderBottom: "1px solid var(--border)",
                    fontFamily: "var(--font-inter, sans-serif)",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                    color: "var(--fg-subtle)",
                    whiteSpace: "nowrap",
                    width: 56,
                  }}
                >
                  Foto
                </th>
              )}
              {data.columns.map((col, idx) => (
                <th
                  key={`${idx}-${col}`}
                  // Left/right padding lives in `.table-widget-cell`
                  // (globals.css) — unconditional base matches the 12px
                  // literal, phone media query narrows to `--pad-x`.
                  className="table-widget-cell"
                  style={{
                    textAlign: colIsNumericRight[idx] ? "right" : "left",
                    paddingTop: 10,
                    paddingBottom: 10,
                    fontWeight: 500,
                    borderBottom: "1px solid var(--border)",
                    fontFamily: "var(--font-inter, sans-serif)",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                    color: "var(--fg-subtle)",
                    whiteSpace: "nowrap",
                  }}
                  aria-sort={
                    sortCol === idx
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => handleSort(idx)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "inherit",
                      fontFamily: "inherit",
                      fontSize: "inherit",
                      textTransform: "inherit" as React.CSSProperties["textTransform"],
                      letterSpacing: "inherit",
                      padding: 0,
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: colIsNumericRight[idx] ? "flex-end" : "flex-start",
                      gap: 4,
                    }}
                  >
                    {col}
                    {sortCol === idx && (
                      <span>{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rIdx) => {
              const foto = fotoDeFila(row);
              // Envuelve el contenido de las celdas que identifican el
              // artículo (código, referencia y, anclada a ellas, descripción).
              // No sustituye cómo se pinta la celda: lo envuelve.
              // Una sola parada de Tab por fila: la miniatura si la hay y,
              // si no, la primera celda que DE VERDAD lleve hover. Se decide
              // al pintar y no por columnas: una referencia numérica cae en
              // otra rama de render y no llega a envolverse.
              let paradaPuesta = Boolean(widget.mostrar_fotos);
              const conFoto = (cIdx: number, contenido: React.ReactNode) => {
                if (
                  !foto ||
                  !(cIdx === articulo.codigoIdx || cIdx === articulo.refIdx || cIdx === articulo.descIdx)
                ) {
                  return contenido;
                }
                const enfocable = !paradaPuesta;
                paradaPuesta = true;
                return (
                  <ArticlePhotoHover
                    // Las filas van por índice: sin esta clave, al reordenar
                    // la instancia heredaría el estado (tooltip armado, foto
                    // cargada, lightbox abierto) del artículo anterior.
                    key={foto.codigo}
                    enfocable={enfocable}
                    codigo={foto.codigo}
                    slots={foto.slots}
                    referencia={foto.referencia}
                    descripcion={foto.descripcion}
                  >
                    {contenido}
                  </ArticlePhotoHover>
                );
              };
              return (
              <tr
                key={rIdx}
                style={{
                  borderTop: "1px solid var(--border)",
                  cursor: onDataPointClick ? "pointer" : "default",
                  transition: "background 0.1s",
                }}
                onClick={
                  onDataPointClick
                    ? () =>
                        onDataPointClick({
                          label: String(row[0] ?? ""),
                          value: "",
                          widgetTitle: widget.title,
                          widgetType: "table",
                        })
                    : undefined
                }
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "var(--bg-2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "";
                }}
              >
                {widget.mostrar_fotos && (
                  <td
                    className="table-widget-cell"
                    data-testid="article-photo-cell"
                    style={{ paddingTop: 4, paddingBottom: 4, width: 56 }}
                  >
                    {foto && (
                      <ArticlePhotoHover
                        key={foto.codigo}
                        codigo={foto.codigo}
                        slots={foto.slots}
                        referencia={foto.referencia}
                        descripcion={foto.descripcion}
                        glifo={false}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura servida y cacheada por /api/fotos */}
                        <img
                          src={urlFoto(foto.codigo, foto.slots[0], 160)}
                          alt={`Foto del artículo ${foto.referencia ?? foto.codigo}`}
                          width={40}
                          height={40}
                          loading="lazy"
                          style={{
                            width: 40,
                            height: 40,
                            objectFit: "cover",
                            borderRadius: 4,
                            display: "block",
                            background: "var(--bg-2)",
                          }}
                        />
                      </ArticlePhotoHover>
                    )}
                  </td>
                )}
                {row.map((cell, cIdx) => {
                  const fmt = colFormats[cIdx];
                  const colMax = colMaxValues[cIdx];
                  const numVal = Number(cell);
                  const isNumeric = !isNullish(cell) && Number.isFinite(numVal);

                  // Código de artículo: un identificador, tal cual. Sin esto un
                  // código todo dígitos caería en la columna de ranking o en
                  // una barra de calor, y "144750" saldría como "144.750".
                  if (cIdx === articulo.codigoIdx) {
                    return (
                      <td key={cIdx} className="table-widget-cell" style={{ paddingTop: 10, paddingBottom: 10 }}>
                        {conFoto(
                          cIdx,
                          <span
                            style={{
                              fontFamily: "var(--font-jetbrains, monospace)",
                              color: "var(--fg-muted)",
                              fontSize: 11,
                            }}
                          >
                            {isNullish(cell) ? "—" : String(cell)}
                          </span>,
                        )}
                      </td>
                    );
                  }

                  // Rank column (first column, integer-looking)
                  if (cIdx === 0 && isNumeric && numVal >= 0 && numVal < 1000) {
                    return (
                      <td
                        key={cIdx}
                        className="table-widget-cell"
                        style={{ paddingTop: 10, paddingBottom: 10, color: "var(--fg)" }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-jetbrains, monospace)",
                            color: "var(--fg-subtle)",
                            fontSize: 11,
                          }}
                        >
                          {String(Math.round(numVal)).padStart(2, "0")}
                        </span>
                      </td>
                    );
                  }

                  if (fmt === "ref") {
                    return (
                      <td key={cIdx} className="table-widget-cell" style={{ paddingTop: 10, paddingBottom: 10 }}>
                        {conFoto(
                          cIdx,
                          <span
                            style={{
                              fontFamily: "var(--font-jetbrains, monospace)",
                              color: "var(--accent)",
                              fontSize: 11,
                            }}
                          >
                            {String(cell ?? "")}
                          </span>,
                        )}
                      </td>
                    );
                  }

                  if (fmt === "tag") {
                    return (
                      <td key={cIdx} className="table-widget-cell" style={{ paddingTop: 10, paddingBottom: 10 }}>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 3,
                            background: "var(--bg-2)",
                            color: "var(--fg-muted)",
                            fontFamily: "var(--font-jetbrains, monospace)",
                          }}
                        >
                          {toTitleCase(String(cell ?? ""))}
                        </span>
                      </td>
                    );
                  }

                  if (fmt === "margin_pct" && isNumeric) {
                    const color =
                      numVal > 60
                        ? "var(--up)"
                        : numVal > 50
                        ? "var(--fg)"
                        : "var(--warn)";
                    return (
                      <td key={cIdx} className="table-widget-cell" style={{ paddingTop: 10, paddingBottom: 10, textAlign: "right" }}>
                        <span
                          style={{
                            color,
                            fontFamily: "var(--font-jetbrains, monospace)",
                            fontSize: 11,
                          }}
                        >
                          {numVal.toFixed(1)}%
                        </span>
                      </td>
                    );
                  }

                  // Numeric columns get heat cells. Gate on the column-level
                  // decision so a single numeric-looking value inside an
                  // identifier column (e.g. a "2024" inside Temporada) does
                  // not render right-aligned while its sibling rows render
                  // left-aligned as text.
                  if (isNumeric && colIsNumericRight[cIdx] && colMax > 0 && conBarras) {
                    return (
                      <td key={cIdx} className="table-widget-cell" style={{ paddingTop: 10, paddingBottom: 10, textAlign: "right" }}>
                        <HeatCell value={numVal} max={colMax} />
                      </td>
                    );
                  }

                  // Sin barras: el número a secas, alineado a la derecha y en
                  // la misma tipografía monoespaciada, para que las columnas
                  // sigan leyéndose en vertical.
                  if (isNumeric && colIsNumericRight[cIdx]) {
                    return (
                      <td
                        key={cIdx}
                        className="table-widget-cell"
                        style={{
                          paddingTop: 10,
                          paddingBottom: 10,
                          textAlign: "right",
                          fontFamily: "var(--font-jetbrains, monospace)",
                          fontSize: 11,
                        }}
                      >
                        {numVal.toLocaleString("es-ES", { maximumFractionDigits: 0 })}
                      </td>
                    );
                  }

                  // String columns: apply toTitleCase when value looks like words
                  const str = String(cell ?? "");
                  const looksLikeWords = str.length > 3 && !/^\d+/.test(str) && /[A-Za-z]/.test(str);
                  return (
                    <td key={cIdx} className="table-widget-cell" style={{ paddingTop: 10, paddingBottom: 10, color: "var(--fg)" }}>
                      {conFoto(cIdx, looksLikeWords ? toTitleCase(str) : formatCellValue(cell))}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
