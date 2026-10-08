# Propuesta: fotos de artículo en el dashboard (hover + ampliar)

**Estado**: implementado (rama `feat/fotos-de-articulo`). Lo que quedó distinto del plan está en [D-068](../decisions/D-068-fotos-por-convencion-de-ruta.md) y en la descripción del PR.
**Dónde se implementa**: en la máquina de **desarrollo** (otra distinta de la de producción).
**Decisión asociada**: D-068 (siguiente ID libre; ojo, existe un `D-065` duplicado heredado — comprobar el rango antes de crear el fichero).

---

## 1. Qué se quiere

1. Mostrar la foto de un artículo **cuando el usuario la pida explícitamente**.
2. **Hover**: siempre que se muestre un código, referencia o descripción de artículo, al pasar el ratón aparece la foto; al hacer click se amplía en grande.
3. Por defecto **no** se muestran fotos: ocupan demasiado espacio visual.
4. Cada artículo puede tener **hasta 4 fotos**.

---

## 2. La convención de ruta (el corazón del diseño)

En 4D, `Articulos` tiene `Path`, `Path2`, `Path3`, `Path4` con valores de la forma:

```
W:\PS_Ficheros\Imagenes\{slot}\{codigo}.jpg        slot ∈ {1,2,3,4}
```

`W:` es la unidad mapeada al share de ficheros del servidor PowerShop. El host, el share y las credenciales de montaje viven en **`FOTOS_SMB_URL`**, en el `.env` centralizado (`~/.config/powershop-analytics/.env`, git-ignored). Este repo es público: no se escriben aquí ni el host ni el modo de acceso.

Los directorios `1`, `2`, `3`, `4` contienen respectivamente la **1ª, 2ª, 3ª y 4ª foto** de cada artículo.

**Esos campos de la BD no se usan ni se sincronizan.** Son pura convención derivada del código (ver §3), así que la ruta se **reconstruye** siempre:

```
{FOTOS_DIR}/{slot}/{codigo}.jpg
```

Consecuencias, y son las que simplifican todo:

- **No se crea ninguna tabla nueva.** Saber si un artículo tiene foto es `stat()` sobre el espejo local.
- **No se toca el ETL.** Ni `etl/schema/init.sql`, ni `etl/main.py`, ni `etl/sync/*`, ni `config/schema.yaml`.
- **Nunca se lista un directorio** en el camino de una petición. Solo acceso directo por ruta derivada.

---

## 3. Hechos medidos que justifican el plan

Todo esto está verificado contra el servidor y la BD reales (2026-10-08). Está aquí para que quien implemente no tenga que re-descubrirlo.

### 3.1 La base de datos no aporta nada sobre las fotos

- Se extrajeron los **171.928** valores (42.982 artículos × 4 paths) y se compararon uno a uno contra el patrón derivado: **171.928 coinciden exactos, 0 desviaciones**. Ningún artículo tiene un enlace a otra carpeta ni a otro nombre de fichero.
- Los paths están rellenos **aunque el fichero no exista** (el primer artículo, código 169, tiene los 4 paths y ninguna foto en disco).
- `Articulos.TieneImagen` es `False` en los 42.982 registros → inservible.
- `Articulos.Imagen`, `Imagen2..4` (tipo 12, Picture/Blob) están **vacíos** (0 filas con `IS NOT NULL`).
- **No existe ningún campo de URL de foto.** Se volcaron los 144 campos de texto del artículo 132374: los únicos con una ruta son `PATH`..`PATH4`. Las únicas columnas no-texto de `Articulos` son `Objeto` y `Promociones` (JSON). Los botones «Asignar URL» / «Asignar URL 1» del formulario de PowerShop no escriben en `Articulos`.
- Barrido de las 325 tablas buscando "clave de artículo + campo de imagen/ruta": las únicas candidatas (`FAMateriales`, `Catalogos`, `FOFotografiaCotejo`, `WebImagenesCarrusel`) están **todas a 0 filas**.
- **Conclusión**: la verdad sobre qué fotos existen está solo en el sistema de ficheros. PowerShop deriva la ruta del código, igual que haremos nosotros.

> **Trampa de 4D SQL**: `COUNT(*)` devuelve **`NULL`**, no `0`, cuando el resultado está vacío. No te fíes de un `COUNT` para concluir "no hay desviaciones"; extrae y compara. (Añadir este gotcha a `docs/skills/data-access.md`.)

#### Los campos son editables — por eso hay una alerta, no una suposición

En una pantalla secundaria del artículo, PowerShop expone los cuatro `PATH IMAGEM` como **campos de texto editables** (y hay botones «F3 Asignar Fotografía», «Asignar URL» y «Asignar URL 1»). Técnicamente, pues, un valor podría dejar de seguir el patrón.

**El dueño confirma que en la práctica nunca se editan a mano y que siempre se sigue la convención**, lo cual concuerda con los 171.928 valores idénticos al patrón. Decisión: **derivar por convención y añadir una alerta de desviación** (§5.3) como seguro barato, en vez de sincronizar los paths al ETL. Consecuencias asumidas:

