import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
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

const FICHEROS = execSync(
  `grep -rl 'ps_lin_albaranes\\|ps_stock_tienda' '${RAIZ}/docs' --include='*.md'`,
)
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean);

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
          // El idioma correcto colapsa antes con MAX por la clave de línea.
          // Si no hay MAX en la consulta, se está sumando la repetición.
          if (!/\bMAX\s*\(/i.test(sql)) {
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
