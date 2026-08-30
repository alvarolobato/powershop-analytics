/**
 * Guardián: toda resta `SUM(..) FILTER - SUM(..) FILTER` lleva COALESCE en
 * AMBOS lados.
 *
 * `SUM(x) FILTER (WHERE NOT entrada)` sobre cero filas devuelve NULL, no 0, y
 * `X - NULL` es NULL. Un periodo sin devoluciones -- lo normal en la mayoría de
 * tiendas y días -- anula la métrica entera. No da error: compila, se ejecuta y
 * devuelve blanco. Y como NULL ordena PRIMERO en `ORDER BY ... DESC`, un "top
 * tiendas" se corona con las filas vacías.
 *
 * Medido en producción sobre un solo día: 6 de 23 tiendas en NULL.
 *
 * Esta clase de fallo ya ha vuelto dos veces (una en el TypeScript, otra en las
 * MDs de conocimiento), así que se guarda en vez de confiar en la revisión.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..");

/** Ficheros donde vive SQL que el LLM copia o que la app ejecuta. */
function ficherosConSql(): string[] {
  const salida: string[] = [];
  const visitar = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === ".git" || e === ".next" || e === "__snapshots__") continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) visitar(p);
      else if (/\.(md|ts)$/.test(e) && !/\.test\.ts$/.test(e)) salida.push(p);
    }
  };
  visitar(join(RAIZ, "docs"));
  visitar(join(RAIZ, "dashboard", "lib"));
  // dashboard/app faltaba, y es justo donde vive api/home/route.ts -- por eso
  // este guardián no vio ni la precedencia ni los agregados sin firmar.
  visitar(join(RAIZ, "dashboard", "app"));
  return salida;
}

/** Avanza hasta el índice siguiente al ')' que cierra el '(' en `i`. */
function cierraParen(s: string, i: number): number {
  let d = 0;
  for (; i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")" && --d === 0) return i + 1;
  }
  return -1;
}