- Si algún día alguien pusiera una ruta distinta, ese artículo **no mostraría foto**. Degrada en silencio; nunca enseña la foto de otro.
- El chequeo diario avisaría, para reaccionar a mano.

Dato del mismo artículo que conviene no malinterpretar: `Imagenes/1/132374.jpg` **existe** en el share, pero el recuadro de la foto aparecía en blanco en PowerShop. Es un **problema temporal de conexión con `W:`** (confirmado por el dueño), no un dato ausente. Refuerza el diseño: nosotros no dependemos de que una unidad de Windows esté mapeada en el puesto del usuario.

### 3.2 Inventario real

| | |
|---|---|
| Ficheros que cumplen el patrón en `1..4` | 12.666 (6.891 / 3.394 / 2.314 / 67) |
| Tamaño medio por foto | ~278 KB |
| **Espacio total** | **~3,5 GB** |
| Artículos con ≥1 foto | **6.876 de 42.880 (16 %)** |
| Reparto | 1 foto: 3.499 · 2: 1.097 · 3: 2.235 · 4: 67 |
| Ficheros huérfanos (sin artículo) | 42 |

Que solo el 16 % tenga foto es importante para la UI: el indicador de hover **no debe aparecer** en el 84 % restante.

### 3.3 Nombres de fichero: el patrón exacto basta

Todo lo que no cumple `{codigo}.jpg` es redundante o basura:

- `<cod>.1.jpg` (21 en dir 2) y `<cod>.2.jpg` (5 en dir 3): **todos** tienen su `<cod>.jpg` en el mismo directorio.
- `<cod> (n).jpg`: solo 14 en total. En dir 1 son duplicados idénticos en tamaño; donde difieren, **la base es la más reciente** (`144750.jpg` 590 KB 17:00:22 vs `144750 (2).jpg` 507 KB 16:59:28). Gana siempre el nombre exacto.
- Basura: `Thumbs.db`, `desktop.ini`, `A.txt.txt`, `copiar.cmd`, `.jpg`, `141104).JPG`, `145815 .jpg`, `3_143.jpg`.
- `1NO` (298 códigos, 292 también en dir 1) son **las fotos originales que se sobrescribieron**: `132705.jpg` pesa 320 KB y es de feb-2022 en `1NO`, y 187 KB de abr-2025 en dir 1. Hubo un reprocesado masivo (en la raíz del share hay `ImageResizerSetup.exe` y `JPEG-EXIF_autorotate`). **Ignorar.**
- `procesadas` (2.551) y `NUEVAS` (4): flujo de trabajo de quien edita fotos, no siguen el patrón. **Ignorar.**

Coste de atender solo al patrón exacto: se pierden **9 ficheros** de 12.666.

La extensión aparece como `.jpg`, `.JPG` y algún `.jpeg`. En el espejo (APFS, case-insensitive) `{codigo}.jpg` resuelve igual, pero **no lo des por garantizado**: el helper debe probar `.jpg` y, si falla, `.JPG`/`.jpeg`.

### 3.4 Latencias del share por VPN (acceso directo, sin listar, montaje recién hecho)

| operación | mediana | p90 | max |
|---|---|---|---|
| `stat` de foto que existe | 57 ms | 65 ms | 701 ms |
| `stat` de foto que **no** existe | 27 ms | 30 ms | 31 ms |
| los 4 slots de un artículo en paralelo | 56 ms | 59 ms | 152 ms |
| **leer el JPEG completo en frío** | **346 ms** | **5,25 s** | **5,7 s** |
| releer el mismo fichero | 28 ms | 29 ms | 29 ms |

- La cola de 5 s **no depende del tamaño**: un JPEG de 478 KB tardó 217 ms y otro de 474 KB tardó 4,98 s. Es varianza del enlace.
- Los `stat` **no paralelizan**: 65-96/s con 8, 16, 32 o 64 hilos (SMB serializa los metadatos).
- `rsync` medido sobre el montaje: 67 ficheros / 27,7 MB en **2:10** → **0,21 MB/s**; la generación de la lista de ficheros tardó 4,2 s para 71 ficheros.

**Extrapolación**: la primera copia de 3,5 GB son **~4,6 h** (aceptado por el dueño), y el delta nocturno **~15 min**, casi todo enumerando.

**Por qué esto obliga al espejo**: si la app leyera del SMB, un hover podría tardar 5 s. Con espejo local, el `stat` pasa de 57 ms a microsegundos y la lectura a velocidad de disco. La cola de 5 s se queda en el rsync nocturno, donde no molesta a nadie.

---

## 4. Arquitectura

```
Servidor PowerShop · share de ficheros ($FOTOS_SMB_URL) · solo lectura
      │
      │  mount_smbfs -o ro  +  rsync -rt --delete      ← launchd DIARIO, solo en PROD
      ▼
{FOTOS_DIR}/{1,2,3,4}/{codigo}.jpg                      espejo local, ~3,5 GB
      │
      │  bind mount :ro
      ▼
Dashboard (contenedor)
      ├─ POST /api/articulos/fotos      → qué slots existen (stat local, ~µs)
      └─ GET  /api/fotos/{cod}/{slot}   → bytes; ?w=256 → miniatura WebP (caché en disco)
             ▲
      ArticlePhotoHover · PhotoLightbox  ←  TableWidget
```

