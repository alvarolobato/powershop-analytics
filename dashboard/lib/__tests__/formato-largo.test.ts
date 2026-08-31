import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import * as path from "node:path";

/**
 * En una tabla despivotada, sumar una columna de LÍNEA multiplica por el
 * número de tallas.
 *
 * `ps_lin_albaranes` y `ps_stock_tienda` tienen una fila por talla, y las
 * columnas del nivel superior se repiten idénticas en cada una. Medido en
 * producción el 2026-08-31:
 *
 *   SUM(ps_lin_albaranes.total_si)  ->  168.172.072 EUR   (real: 38.660.308, x4,35)
 *   SUM(ps_stock_tienda.cc_stock)   ->      754.547        (real:    135.464, x5,6)
 *
 * Una línea con 14 tallas repite su `total_si` catorce veces. No falla: da un
 * número plausible y equivocado, que es lo peor que puede pasar en un panel.
 *
 * El modelo tuvo que descubrirlo con tres consultas de sondeo porque el
 * conocimiento no lo advertía. Ahora lo advierte, y esto evita que un par SQL
 * lo reintroduzca.
 */

/** Columnas de nivel LÍNEA: se repiten por talla, no se suman directamente. */
const COLUMNAS_DE_LINEA: Record<string, string[]> = {
  ps_lin_albaranes: [
    "total_si",
    "recibidas_total",
    "precio_coste",
    "precio_neto_si",
  ],
  ps_stock_tienda: ["cc_stock", "st_stock"],
};

const RAIZ = path.resolve(__dirname, "../../..");

function bloquesSql(fichero: string): string[] {
  const texto = readFileSync(fichero, "utf8");
  return [...texto.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
}

// Sin `grep` externo: recorrer el árbol con fs no depende del shell ni de
// que grep esté disponible con las mismas opciones en CI.
function mdsBajo(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...mdsBajo(p));
    else if (e.name.endsWith(".md")) salida.push(p);
  }
  return salida;
}

const FICHEROS = mdsBajo(path.join(RAIZ, "docs")).filter((f) => {
  const t = readFileSync(f, "utf8");
  return t.includes("ps_lin_albaranes") || t.includes("ps_stock_tienda");
});

describe("no sumar columnas de línea en tablas despivotadas", () => {
  it("encuentra documentos que usan las tablas largas", () => {
    expect(FICHEROS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(FICHEROS)("%s agrega correctamente", (fichero) => {
    const infractores: string[] = [];
    for (const sql of bloquesSql(fichero)) {
      for (const [tabla, columnas] of Object.entries(COLUMNAS_DE_LINEA)) {
        if (!sql.includes(tabla)) continue;
        for (const col of columnas) {
          // SUM sobre la columna de línea, cualificada o no.
          const suma = new RegExp(`SUM\\s*\\(\\s*(?:\\w+\\.)?"?${col}"?`, "i");
          if (!suma.test(sql)) continue;
          // El idioma correcto colapsa ESA columna con MAX antes de sumarla.
          // Comprobar sólo que exista algún MAX en la consulta era demasiado
          // laxo: un MAX sobre otra columna daba el visto bueno.
          const colapsa = new RegExp(
            `MAX\\s*\\(\\s*(?:\\w+\\.)?"?${col}"?`,
            "i",
          );
          if (!colapsa.test(sql)) {
            infractores.push(
              `${tabla}.${col} en: ${sql.slice(0, 90).replace(/\s+/g, " ")}`,
            );
          }
        }
      }
    }
    expect(
      infractores,
      `Suma de una columna de LÍNEA sin colapsar primero -- multiplica por el ` +
        `número de tallas:\n${infractores.join("\n")}`,
    ).toEqual([]);
  });
});