/** Devuelve [inicio, fin) del próximo `SUM(...) FILTER (...)`, o null. */
function proximoAgregado(s: string, desde: number): [number, number] | null {
  const re = /\bSUM\s*\(/gi;
  re.lastIndex = desde;
  const m = re.exec(s);
  if (!m) return null;
  const finSum = cierraParen(s, m.index + m[0].length - 1);
  if (finSum < 0) return null;
  const filtro = /^\s*FILTER\s*\(/i.exec(s.slice(finSum));
  if (!filtro) return proximoAgregado(s, m.index + m[0].length);
  const finFiltro = cierraParen(s, finSum + filtro[0].length - 1);
  if (finFiltro < 0) return null;
  return [m.index, finFiltro];
}

function restasSinCoalesce(texto: string): string[] {
  const fallos: string[] = [];
  let i = 0;
  for (;;) {
    const a = proximoAgregado(texto, i);
    if (!a) break;
    const [ini, fin] = a;
    const guion = /^\s*-\s*/.exec(texto.slice(fin));
    if (!guion) {
      i = fin;
      continue;
    }
    const b = proximoAgregado(texto, fin + guion[0].length);
    if (!b || b[0] !== fin + guion[0].length) {
      i = fin;
      continue;
    }
    // El lado izquierdo va desnudo si justo antes no hay un COALESCE( abierto.
    const antes = texto.slice(Math.max(0, ini - 12), ini);
    if (!/COALESCE\s*\($/i.test(antes)) fallos.push(texto.slice(ini, b[1]).slice(0, 160));
    i = b[1];
  }
  return fallos;
}

describe("patrón neto de devoluciones", () => {
  it("ninguna resta SUM..FILTER queda sin COALESCE en los dos lados", () => {
    const infractores: string[] = [];
    for (const f of ficherosConSql()) {
      // knowledge.ts y knowledge-index.ts son generados: su fuente son las MDs,
      // que este mismo test ya revisa. Señalarlos duplica cada fallo.
      if (/knowledge(-index)?\.ts$/.test(f)) continue;
      for (const mal of restasSinCoalesce(readFileSync(f, "utf8"))) {
        infractores.push(`${relative(RAIZ, f)}: ${mal}`);
      }
    }
    expect(
      infractores,
      `Restas sin COALESCE en ambos lados (NULL se come la métrica y ordena primero):\n${infractores.join("\n")}`,
    ).toEqual([]);
  });

  it("detecta el patrón malo cuando se le presenta", () => {
    const malo = `SELECT SUM(v.total_si) FILTER (WHERE v.entrada) - SUM(v.total_si) FILTER (WHERE NOT v.entrada) AS neto`;
    expect(restasSinCoalesce(malo)).toHaveLength(1);
  });

  it("acepta el patrón correcto", () => {
    const bueno = `SELECT COALESCE(SUM(v.total_si) FILTER (WHERE v.entrada), 0) - COALESCE(SUM(v.total_si) FILTER (WHERE NOT v.entrada), 0) AS neto`;
    expect(restasSinCoalesce(bueno)).toEqual([]);
  });

  it("no se queja de COUNT(*) FILTER, que devuelve 0 y no NULL", () => {
    const cuenta = `SELECT COUNT(*) FILTER (WHERE v.entrada) - COUNT(*) FILTER (WHERE NOT v.entrada) AS n`;
    expect(restasSinCoalesce(cuenta)).toEqual([]);
  });
});

describe("precedencia del ticket medio", () => {
  // `A - B / C` es `A - (B/C)`. Al quitar un COALESCE externo que hacía de
  // agrupador, el numerador se quedó sin paréntesis y el ticket medio salió
  // ×3.653: 60.647,16 € en vez de 16,60 € (semana 17-24 ago 2026, producción).
  // Es literalmente la cifra de ventas de la semana etiquetada "ticket medio".
  it("la resta neta que va sobre una división está entre paréntesis", () => {
    const infractores: string[] = [];
    for (const f of ficherosConSql()) {
      if (/knowledge(-index)?\.ts$/.test(f)) continue;
      const t = readFileSync(f, "utf8");
      // El hueco entre la resta y la barra se captura aparte: si el numerador
      // está agrupado, ahí aparece el `)` que lo cierra. Mirar el final del
      // match no sirve -- las dos formas acaban en `)` (el del propio
      // COALESCE), igual que mirar el `(` de delante da por bueno `ROUND(`.
      const re =
        /COALESCE\([^\n]*FILTER[^\n]*\),\s*0\)\s*-\s*COALESCE\([^\n]*FILTER[^\n]*\),\s*0\)([\s\S]{0,24}?)\//g;
      for (const m of t.matchAll(re)) {
        if (!m[1].includes(")")) {
          infractores.push(`${relative(RAIZ, f)}: ${m[0].slice(0, 120).replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(
      infractores,
      `Resta neta dividida sin paréntesis -- A - B/C no es (A-B)/C:\n${infractores.join("\n")}`,
    ).toEqual([]);
  });
});

describe("agregados de dinero de la home", () => {
  // El PR quitó `WHERE entrada = true` del WHERE pero dejó `SUM(total_si)` a
  // pelo en el SELECT, así que las devoluciones pasaron de ignorarse a SUMARSE
  // -- peor que antes. Medido en producción, YTD a 2026-08-29: 2.089.744,25 €
  // en vez de 1.728.460,89 €, cuando `main` daba 1.909.102,57 €.
  it("ninguna suma de dinero queda sin signo", () => {
    const ruta = join(RAIZ, "dashboard", "app", "api", "home", "route.ts");
    const texto = readFileSync(ruta, "utf8");
    const infractores: string[] = [];

    // Un alias puede apuntar a una tabla derivada que YA aplica el signo
    // (`... ) lv ON ...`). Sumarlo a pelo es entonces lo correcto: volver a
    // firmarlo lo anularía. Sin esta distinción el guardián señalaría como
    // fallo justo la forma correcta.
    const aliasDerivados = new Set(
      [...texto.matchAll(/\)\s*(\w+)\s+ON\b/g)].map((m) => m[1]),
    );

    texto.split("\n").forEach((linea, i) => {
      if (!/SUM\(/.test(linea)) return;
      if (!/\b(total_si|total_coste_si)\b/.test(linea)) return;
      // Firmadas: llevan `entrada` en la propia línea (CASE o FILTER).
      // `ABS(total_si)` bajo `entrada=false` es la métrica de devoluciones,
      // positiva a propósito.
      if (/entrada/.test(linea)) return;
      const alias = /SUM\((\w+)\.(?:total_si|total_coste_si)\)/.exec(linea)?.[1];
      if (alias && aliasDerivados.has(alias)) return;
      infractores.push(`route.ts:${i + 1}: ${linea.trim().slice(0, 120)}`);
    });
    expect(
      infractores,
      `Sumas de dinero sin signo -- las devoluciones se suman en vez de restarse:\n${infractores.join("\n")}`,
    ).toEqual([]);
  });
});

describe("recuento de tickets", () => {
  // `COUNT(DISTINCT reg_ventas)` sin filtrar cuenta las devoluciones como
  // tickets. Ferrol, 2026-08-29: la tabla de tiendas mostraba 46 tickets y
  // 25,67 € de ticket medio, mientras el KPI "Tickets" de la MISMA página
  // decía 37 y 31,91 €. Dos cifras distintas para lo mismo.
  it("todo recuento de tickets filtra por entrada", () => {
    const infractores: string[] = [];
    for (const f of ficherosConSql()) {
      if (/knowledge(-index)?\.ts$/.test(f)) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((linea, i) => {
          const limpia = linea.trim();
          // Comentarios (// en TS, > en MD) hablan del patrón, no lo ejecutan.
          if (limpia.startsWith("//") || limpia.startsWith("*") || limpia.startsWith(">")) return;
          if (!/COUNT\(DISTINCT\s+\w*\.?reg_ventas\)/.test(linea)) return;
          if (/FILTER/.test(linea)) return;
          // Un WHERE con `entrada` en la misma línea también sirve.
          if (/\bentrada\b/.test(linea)) return;
          infractores.push(`${relative(RAIZ, f)}:${i + 1}: ${linea.trim().slice(0, 110)}`);
        });
    }
    expect(
      infractores,
      `Recuentos de tickets que incluyen devoluciones:\n${infractores.join("\n")}`,
    ).toEqual([]);
  });
});

describe("FK mayorista", () => {
  // Las líneas mayoristas unen por el ID de registro de 4D (`reg_factura` /
  // `reg_albaran`), NUNCA por el número visible: medido contra el 4D vivo,
  // 311/311 casan con `RegFactura` y 0/311 con `NFactura`, que además no es
  // único (19.351 cabeceras, 14.515 valores distintos). El ETL ya se arregló,
  // pero el join equivocado sobrevivió en un par de ejemplo -- que es lo que
  // copia el modelo.
  it("ningún ejemplo une líneas con cabecera por el número visible", () => {
    const infractores: string[] = [];
    // Se escanea el fichero entero, no línea a línea: un join partido en dos
    // líneas se escapaba. El alias puede ir entrecomillado y llevar espacios
    // alrededor del punto, así que ambos son opcionales.
    // Los dos órdenes. El corpus escribe sistemáticamente la cabecera primero
    // (`ON v."reg_ventas" = lv."num_ventas"`), así que exigir `num_*` a la
    // izquierda dejaba pasar justo la forma más probable. El lado puede ser un
    // nombre de tres partes (`"public"."ps_gc_facturas"."n_factura"`) y llevar
    // un cast, de ahí que el prefijo sea repetible y el cast opcional.
    const REF = String.raw`(?:"?\w+"?\s*\.\s*)*`;
    const CAST = String.raw`(?:::\s*\w+)?`;
    const NUM = String.raw`${REF}"?num_(?:factura|albaran)"?${CAST}`;
    const VIS = String.raw`${REF}"?n_(?:factura|albaran)"?${CAST}`;
    const JOIN_MALO = new RegExp(
      String.raw`(?:${NUM}\s*=\s*${VIS}|${VIS}\s*=\s*${NUM})`,
      "gi",
    );
    for (const f of ficherosConSql()) {
      if (/knowledge(-index)?\.ts$/.test(f)) continue;
      const texto = readFileSync(f, "utf8");
      for (const m of texto.matchAll(JOIN_MALO)) {
        const linea = texto.slice(0, m.index).split("\n").length;
        infractores.push(`${relative(RAIZ, f)}:${linea}: ${m[0].replace(/\s+/g, " ")}`);
      }
    }
    expect(
      infractores,
      `Join mayorista por el número visible (no único, 0 % de coincidencia):\n${infractores.join("\n")}`,
    ).toEqual([]);
  });
});

/** Quita comentarios SQL y JS: un filtro comentado no filtra nada. */
function sinComentarios(texto: string): string {
  // Se conservan los saltos de línea: si un comentario de bloque se colapsara
  // a un espacio, todos los números de línea posteriores saldrían desplazados
  // y el test señalaría un sitio que no es.
  const enBlanco = (t: string) => t.replace(/[^\n]/g, " ");
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, enBlanco) // bloque, en ambos lenguajes
    .replace(/--[^\n]*/g, enBlanco) // línea SQL
    .replace(/\/\/[^\n]*/g, enBlanco); // línea JS
}

/**
 * Trocea un fichero en las consultas SQL que contiene.
 *
 * Historial de fallos de esta función, todos encontrados ejecutándola:
 *  - una ventana de N caracteres alcanzaba el filtro de la consulta SIGUIENTE
 *    (en `sql-pairs.md` van pegadas);
 *  - sólo reconocía vallas ```sql, no ```postgresql ni las que no llevan
 *    lenguaje;
 *  - en `.ts` partía por comillas invertidas, así que un backtick suelto
 *    dentro de un comentario desincronizaba el emparejado y ocultaba el
 *    literal siguiente entero;
 *  - un `${...}` con su propio literal dentro partía el bloque en dos y
 *    separaba el `FROM` de su filtro.
 *
 * De ahí el orden: primero fuera los comentarios, luego fuera el contenido de
 * las interpolaciones, y sólo entonces trocear.
 */
function bloquesSql(texto: string, fichero: string): { sql: string; linea: number }[] {
  const bloques: { sql: string; linea: number }[] = [];
  const limpio = sinComentarios(texto);
  if (/\.md$/.test(fichero)) {
    for (const m of limpio.matchAll(/```[a-z]*\n([\s\S]*?)```/gi)) {
      bloques.push({ sql: m[1], linea: limpio.slice(0, m.index).split("\n").length });
    }
    return bloques;
  }
  // `${...}` con anidamiento equilibrado: se vacía para que un literal interno
  // no rompa el troceado por comillas invertidas.
  const sinInterp = limpio.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, " ");
  for (const m of sinInterp.matchAll(/`([\s\S]*?)`/g)) {
    bloques.push({ sql: m[1], linea: sinInterp.slice(0, m.index).split("\n").length });
  }
  // SQL en cadenas normales: `dashboard/app/api/seasons/route.ts` lo hace.
  for (const m of sinInterp.matchAll(/"((?:SELECT|WITH)[\s\S]*?)"/gi)) {
    bloques.push({ sql: m[1], linea: sinInterp.slice(0, m.index).split("\n").length });
  }
  return bloques;
}

describe("asientos de inventario en traspasos", () => {
  // `ps_traspasos.tipo` = 'Apertura' / 'Inventario Parcial' no son traspasos
  // entre tiendas sino asientos de inventario, y DOMINAN la tabla: 247.502 +
  // 739 filas sobre 262.724 (94 %).
  //
  // Y `tipo` es NULLABLE: `tipo NOT IN (...)` con NULL da NULL, así que
  // descarta la fila. Sobre el fixture eso daba 178 filas donde la forma
  // correcta da 248 -- y con el fixture anterior, que no poblaba `tipo`,
  // devolvía CERO y ningún test se enteraba. La forma obligatoria es
  // `COALESCE(tipo,'') NOT IN (...)`.
  it("todo análisis de movimiento entre tiendas los excluye, sin perder los NULL", () => {
    const infractores: string[] = [];
    for (const f of ficherosConSql()) {
      if (/knowledge(-index)?\.ts$/.test(f)) continue;
      const texto = readFileSync(f, "utf8");
      for (const { sql, linea } of bloquesSql(texto, f)) {
        // Posición de tabla, incluido el join por coma y `public.` sin comillas.
        const ref = new RegExp(
          // El alias NO puede ser una palabra clave: `FROM ps_traspasos WHERE`
          // hacía capturar "WHERE" como alias y exigir luego `WHERE.tipo`,
          // marcando como infractora una consulta correcta.
          String.raw`(?:FROM|JOIN|,)\s+(?:"?public"?\s*\.\s*)?"?ps_traspasos"?(?:\s+(?:AS\s+)?(?!(?:WHERE|GROUP|ORDER|LIMIT|JOIN|LEFT|RIGHT|INNER|ON|UNION|HAVING|WINDOW|OFFSET|FETCH|CROSS|FULL)\b)"?(\w+)"?)?`,
          "i",
        );
        const m = ref.exec(sql);
        if (!m) continue;
        // Agrupar por `tipo` es el caso en que el desglose ES el objetivo.
        // \b para no aceptar `prototipo`, y sin cruzar a la siguiente cláusula.
        if (/GROUP BY[^)]*\btipo\b/i.test(sql)) continue;

        // El filtro tiene que ser sobre ESTA tabla, no sobre otra de un CTE
        // vecino: se exige el alias (o el nombre pelado si no lo hay).
        const a = m[1] ? `"?${m[1]}"?\\s*\\.\\s*` : "(?:\\w+\\s*\\.\\s*)?";
        const col = String.raw`${a}"?tipo"?`;
        const seguro = [
          // COALESCE(t.tipo,'') NOT IN ('Apertura', ...) -- la forma correcta
          new RegExp(String.raw`COALESCE\s*\(\s*${col}[^)]*\)\s*NOT\s+IN\s*\([^)]*Apertura`, "i"),
          // t.tipo <> 'Apertura' AND t.tipo <> 'Inventario Parcial'
          new RegExp(String.raw`${col}\s*(?:<>|!=)\s*'Apertura'`, "i"),
          // lista blanca: sólo los tipos que SON movimiento real
          new RegExp(String.raw`${col}\s+IN\s*\(`, "i"),
        ];
        if (seguro.some((r) => r.test(sql))) continue;
        infractores.push(`${relative(RAIZ, f)}:${linea}`);
      }
    }
    expect(
      [...new Set(infractores)],
      `Consultas de traspasos sin excluir los asientos de inventario (94 % de la tabla):\n${infractores.join("\n")}`,
    ).toEqual([]);
  });
});

describe("fecha efectiva del albarán mayorista", () => {
  // Un albarán aún no enviado lleva NULL o un centinela anterior a 2000 en
  // `fecha_envio`. Como `NULL >= fecha` es NULL, filtrar un periodo por
  // `fecha_envio` los descarta en silencio — y son justo los que interesan en
  // "albaranes pendientes de facturar". Sobre tres albaranes sembrados (uno
  // enviado, uno sin enviar, uno con centinela), la forma antigua devolvía 1 y
  // la correcta 3.
  //
  // Regla: `CASE WHEN fecha_envio >= DATE '2000-01-01' THEN fecha_envio ELSE
  // fecha_valor END`.
  it("ninguna consulta filtra u ordena por fecha_envio a secas", () => {
    const infractores: string[] = [];
    for (const f of ficherosConSql()) {
      if (/knowledge(-index)?\.ts$/.test(f)) continue;
      const texto = readFileSync(f, "utf8");
      for (const { sql, linea } of bloquesSql(texto, f)) {
        if (!/fecha_envio/.test(sql)) continue;
        // Con la fecha efectiva presente, la consulta ya sigue la regla.
        if (/CASE\s+WHEN[^]*?fecha_envio[^]*?fecha_valor/i.test(sql)) continue;
        // Sólo molesta cuando se usa para acotar u ordenar; proyectarla como
        // columna informativa junto a la efectiva es legítimo.
        if (!/(WHERE|AND|ORDER BY|BETWEEN)[^;]*fecha_envio/i.test(sql)) continue;
        infractores.push(`${relative(RAIZ, f)}:${linea}`);
      }
    }
    expect(
      [...new Set(infractores)],
      `Consultas que acotan por fecha_envio sin la fecha efectiva (pierden los albaranes sin enviar):\n${infractores.join("\n")}`,
    ).toEqual([]);
  });
});