PostgreSQL solo interviene para traducir **referencia → código** (`ps_articulos.ccrefejofacm → codigo`), con la tabla que ya existe.

---

## 5. Fase 1 — El espejo (solo producción)

### Ficheros nuevos

- `scripts/sync-fotos.sh`
- `scripts/launchd/com.powershop.fotos-sync.plist.template`
- `scripts/install-fotos-sync-launchd.sh`

Las dos plantillas launchd y su instalador se calcan de los que ya existen en `scripts/launchd/` (patrón `com.powershop.claude-token-sync`).

### `scripts/sync-fotos.sh`

```bash
#!/usr/bin/env bash
# Espeja las fotos de articulo del share de PowerShop a disco local.
# Diario via launchd. Solo en produccion. Ver docs/proposals/fotos-de-articulo.md
set -euo pipefail

FOTOS_SMB_URL="${FOTOS_SMB_URL:?define FOTOS_SMB_URL en ~/.config/powershop-analytics/.env}"
FOTOS_SMB_SUBDIR="${FOTOS_SMB_SUBDIR:-PS_Ficheros/Imagenes}"
FOTOS_DEST="${FOTOS_DEST:-$HOME/powershop/data/fotos}"

MOUNT_POINT="$(mktemp -d /tmp/psfotos.XXXXXX)"
cleanup() { umount "$MOUNT_POINT" 2>/dev/null || true; rmdir "$MOUNT_POINT" 2>/dev/null || true; }
trap cleanup EXIT

mount_smbfs -o ro,nobrowse "$FOTOS_SMB_URL" "$MOUNT_POINT"

SRC="$MOUNT_POINT/$FOTOS_SMB_SUBDIR"
copiados=0
for d in 1 2 3 4; do
    # GUARD: si el origen no esta o esta vacio, abortar ANTES de un rsync con
    # --delete. Sin esto, un share caido vaciaria el espejo entero.
    if [ ! -d "$SRC/$d" ]; then
        echo "sync-fotos: $SRC/$d no existe — aborto sin tocar el espejo" >&2
        exit 1
    fi
    if [ -z "$(ls -f "$SRC/$d" 2>/dev/null | grep -v '^\.\{1,2\}$' | head -1)" ]; then
        echo "sync-fotos: $SRC/$d enumera vacio — aborto sin tocar el espejo" >&2
        exit 1
    fi

    mkdir -p "$FOTOS_DEST/$d"
    rsync -rt --delete \
        --include='*.jpg' --include='*.JPG' \
        --include='*.jpeg' --include='*.JPEG' \
        --exclude='*' \
        "$SRC/$d/" "$FOTOS_DEST/$d/"
    copiados=$(( copiados + $(ls -f "$FOTOS_DEST/$d" | grep -vc '^\.\{1,2\}$') ))
done

# Marcador de estado: la app lo lee para avisar si el espejo esta rancio.
printf '{"last_sync":"%s","ficheros":%d}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$copiados" > "$FOTOS_DEST/.last-sync.json"
```

> **El servidor no necesita rsync ni ningún software.** `rsync` se ejecuta en el Mac y copia entre dos rutas locales: el punto de montaje SMB y el espejo. El servidor solo ve lecturas de fichero por SMB. Verificado copiando el directorio 4 (67 ficheros, 27,7 MB) de esta forma. Solo haría falta rsync en el otro extremo si se usara sobre SSH, cosa que no hacemos (y SSH está cerrado).
>
> **Transportes alternativos, por si algún día hace falta**: el servidor tiene **FTP (21) y FTPS implícito (990)** con FileZilla Server 1.3.0, pero **no SFTP** (22 y 2222 cerrados). El FTP rechaza tanto el acceso anónimo como las credenciales del 4D, así que usarlo exigiría credenciales nuevas y medir si de verdad es más rápido que los 0,21 MB/s de SMB. No merece la pena hoy: SMB funciona y la copia inicial es un coste único ya aceptado. Queda como plan B si el acceso SMB se retirase, y entonces la herramienta sería `lftp mirror`, que hace el incremental por tamaño y fecha igual que rsync.

Puntos que no son negociables:

- **`rsync -rt`, no `-a`**: compara tamaño + mtime, que es la señal incremental correcta. Nada de `--checksum`: releería los 3,5 GB por VPN cada noche.
- **El guard antes de `--delete`** es lo que impide que una VPN caída borre el espejo.
- El marcador `.last-sync.json` solo se escribe si todo fue bien (mismo espíritu que D-065: el watermark solo avanza con éxito).
- Los filtros dejan fuera la basura desde el origen. `1NO`, `NUEVAS` y `procesadas` no se recorren.
- Se copian **todos** los `*.jpg` de `1..4`, incluidos los nombres raros; la app solo leerá los del patrón exacto. No pasa nada por tenerlos.

### Cadencia

launchd **diario a la 01:00**. No depende del ETL ni lo bloquea. La primera ejecución tarda ~4,6 h: se lanza a mano una vez y se deja terminar.

### Configuración

En `.env.example`, al final de su bloque:

