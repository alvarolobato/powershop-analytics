/**
 * Conversión de los datos de un widget a CSV abrible en Excel.
 *
 * Las decisiones de formato están tomadas para el Excel del dueño, que es
 * español, y NO son las de un CSV canónico. Merece la pena dejarlas escritas
 * porque son contraintuitivas:
 *
 * - **Separador `;`, no coma.** Excel en configuración regional española usa el
 *   punto y coma como separador de lista. Un CSV separado por comas se abre con
 *   todo apelotonado en la primera columna, que es exactamente la queja que
 *   provoca "esto no funciona".
 * - **Decimales con coma.** Por lo mismo: `1234,56` lo reconoce como número y
 *   `1234.56` lo deja como texto, así que no se puede sumar.
 * - **BOM al principio.** Sin él, Excel interpreta el fichero como Latin-1 y
 *   los acentos salen rotos ("Módulo" -> "MÃ³dulo").
 *
 * Es decir: el objetivo no es un CSV bonito, es un fichero que al abrirlo con
 * doble clic se vea bien y con los números sumables.
 */

/** Separador de campos. Ver el porqué arriba. */
const SEPARADOR = ";";

/** Marca de orden de bytes UTF-8, para que Excel no adivine mal la codificación. */
const BOM = "\uFEFF";

/**
 * Escapa un valor para una celda CSV.
 *
 * Se entrecomilla cuando el valor contiene el separador, comillas o saltos de
 * línea; las comillas internas se duplican, que es lo que dice el RFC 4180 y lo
 * que Excel espera.
 */
export function escaparCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return "";

  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return "";
    // Decimal con coma. `toString()` y no `toLocaleString()`: este último mete
    // separador de millares ("1.234,56"), que Excel lee como texto.
    return String(valor).replace(".", ",");
  }

  if (typeof valor === "boolean") return valor ? "sí" : "no";

  if (valor instanceof Date) return valor.toISOString().slice(0, 10);

  const texto = String(valor);

  // Postgres devuelve NUMERIC y BIGINT como TEXTO, no como number de JS.
  // Comprobado contra produccion: `SELECT total_si, unidades` da
  // `["0.00","1.00"]`, y solo los int4 (como un COUNT(*)::int) llegan como
  // number. Sin esto, todas las columnas de dinero y cantidades salian con
  // punto decimal y el Excel espanol las leia como TEXTO NO SUMABLE -- que es
  // exactamente lo que este modulo dice venir a evitar.
  //
  // Se convierten SOLO las que llevan parte decimal. Un entero en texto ya se
  // escribe igual convertido o no, y dejarlo intacto protege a las referencias
  // que son todo digitos: convertirlas no cambiaria el CSV, pero la regla mas
  // estrecha es la que menos sorpresas da.
  if (/^-?\d+\.\d+$/.test(texto)) {
    return texto.replace(".", ",");
  }

  if (
    texto.includes(SEPARADOR) ||
    texto.includes('"') ||
    texto.includes("\n") ||
    texto.includes("\r")
  ) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/** Convierte columnas y filas en el texto completo del CSV, con BOM. */
export function aCsv(columnas: string[], filas: unknown[][]): string {
  const lineas = [
    columnas.map(escaparCelda).join(SEPARADOR),
    ...filas.map((fila) => fila.map(escaparCelda).join(SEPARADOR)),
  ];
  // CRLF: es lo que espera Excel en Windows y lo que manda el RFC 4180.
  return BOM + lineas.join("\r\n");
}

/**
 * Convierte un título de widget en un nombre de fichero utilizable.
 *
 * Sin acentos ni caracteres que Windows rechaza (`\ / : * ? " < > |`), porque
 * el fichero acaba en el disco de alguien.
 */
export function nombreDeFichero(titulo: string, fecha: Date): string {
  const base = (titulo || "datos")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .toLowerCase();
  const dia = fecha.toISOString().slice(0, 10);
  return `${base || "datos"}-${dia}.csv`;
}
