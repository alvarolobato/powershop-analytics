export interface Season {
  code: string;
  label: string;
  /**
   * Rango de fechas de la temporada, cuando el convenio permite deducirlo con
   * certeza. `null` cuando no: un rango inventado filtra datos en silencio,
   * que es exactamente la clase de fallo que este fichero causó.
   */
  from: string | null;
  to: string | null;
}

/**
 * Convierte un código de temporada de `ps_articulos.clave_temporada` en algo
 * mostrable. NUNCA devuelve null para un código no vacío.
 *
 * Historia: la versión anterior sólo aceptaba `^(PV|OI)\d{2}$` y devolvía null
 * para todo lo demás; `/api/seasons` descarta los null, así que las temporadas
 * desaparecían del filtro sin un solo error. Y el convenio `PV`/`OI` NO es el
 * que usan los datos: medido contra producción el 2026-08-31, los 64 códigos
 * vivos son V26/I25 (letra + año), numéricos 74–99 heredados pero con venta
 * reciente (el 99 lleva 26.576 líneas en 2025-26), M-prefijados de mayorista
 * (M80..M99, MV25, MI24) y sueltos como OUT, BA, TE, TEKG, TEYD. Ninguno casa
 * con PV/OI, así que el filtro tiraba prácticamente todo.
 *
 * De ahí la regla: ante un código que no se sabe interpretar, se muestra tal
 * cual. Un código feo en el desplegable es un problema cosmético; un código que
 * falta es dato inalcanzable.
 */
export function parseSeason(code: string): Season | null {
  const raw = (code ?? "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();

  // ── PV26 / OI25: el convenio que esperaba la versión anterior. Se conserva
  //    por si aparece, aunque hoy no está en los datos.
  const pvoi = /^(PV|OI)(\d{2})$/.exec(upper);
  if (pvoi) {
    const year = 2000 + parseInt(pvoi[2], 10);
    return pvoi[1] === "PV"
      ? { code: upper, label: `Primavera-Verano ${year}`, from: `${year}-02-01`, to: `${year}-08-31` }
      : { code: upper, label: `Otoño-Invierno ${year}`, from: `${year}-09-01`, to: `${year + 1}-01-31` };
  }

  // ── V26 / I25, y sus versiones mayoristas MV26 / MI25.
  //
  //    NO se deduce rango de fechas. Una temporada se empieza a vender ANTES de
  //    su año nominal —V26 registra su primera venta el 2025-12-06— así que
  //    cualquier rango que pusiéramos aquí recortaría el arranque. Para filtrar
  //    por temporada se usa la clave, no las fechas.
  const vi = /^(M?)([VI])(\d{2})$/.exec(upper);
  if (vi) {
    const mayorista = vi[1] === "M";
    const estacion = vi[2] === "V" ? "Verano" : "Invierno";
    const year = 2000 + parseInt(vi[3], 10);
    return {
      code: upper,
      label: `${estacion} ${year}${mayorista ? " (mayorista)" : ""}`,
      from: null,
      to: null,
    };
  }

  // ── Numéricos heredados (74–99) y sus variantes M99 / A99.
  //
  //    No se traduce a año: son códigos opacos que siguen vivos —el 99 tiene
  //    26.576 líneas de venta en 2025-26—, así que llamarlo "1999" mentiría.
  const numerico = /^([MA]?)(\d{2})$/.exec(upper);
  if (numerico) {
    const prefijo = numerico[1] === "M" ? " (mayorista)" : numerico[1] === "A" ? " (A)" : "";
    return {
      code: upper,
      label: `Temporada ${numerico[2]}${prefijo}`,
      from: null,
      to: null,
    };
  }

  // ── Todo lo demás (OUT, OU, BA, TE, TEKG, TEYD, y lo que venga mañana).
  //    Se muestra tal cual en vez de desaparecer.
  return { code: upper, label: raw, from: null, to: null };
}