```bash
# Fotos de articulo (D-068). FOTOS_HOST_DIR es el espejo en el host;
# el contenedor lo ve en /fotos. Solo produccion espeja; en dev, ver
# docs/proposals/fotos-de-articulo.md §8.
FOTOS_SMB_URL=//usuario:clave@HOST/SHARE   # valor real solo en el .env centralizado
FOTOS_HOST_DIR=./data/fotos
```

En **`docker-compose.yml` y `docker-compose.prod.yml`** (los dos, obligatorio: `dashboard/__tests__/compose-parity.test.ts` compara las claves de entorno entre ambos y falla si divergen), en el servicio `dashboard`:

```yaml
    environment:
      FOTOS_DIR: /fotos
      FOTOS_CACHE_DIR: /app/data/fotos-cache
    volumes:
      - ${FOTOS_HOST_DIR:-./data/fotos}:/fotos:ro
      - ./data/dashboard/fotos-cache:/app/data/fotos-cache:rw
```

El espejo entra **read-only**; lo único escribible es la caché de miniaturas.

### 5.3 Alerta de desviación de rutas

**Fichero nuevo**: `scripts/check-fotos-paths.py`

Los campos `PATH IMAGEM` son editables (§3.1). Este chequeo detecta el día en que alguien escriba una ruta que no siga la convención, que es el único escenario en que nuestro diseño dejaría de ver una foto.

```python
#!/usr/bin/env python3
"""Verifica que Articulos.Path..Path4 siguen la convencion derivada del codigo.

Sale 0 si todos cumplen, 1 si hay desviaciones (listandolas). Pensado para
correr a diario junto al espejo de fotos. Ver docs/proposals/fotos-de-articulo.md

NO uses COUNT(*) con un LIKE para esto: en 4D SQL, COUNT(*) devuelve NULL (no 0)
sobre un resultado vacio, asi que un "0 desviaciones" seria indistinguible de un
fallo de la consulta. Hay que extraer los valores y comparar.
"""
ESPERADO = "W:\\PS_Ficheros\\Imagenes\\{slot}\\{codigo}.jpg"
# SELECT Codigo, Path, Path2, Path3, Path4 FROM Articulos
# -> comparar cada valor con ESPERADO.format(slot=n, codigo=codigo)
# -> imprimir las desviaciones y salir 1
```

Lo ejecuta el mismo job launchd, justo después del rsync (ambos necesitan la VPN). Su salida va al log del job; una desviación deja rastro visible sin romper nada.

El coste es bajo: extraer los 42.982 × 4 valores tarda alrededor de un minuto.

### Criterios de aceptación

- **EC-1** *(humano, requiere VPN)*: tras `scripts/sync-fotos.sh`, `find $FOTOS_HOST_DIR -name '*.jpg' | wc -l` ≈ 12.700 y `.last-sync.json` tiene la fecha de hoy.
- **EC-2** *(humano)*: con `FOTOS_SMB_URL` apuntando a un host inexistente, el script falla con código ≠ 0, **no** modifica el espejo y **no** toca `.last-sync.json`.
- **EC-3**: `shellcheck scripts/sync-fotos.sh` limpio.
- **EC-4** *(humano, requiere VPN)*: `scripts/check-fotos-paths.py` sale 0 hoy. *Verified by* un test unitario que le inyecta una fila desviada y comprueba que sale 1 y la lista.

---

## 6. Fase 2 — API

### `dashboard/lib/fotos.ts` (nuevo) — el único sitio que toca el filesystem

```ts
/** Slots validos: 1..4 = 1ª..4ª foto del articulo. */
export const SLOTS = [1, 2, 3, 4] as const;
export type Slot = (typeof SLOTS)[number];

/** Codigos aceptables. Rechaza todo lo que pueda escapar del directorio. */
const CODIGO_RE = /^[A-Za-z0-9._-]{1,40}$/;

/** Ruta absoluta de la foto, o null si el codigo/slot no son validos o no existe.
 *  Prueba .jpg, .JPG y .jpeg (el share mezcla mayusculas). */
export function rutaFoto(codigo: string, slot: number): string | null;

/** Slots que existen en disco para un codigo. [] si ninguno. */
export function slotsDeFoto(codigo: string): Slot[];

/** Igual pero para muchos codigos; usado por el endpoint de lote. */
export function slotsDeFotos(codigos: string[]): Record<string, Slot[]>;

/** Miniatura WebP del ancho pedido, generandola y cacheandola si hace falta. */
export async function miniatura(codigo: string, slot: Slot, w: number): Promise<Buffer>;
```

Reglas de seguridad, en este orden:

1. `CODIGO_RE.test(codigo)` y `slot ∈ {1,2,3,4}`; si no → `null` (el endpoint responde 400).
2. La ruta se compone **solo** con valores ya validados: `join(FOTOS_DIR, String(slot), codigo + ext)`.
3. Cinturón redundante: `resolve(ruta).startsWith(resolve(FOTOS_DIR) + sep)`.

Nunca se interpola el input del usuario sin pasar por la regex. La regex ya excluye `/`, `\` y `..`.

### `POST /api/articulos/fotos` (nuevo)

`dashboard/app/api/articulos/fotos/route.ts`

```
POST { codigos?: string[], refs?: string[] }      // máx 200 de cada
→ 200 {
    porCodigo: { "144750": [1,2,3] },             // slots que existen
    porRef:    { "V26212484": { codigo: "144750", slots: [1,2,3] } }
  }
