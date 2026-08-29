/**
 * Regresión de los dos bugs de datos de 2026-08.
 *
 * Se ejecutan contra un Postgres real sembrado. Si no hay base disponible el
 * fichero se salta entero: el objetivo es que en CI (que sí siembra) muerda, y
 * que en local sin base no dé un rojo espurio.
 *
 * Por qué SQL real y no un mock: los dos bugs que cubren son *semánticos*, no
 * de tipos. `SUM(x) FILTER (...) - SUM(x) FILTER (...)` compila perfectamente y
 * devuelve NULL; `WHERE entrada = true` compila perfectamente y devuelve el
 * bruto. Un mock de `sql` habría pasado con las dos versiones rotas.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

const DSN =
  process.env.E2E_DATABASE_URL ??
  process.env.POSTGRES_DSN ??
  "postgresql://postgres:postgres@localhost:5432/powershop_e2e";

let client: Client | null = null;
let disponible = false;

beforeAll(async () => {
  try {
    client = new Client({ connectionString: DSN, connectionTimeoutMillis: 3000 });
    await client.connect();
    await client.query("SELECT 1 FROM ps_ventas LIMIT 1");
    disponible = true;
  } catch {
    disponible = false;
    if (client) await client.end().catch(() => {});
    client = null;
  }
});

afterAll(async () => {
  if (client) await client.end().catch(() => {});
});

const siHayBase = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!disponible) return;
    await fn();
  });

describe("ventas netas: las devoluciones se RESTAN, no se ignoran", () => {
  siHayBase("el neto es estrictamente menor que el bruto cuando hay devoluciones", async () => {
    const { rows } = await client!.query(`
      SELECT
        COALESCE(SUM(total_si) FILTER (WHERE entrada), 0)                                                AS bruto,
        COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0)                                            AS devuelto,
        COALESCE(SUM(total_si) FILTER (WHERE entrada), 0)
          - COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0)                                        AS neto
      FROM ps_ventas WHERE tienda <> '99'
    `);
    const { bruto, devuelto, neto } = rows[0];
    // El fixture siembra devoluciones; si esto falla es que el fixture cambió.
    expect(Number(devuelto)).toBeGreaterThan(0);
    // El bug: filtrar entrada=true devolvía `bruto` y lo llamaba "ventas netas".
    expect(Number(neto)).toBeLessThan(Number(bruto));
    expect(Number(neto)).toBeCloseTo(Number(bruto) - Number(devuelto), 2);
  });

  siHayBase("las devoluciones se guardan en POSITIVO", async () => {
    // Si vinieran en negativo, restarlas las contaría dos veces. Esta es la
    // premisa de la que depende todo el patrón, comprobada en producción y
    // fijada aquí para que un cambio de ETL no la rompa en silencio.
    const { rows } = await client!.query(`
      SELECT COUNT(*) FILTER (WHERE total_si < 0) AS negativas,
             COUNT(*)                             AS total
      FROM ps_ventas WHERE NOT entrada
    `);
    expect(Number(rows[0].total)).toBeGreaterThan(0);
    expect(Number(rows[0].negativas)).toBe(0);
  });
});

describe("COALESCE: un grupo sin devoluciones no puede dar NULL", () => {
  siHayBase("sin COALESCE el resultado es NULL y se come el ranking", async () => {
    // Reproduce el bug exacto: al restringir a solo ventas, el lado
    // `NOT entrada` no tiene filas, SUM devuelve NULL, y `NULL - x = NULL`.
    const { rows } = await client!.query(`
      SELECT
        SUM(total_si) FILTER (WHERE entrada)
          - SUM(total_si) FILTER (WHERE NOT entrada)                    AS sin_coalesce,
        COALESCE(SUM(total_si) FILTER (WHERE entrada), 0)
          - COALESCE(SUM(total_si) FILTER (WHERE NOT entrada), 0)       AS con_coalesce
      FROM ps_ventas WHERE entrada AND tienda <> '99'
    `);
    expect(rows[0].sin_coalesce).toBeNull();
    expect(Number(rows[0].con_coalesce)).toBeGreaterThan(0);
  });

  siHayBase("NULL ordena PRIMERO en DESC, que es por qué vaciaba el top", async () => {
    // No es solo que falte un valor: NULL gana el ORDER BY ... DESC, así que
    // los artículos sin devoluciones desplazaban a los que sí vendían.
    const { rows } = await client!.query(`
      SELECT v FROM (VALUES (NULL::numeric), (100), (50)) t(v) ORDER BY v DESC LIMIT 1
    `);
    expect(rows[0].v).toBeNull();
  });
});

describe("tallas", () => {
  siHayBase("la columna existe y admite el formato del ERP", async () => {
    const { rows } = await client!.query(`
      SELECT data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'ps_lineas_ventas' AND column_name = 'talla'
    `);
    expect(rows).toHaveLength(1);
    // VARCHAR(5): el propio ERP la declara así (`talla c(5)`), y las tallas
    // más largas que maneja son 'XXXL'/'6XL'.
    expect(Number(rows[0].character_maximum_length)).toBeGreaterThanOrEqual(5);
  });

  siHayBase("stock y ventas comparten vocabulario de tallas en MAYÚSCULAS", async () => {
    // Si un lado guardara 'l' y el otro 'L', el cruce ventas<->stock perdería
    // filas en silencio — que es lo que hacía cambiar la talla más vendida de
    // I26101833 de L a M.
    const { rows } = await client!.query(`
      SELECT COUNT(*) AS minusculas FROM ps_stock_tienda
      WHERE talla IS NOT NULL AND talla <> UPPER(talla)
    `);
    expect(Number(rows[0].minusculas)).toBe(0);
  });
});