```

- `codigos` se resuelve con `slotsDeFotos()`: solo `stat` locales. Un lote de 50 artículos = 200 `stat` ≈ 1 ms. **No toca PostgreSQL.**
- `refs` necesita una consulta parametrizada a `ps_articulos` (`ccrefejofacm = ANY($1::text[])`) para obtener el código, y luego el mismo `stat`. Referencia ↔ código es prácticamente 1:1 (42.962 referencias distintas para 42.982 filas); si una referencia diera varios códigos, se devuelve el no anulado con `fecha_modifica` más reciente.
- **No se acepta `descripciones[]`**: la descripción no identifica un artículo (ver §7).
- `Cache-Control: private, max-age=60`.

### `GET /api/fotos/[codigo]/[slot]` (nuevo)

`dashboard/app/api/fotos/[codigo]/[slot]/route.ts`

```
GET /api/fotos/144750/1           → original (image/jpeg)
GET /api/fotos/144750/1?w=256     → miniatura WebP
```

- `w` solo admite la **whitelist {160, 256, 512, 1024}**; cualquier otro valor → 400. Evita que alguien fuerce la generación de tamaños infinitos.
- 404 si el fichero no existe en el espejo.
- `ETag` = `"{bytes}-{mtimeMs}"` del fichero local; `If-None-Match` → 304. `Cache-Control: public, max-age=86400`.
- **Miniaturas**: `sharp` (hay que añadirlo a `dashboard/package.json`; hoy no está). Se generan **bajo demanda al primer acceso**, no al copiar. Caché en `FOTOS_CACHE_DIR` con nombre `{codigo}-{slot}-{w}-{mtimeMs}.webp`: como el mtime va en la clave, **una foto sobrescrita invalida su miniatura sola** (caso real, ver §3.3) y no hace falta ningún job de limpieza.
- **Escritura atómica**: la miniatura se escribe a un temporal y se publica con `rename()`. Si el proceso muere a mitad, nunca queda un WebP truncado en la caché que luego se sirva como válido.
- Si `sharp` falla con un JPEG corrupto: servir el original y registrar el aviso. Nunca un 500 por una miniatura.
- Techo de tamaño de la caché: ~15 KB × 12.666 × 2 anchos ≈ 380 MB en el peor caso de calentarla entera. Aceptable; no se implementa evicción.

### Tests (vitest)

- `rutaFoto`: código con `../`, con `/`, vacío, de 41 caracteres → `null`. Slot 0 y 5 → `null`. Prueba de `.JPG` cuando no hay `.jpg`.
- Escape de directorio: `FOTOS_DIR` en un `tmpdir`, fichero fuera de él, código manipulado → `null`.
- Endpoint de lote: lote normal, `refs` ambiguas, >200 elementos → 400, `codigos` no-string → 400.
- Endpoint de bytes: slot inválido → 400, `w=999` → 400, inexistente → 404, ETag y 304, content-type correcto.

Todos con un directorio de fotos sintético (JPEGs mínimos generados en el test). **Ningún test toca la VPN.**

---

## 7. Fase 3 — Interfaz

### 7.1 Saber de qué artículo es una celda

Las consultas que genera el LLM traen columnas arbitrarias. Tres capas, gana la primera que aplique:

**Capa 1 — metadato explícito en el spec.** En `dashboard/lib/schema.ts`, dentro de `TableWidgetSchema` (es `.strict()`: si no se declara, Zod lo rechaza):

```ts
/** Columna del resultado que contiene ps_articulos.codigo. Activa el hover. */
articulo_codigo_col: optStr,
/** Idem para la Referencia (ccrefejofacm). */
articulo_ref_col: optStr,
/** true SOLO si el usuario pidió ver las fotos: añade columna de miniaturas. */
mostrar_fotos: z.boolean().optional(),
```

Y una regla nueva en el array `## LLM:rules` de `docs/etl-sync-strategy.md`:

> FOTOS DE ARTICULO: solo el 16 % de los artículos tiene foto, y se resuelven por `codigo` (no hay tabla de fotos: el fichero existe o no). Cuando una tabla muestre artículos, incluye **siempre** la columna `codigo` además de la Referencia y la Descripción, y rellena `articulo_codigo_col` con su nombre. Pon `mostrar_fotos: true` **solo** si el usuario pide explícitamente ver las fotos; por defecto solo hay hover. La descripción **no** identifica un artículo (no es única): nunca intentes resolver una foto solo por descripción.

Después: `npm run build:knowledge` y **commitear** `dashboard/lib/knowledge.ts` (hay un drift guard en CI que falla si queda desactualizado).

**Capa 2 — heurística por nombre de columna.** Nuevo `dashboard/components/widgets/articulo.ts`, hermano de la `detectFormat` que ya existe en `TableWidget.tsx`:

```ts
export function detectArticleColumns(columns: string[]): {
  codigoIdx: number | null;
  refIdx: number | null;
  descIdx: number | null;
};
```

- `codigo`, `código`, `cod`, `codigo_articulo`, `cod_articulo` → columna de código.
- `referencia`, `ref`, `ccrefejofacm` → columna de referencia.
- `descripcion`, `descripción` → columna de descripción, que **nunca activa nada por sí sola**.

**Capa 3 — la descripción se ancla a su fila.** Si la fila tiene código (o referencia) **y** descripción, la celda de descripción también recibe hover, pero resolviendo por el **código de esa misma fila**. Cero ambigüedad.

**Si el SQL no trae ni código ni referencia, no hay hover.** Es la respuesta correcta: adivinar por descripción enseñaría la foto de otro artículo, y hay casos reales ("CAMISA FLORES C/CINTURON" son 3 artículos distintos). La regla de la capa 1 hace que este caso sea raro en dashboards nuevos.

### 7.2 Hook de datos

`dashboard/lib/use-article-photos.ts`

- Tras cargar `WidgetData`, recoge los códigos/referencias visibles, deduplica, trocea en lotes ≤200 y hace **una** llamada a `POST /api/articulos/fotos` por widget.
- Caché a nivel de módulo (`Map<string, Slot[]>`, TTL 10 min) compartida entre widgets: el mismo artículo en tres widgets cuesta una consulta.
- Solo las celdas con `slots.length > 0` muestran indicador. Con 16 % de cobertura, el 84 % de las celdas no cambia en nada y no genera ni una petición de imagen.

### 7.3 `dashboard/components/ArticlePhotoHover.tsx`

Calca el patrón de `GlossaryTooltip.tsx` (CSS puro con `group-hover`/`group-focus-within`, `role="tooltip"`, `aria-describedby`, `tabIndex=0`; sin librerías).

- **Cerrado por defecto.** El único indicador es un glifo de cámara pequeño tras el texto, que no altera la métrica de la celda. Requisito 3 cumplido: coste visual casi nulo.
- **La `<img>` no se monta hasta el primer hover o focus** (estado `armed` con `onMouseEnter`/`onFocus`): renderizar una tabla de 50 filas no dispara 50 descargas.
- `src = /api/fotos/{codigo}/{slot}?w=256`, contenedor **de tamaño fijo 176×176** con `object-fit: contain` y skeleton mientras carga → sin saltos de layout.
- **250 ms de delay** antes de aparecer: cruzar la tabla con el ratón no hace parpadear fotos.
- Si el artículo tiene varias fotos, el tooltip indica "1/3". La navegación completa es del lightbox.
- Teclado: focusable, `Enter`/`Espacio` abre el lightbox.

### 7.4 `dashboard/components/PhotoLightbox.tsx`

Calca `NewConversationDialog.tsx`, que ya resuelve `role="dialog"`, `aria-modal="true"`, cierre con `Escape` y focus trap con Tab/Shift+Tab. No hace falta librería ni portal.

- Foto a `?w=1024`, fondo oscurecido `fixed inset-0 z-50`.
- Flechas ← → y botones para navegar entre los slots del artículo; contador "2/3"; precarga del siguiente.
- Pie con Referencia y Descripción (se pasan desde la fila).
- `Escape` y click fuera cierran.

### 7.5 Enganche en `TableWidget.tsx`

- Las celdas identificadas en §7.1 **envuelven** su contenido actual con `ArticlePhotoHover`. No se sustituye el render de `fmt === "ref"`; se envuelve.
- **Conflicto con el drill-down**: la fila ya tiene `onDataPointClick`. El click que abre el lightbox hace `e.stopPropagation()`.
- **Táctil** (`matchMedia('(hover: none)')`): no hay hover, así que el tap sobre la celda abre el lightbox directamente. El glifo se mantiene para indicar que es pulsable.
- **`mostrar_fotos: true`** (requisito 1, la petición explícita): `TableWidget` antepone una columna "Foto" con miniatura de 40 px (`?w=160`) que abre el lightbox. Solo se renderiza si el spec lo trae.

En esta fase **solo** se engancha `TableWidget`: es donde viven los códigos y referencias. Los gráficos etiquetan tiendas y familias, no artículos; queda fuera.

### 7.6 Tests

**vitest**
- `detectArticleColumns`: tabla de casos, incluida la descripción que no activa nada sola.
- `ArticlePhotoHover`: sin hover no monta `<img>`; al hover sí; `Enter` abre el lightbox; sin slots no renderiza indicador.
- `PhotoLightbox`: navegación, contador, `Escape`, focus trap.
- `TableWidget`: celda con `articulo_codigo_col` queda envuelta; `mostrar_fotos` añade columna; **sin metadato y sin heurística el snapshot no cambia** (garantiza no regresión visual).
- Hook: deduplicación, troceado en lotes, caché compartida.

**Playwright** — `dashboard/e2e/article-photos.spec.ts` (nuevo)
- La fixture genera JPEGs de ~1 KB en un directorio temporal y apunta `FOTOS_DIR` ahí; siembra un dashboard con una tabla de artículos.
- Comprueba: hover muestra `role="tooltip"` con una `<img>` que responde 200; el click abre el lightbox y navega entre fotos; con viewport móvil el tap abre el lightbox; una tabla sin fotos no muestra indicadores; no aparece superficie de error.

---

## 8. Dev frente a prod

**El espejo solo existe en producción** (esta decisión es del dueño). La implementación, en cambio, se hace en la máquina de desarrollo. Cómo trabajar allí, por orden de preferencia:

1. **Para desarrollar y para todos los tests: fotos sintéticas.** Un script `scripts/seed-fotos-dev.sh` que cree `./data/fotos/{1..4}/{codigo}.jpg` con unos pocos JPEG mínimos para códigos que existan en el espejo PostgreSQL de dev. Es lo único que garantiza tests reproducibles sin VPN. **Los tests nunca deben depender del share.**
2. **Para verlo con fotos reales**: montar el share directamente en dev y apuntar `FOTOS_HOST_DIR` al montaje:
   ```bash
   mkdir -p /tmp/psfotos
   mount_smbfs -o ro,nobrowse "$FOTOS_SMB_URL" /tmp/psfotos
   # FOTOS_HOST_DIR=/tmp/psfotos/PS_Ficheros/Imagenes
   ```
   Funciona (verificado como invitado), pero con las latencias de §3.4: el primer hover de cada foto puede tardar segundos. Sirve para validar visualmente, no para medir rendimiento.
3. **Espejo parcial en dev**: copiar a mano unos cientos de fotos si hace falta trabajar con volumen realista.

Requisito de robustez: **si `FOTOS_DIR` no existe o está vacío, la app funciona igual**, simplemente sin fotos ni indicadores. Ningún error en pantalla. Hay que cubrirlo con un test.

---

## 9. Fases y orden

| Fase | Qué | Ficheros | Por qué va aquí |
|---|---|---|---|
| **1** | Espejo + alerta | `scripts/sync-fotos.sh`, `scripts/check-fotos-paths.py`, `scripts/launchd/com.powershop.fotos-sync.plist.template`, `scripts/install-fotos-sync-launchd.sh`, `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `docs/decisions/D-068-*.md`, `DECISIONS.md`, `docs/deployment/production.md`, `docs/skills/data-access.md` (gotcha `COUNT(*)`=NULL) | Nada depende de esto para compilar, pero define dónde viven los ficheros |
| **2** | API | `dashboard/lib/fotos.ts`, `dashboard/app/api/articulos/fotos/route.ts`, `dashboard/app/api/fotos/[codigo]/[slot]/route.ts`, `dashboard/package.json` (+`sharp`), tests vitest, `scripts/seed-fotos-dev.sh` | Define el contrato que consume la UI |
| **3** | UI | `dashboard/lib/schema.ts`, `dashboard/components/widgets/articulo.ts`, `dashboard/lib/use-article-photos.ts`, `dashboard/components/ArticlePhotoHover.tsx`, `dashboard/components/PhotoLightbox.tsx`, `dashboard/components/widgets/TableWidget.tsx`, `docs/etl-sync-strategy.md` (`## LLM:rules`), `dashboard/lib/knowledge.ts` (regenerado), tests vitest + e2e | Necesita los endpoints de la fase 2 |

Las fases 2 y 3 se pueden desarrollar en dev sin VPN, con las fotos sintéticas.

**El ETL no aparece en ninguna fase.** No se toca.

### Comandos de verificación

```bash
# Fase 1
shellcheck scripts/sync-fotos.sh

# Fases 2 y 3
cd dashboard && npm run lint && npm run typecheck && npm test
npx playwright test e2e/article-photos.spec.ts
npm run build:knowledge && git diff --exit-code lib/knowledge.ts   # debe quedar limpio
```

---

## 10. Documentación y decisión

- `docs/decisions/D-068-fotos-por-convencion-de-ruta.md`: contexto con las medidas de §3, decisión (espejo diario en prod + ruta derivada por convención + **sin tabla y sin tocar el ETL** + miniaturas WebP bajo demanda), y las alternativas descartadas (leer del SMB en vivo: cola de 5 s; inventario en PostgreSQL: innecesario con el espejo local).
- Una línea de ≤180 caracteres en `DECISIONS.md`, grupo **Data / ETL**: "Las fotos de artículo se resuelven por convención de ruta sobre un espejo local diario; no hay tabla de fotos ni paso de ETL. `Articulos.Path*`/`TieneImagen` no se usan: mienten."
- `docs/deployment/production.md`: sección de instalación del job launchd y la nota de que la primera copia tarda ~4,6 h.
- No hay que tocar `.github/workflows/` (D-029 no aplica).

---

## 11. Riesgos y puntos abiertos

| | Riesgo | Mitigación / recomendación |
|---|---|---|
| 1 | El modo de acceso actual al share podría dejar de funcionar si se endurece el servidor. Las credenciales del 4D **no sirven** para SMB. | `FOTOS_SMB_URL` está parametrizado: cambiar el acceso no toca código. |
| 2 | La primera copia son ~4,6 h y el delta nocturno ~15 min, casi todo enumerando. | Aceptado por el dueño. Si algún día molesta, se reduce la cadencia o se trocea por directorio. |
| 3 | **Frescura de 24 h**: una foto subida hoy aparece mañana. | Aceptado (cadencia diaria confirmada). Subirlo a cada 6 h es cambiar una línea del plist. |
| 4 | `sharp` en la imagen `node:20-alpine` del dashboard necesita binarios musl. | Es el caso documentado por sharp ≥0.33, pero **no está probado aquí**: verificarlo en la fase 2, es lo primero que hay que comprobar al añadir la dependencia. |
| 5 | Si la VPN cae a mitad del rsync, el espejo queda a medias. | `rsync` es reanudable y el guard evita el borrado; el `.last-sync.json` no se actualiza, así que la app puede avisar de que el espejo está rancio. |
| 6 | Códigos duplicados en `Articulos` (~99 de 42.982) compartirían foto. | Aceptable: es fiel al origen, el fichero se llama por código. |
| 6b | **Los `PATH IMAGEM` son editables en PowerShop.** Si alguien escribe una ruta fuera de la convención, ese artículo dejará de mostrar foto. | Decidido: convención + alerta (§5.3). Degrada en silencio, nunca enseña una foto equivocada, y el chequeo diario avisa. Si llegara a pasar a menudo, la salida es sincronizar `path1..path4` a `ps_articulos` (4 columnas, 4 líneas de mapeo) y traducir `W:\` → raíz del espejo. |
| 7 | Los endpoints de fotos van **sin autenticación**, igual que `/api/query` hoy (solo `/admin` tiene llave). | Mantener la paridad. Si algún día se añade auth global, estas rutas entran en el mismo paraguas. |
| 8 | Dashboards guardados **antes** de la fase 3 no traen `articulo_codigo_col`. | La heurística de la capa 2 les da hover automáticamente si sus columnas se llaman `codigo` o `referencia`. |

---

## 12. Validación

**Verificado contra el servidor y la BD reales (2026-10-08)**

- Servidor, share y acceso: montaje en solo lectura verificado con el valor de `FOTOS_SMB_URL`; `PS_Ficheros/Imagenes/{1,2,3,4}` existe; un atajo en la raíz del share confirma a qué apunta `W:`. SMB alcanzable desde la red interna. Las credenciales del 4D no sirven para SMB.
- **Los 171.928 valores de `Path`..`Path4` comparados uno a uno: 171.928 exactos al patrón, 0 desviaciones.** Blobs `Imagen*` vacíos. `TieneImagen` False en los 42.982. `FAMateriales`, `Catalogos`, `FOFotografiaCotejo`, `WebImagenesCarrusel` a 0 filas. Barrido de las 325 tablas sin más candidatos.
- Volcado de los 144 campos de texto del artículo 132374: solo `PATH`..`PATH4` contienen rutas; no hay campo de URL. Columnas no-texto de `Articulos`: solo `Objeto` y `Promociones` (JSON). Comprobado también que `Imagenes/1/132374.jpg` existe en el share pese a que PowerShop muestra el recuadro vacío.
- Inventario: 12.666 ficheros con el patrón, media 278 KB (muestra de 37), 6.876/42.880 artículos con foto, reparto 3.499/1.097/2.235/67, 42 huérfanos.
- Nombres: los 21 `<cod>.1.jpg` y los 5 `<cod>.2.jpg` tienen base en el mismo directorio; 14 variantes `(n)`; `1NO` son las originales de 2022 (comparados tamaño y mtime de 4 pares).
- Latencias de §3.4: medidas sobre **montaje recién hecho** para que no hubiera caché de metadatos, con rutas derivadas y sin listar. `rsync` del dir 4 medido de principio a fin.
- Cardinalidad referencia/código (42.962 / 42.883 / 42.982 filas) y no-unicidad de la descripción.
- Código del repo: `ps_articulos` en `etl/schema/init.sql:44-67`; `_ARTICULOS_MAPPING` en `etl/sync/articulos.py` sin campos de foto; `WidgetData` en `dashboard/components/widgets/types.ts`; `detectFormat` y `onDataPointClick` en `TableWidget.tsx`; patrón de tooltip en `GlossaryTooltip.tsx`; patrón de diálogo con focus trap en `NewConversationDialog.tsx` y `ForceResyncDialog.tsx`; `TableWidgetSchema` es `.strict()`; `sharp` **no** está en `dashboard/package.json`; `compose-parity.test.ts` existe; `scripts/launchd/` tiene el patrón de job de host; último decisión `D-067` con un `D-065` duplicado.
- `PROD_HOST=192.168.1.238` es la máquina de producción, y es **distinta** de la de desarrollo donde se implementará.

**Asumido, no verificado**

- Que `sharp` funcione en la imagen Alpine concreta del dashboard (riesgo 4).
- Duración exacta de la primera copia completa: extrapolada de 0,21 MB/s medidos sobre 27,7 MB.
- Que `DashboardRenderer.tsx` (1.065 líneas) no necesite más que el tipado al pasar el spec extendido al widget: comprobar en la fase 3.
- Hasta dónde se extiende la fixture de e2e para sembrar un `FOTOS_DIR` de prueba: el patrón existe, el detalle se concreta en la fase 3.
- Comportamiento del job launchd tras reiniciar el Mac con la VPN caída: debe fallar limpio por el guard; probar al instalarlo.
