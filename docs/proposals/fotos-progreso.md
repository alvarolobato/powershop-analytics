# Fotos de artículo — progreso de la implementación

Plan: [fotos-de-articulo.md](fotos-de-articulo.md) · Rama: `feat/fotos-de-articulo` · Decisión: D-068
Lazo: CronCreate job `cbca1d81` (*/15). Detener con CronDelete cbca1d81.

**Al despertar, lee esto primero.** Marca cada casilla al completarla y añade una línea
fechada en la bitácora del final.

## PARADA DURA activa

Ninguna.

## Bloqueos (no son parada dura)

- Ninguno. El dueño dio el dato que faltaba (2026-10-08): el share es `Compartido` en
  10.0.1.35, accesible como invitado y alcanzable desde esta máquina (445 abierto). El valor
  completo de `FOTOS_SMB_URL` va SOLO en `~/.config/powershop-analytics/.env`.

## Fase 1 — Espejo + alerta (un commit)

- [x] `scripts/sync-fotos.sh`
- [x] `scripts/check-fotos-paths.py` + test unitario (fila desviada → sale 1 y la lista)
- [x] `scripts/launchd/com.powershop.fotos-sync.plist.template`
- [x] `scripts/install-fotos-sync-launchd.sh`
- [x] `.env.example` (`FOTOS_SMB_URL`, `FOTOS_HOST_DIR`)
- [x] `docker-compose.yml` y `docker-compose.prod.yml` a la vez (env + volúmenes)
- [x] `docs/decisions/D-068-fotos-por-convencion-de-ruta.md` + línea en `DECISIONS.md`
- [x] `docs/deployment/production.md` (instalación del job, primera copia ~4,6 h)
- [x] `docs/skills/data-access.md` (gotcha `COUNT(*)` = NULL)
- [x] `shellcheck scripts/sync-fotos.sh` limpio, `ruff format` sobre el .py
- [x] Commit de la fase 1

## Fase 2 — API (un commit)

- [x] **ANTES DE NADA**: `sharp` funciona en `node:20-alpine` (musl): 0.35.5 OK en arm64 y amd64 (`npm i sharp` + JPEG→WebP en contenedor). Falta comprobarlo en la imagen real (standalone de Next)
- [x] `dashboard/package.json` + lock (`sharp`)
- [x] `dashboard/lib/fotos.ts`
- [x] `POST /api/articulos/fotos`
- [x] `GET /api/fotos/[codigo]/[slot]`
- [x] Tests vitest (rutaFoto, path traversal, lote, bytes, FOTOS_DIR ausente)
- [x] `scripts/seed-fotos-dev.sh`
- [x] Commit de la fase 2

## Fase 3 — UI (un commit)

- [x] `dashboard/lib/schema.ts` (`articulo_codigo_col`, `articulo_ref_col`, `mostrar_fotos`)
- [x] `dashboard/components/widgets/articulo.ts` (`detectArticleColumns`)
- [x] `dashboard/lib/use-article-photos.ts`
- [x] `dashboard/components/ArticlePhotoHover.tsx`
- [x] `dashboard/components/PhotoLightbox.tsx`
- [x] Enganche en `TableWidget.tsx` (envolver, stopPropagation, táctil, columna Foto)
- [x] Regla `FOTOS DE ARTICULO` en `## LLM:rules` + `build:knowledge` + commit de `knowledge.ts`
- [x] Tests vitest de la fase 3
- [x] `dashboard/e2e/article-photos.spec.ts`
- [x] Commit de la fase 3

## Criterio de terminado

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npx playwright test` — 48 pasan con e2e-stub + 5 de llm-integration con mock (como CI). Falla 1 AJENO: `conversation-ui.spec.ts` llama a `/api/dashboard` (no existe; es `/api/dashboards`) y nunca estuvo en CI
- [x] `shellcheck scripts/sync-fotos.sh`
- [x] `npm run build:knowledge` + `git diff --exit-code lib/knowledge.ts`
- [x] Verificación manual con fotos reales (ver abajo)
- [ ] PR abierto contra `main`
- [ ] Lazo detenido

## Verificación manual — qué comprobé y qué vi

Hecha el 2026-10-08/09 con el share real montado en solo lectura (`mount_smbfs -o ro,nobrowse`,
acceso de invitado) en `/tmp/psfotos`, `FOTOS_DIR=/tmp/psfotos/PS_Ficheros/Imagenes`.

**Cómo corrió la app.** El dashboard corrió con `npm run dev` EN EL HOST contra el PostgreSQL del
compose, no en contenedor: `docker compose up dashboard` con `FOTOS_HOST_DIR` apuntando al
montaje SMB se queda colgado (contenedor en `Created` más de 10 min; Docker Desktop no puede
hacer bind mount de una ruta que vive sobre smbfs). La opción 2 de la §8 del plan, tal como
está escrita, no funciona en esta máquina. El `sharp` de la imagen real sí se probó, pero con
fotos sintéticas (ver fase 2).

**Datos.** El PostgreSQL de dev tiene `ps_articulos` VACÍO (0 filas; solo esquema). Inserté tres
filas temporales con el código, referencia y descripción reales leídos de 4D con `ps sql query`
(169 / 132374 / 144750) y las borré al terminar, junto con los paneles de prueba.

| Caso | Qué vi |
|---|---|
| En el share, por ruta directa | `1/132374.jpg` 150 KB; `144750` en 1, 2 y 3 (520/507/590 KB), no en 4; `169` en ninguno de los 4 |
| `POST /api/articulos/fotos` | `132374 → [1]`, `144750 → [1,2,3]`, `169 → []`; por referencia, lo mismo (0,86 s en frío) |
| `GET /api/fotos/132374/1` | 200 `image/jpeg`, 150.212 bytes |
| `?w=256` / `?w=1024` | 200 `image/webp`, 7,7 KB / 78,6 KB. Primera vez 2,5 s (lee del share); segunda 7 ms (caché) |
| `144750/4`, `169/1` | 404 |
| **132374** en la tabla | Indicador en código, referencia y descripción. Hover → foto, sin contador (1 foto) |
| **144750** | Hover sobre la DESCRIPCIÓN → foto con `1/3`. Click → lightbox; flechas `1/3 → 2/3 → 3/3 → 1/3`, cada una con su slot real (800×1037 px); pie `I26530116 · CAMISA M/LARGA CUADRADOS`; Escape cierra |
| **169** | **Sin indicador** en ninguna de las tres tablas. Hover: ningún tooltip y **0 peticiones** a `/api/fotos/169/…` en toda la sesión |
| Tabla solo con Referencia | Indicador en 2 de 3 filas; el click abre `/api/fotos/144750/1` (traducción ref → código correcta) |
| `mostrar_fotos: true` | Columna «Foto» con 2 miniaturas (`?w=160`) y la celda del 169 vacía. Son las ÚNICAS peticiones de imagen al cargar la página |
| Móvil (iPhone 13) | El toque abre el lightbox directamente; no aparece tooltip |
| Errores | 0 superficies de error, 0 errores de consola, 0 líneas de error en el log del servidor |

**Desmontar el share con la app levantada.** `umount` normal dio «Resource busy»; lo forcé con
`diskutil unmount force`, que lo dejó a medias (sigue en `mount` pero ya no deja leer: peor que
un desmontaje limpio, y más parecido a una VPN caída). Con la app sin reiniciar:
lote → 200 con todos los slots vacíos en 26 ms (no se cuelga); bytes → 404, también los que
estaban en la caché de miniaturas; la página carga las tres tablas con sus 9 filas, **0
indicadores, 0 miniaturas, 0 peticiones de imagen, 0 errores**; `/api/health` sigue `ok`.

**Lo que NO se probó**
- `scripts/sync-fotos.sh` contra el share real (EC-1, la copia de 3,5 GB / ~4,6 h) ni con un host
  inexistente (EC-2). Sí con un origen local simulado: 13 tests pytest.
- `scripts/check-fotos-paths.py` contra el 4D real (EC-4) y su ejecución dentro del contenedor `etl`.
- El job launchd y su instalador (solo `plutil -lint` y shellcheck): son de producción.
- El contenedor del dashboard leyendo el espejo real. En prod el espejo es disco local, no SMB,
  así que el cuelgue de Docker Desktop no aplica, pero no está visto.
- La imagen completa en amd64 (solo `npm i sharp` suelto en `node:20-alpine` amd64).
- Que el LLM real rellene `articulo_codigo_col` al generar un panel (los e2e van con stub).

## Bitácora

- 2026-10-08 — Rama creada desde `docs/fotos-de-articulo`. Plan, AGENTS.md, DECISIONS.md y
  dashboard-app.md leídos. Fichero de progreso creado.
- 2026-10-08 — **Fase 1 hecha.** Desviaciones del plan, todas anotadas en el PR:
  (a) producción no tiene checkout, así que el instalador COPIA los scripts a `<stack>/scripts`;
  (b) fichero extra `scripts/fotos-sync-job.sh` (espejo + chequeo, lo lanza launchd);
  (c) `check-fotos-paths.py` corre dentro del contenedor `etl` (el host de prod no tiene p4d) y
  lleva `signal.alarm` por D-067; (d) el guard comprueba los 4 orígenes ANTES del primer rsync
  (el del plan podía borrar 1..3 antes de descubrir que 4 falla) y usa `find -quit` en vez de
  `ls | grep` (shellcheck SC2010); (e) `FOTOS_SRC_DIR` salta el montaje → 13 tests pytest sin VPN.
  `scripts/tests/test_wren_push_metadata.py` tiene 10 fallos PREVIOS, ajenos a esto.
- 2026-10-08 — **Fase 2 hecha.** `sharp` 0.35.5 comprobado en la IMAGEN REAL del dashboard
  (`docker build ./dashboard`, standalone de Next, Alpine musl arm64, uid 1001): original 200
  image/jpeg, `?w=256` 200 image/webp, `?w=999` 400, `..%2f..%2fetc%2fpasswd` 400, slot 9 400,
  inexistente 404, y la caché se escribe en el bind mount. amd64 solo probado con `npm i sharp`
  suelto en `node:20-alpine`, no con la imagen entera. 101 tests vitest nuevos; suite completa
  3122 en verde. Desviación: las funciones de `lib/fotos.ts` son ASYNC (el plan las firmaba
  síncronas): con `statSync` un lote sobre el share SMB de dev bloquearía el event loop segundos.
- 2026-10-08 — Fase 3 implementada, pendiente de commit hasta ver la suite completa de
  Playwright. e2e nuevo 10/10. Entorno e2e local (NO va al repo): Postgres desechable
  `docker run --name ps-e2e-pg -p 55432:5432 postgres:16-alpine` + `/tmp/ps-e2e-bin/env.sh`
  (exporta POSTGRES_*, DASHBOARD_PORT=4010, e2e-stub) + shim `/tmp/ps-e2e-bin/psql` porque esta
  máquina no tiene psql. Para repetir: `. /tmp/ps-e2e-bin/env.sh && npx playwright test`.
  El e2e cazó un bug real: con el foco dentro del lightbox ni Escape ni las flechas hacían nada
  (el stopPropagation de React paraba el evento antes de `window`). Arreglado con listener en
  captura + test de regresión que falla sin el arreglo.
  Desviaciones de la fase 3: tooltip y lightbox van en portal a <body> (el contenedor de la
  tabla tiene overflow y recorta un tooltip absolute); la visibilidad del tooltip es por estado,
  no group-hover; un `codigo` a secas solo cuenta como de artículo si hay Referencia o lo dice
  el spec (evita enseñar la foto del artículo 169 sobre el código de una tienda).
- 2026-10-08 — `FOTOS_SMB_URL` sigue sin estar: ni en el .env de esta máquina ni en los de
  producción (comprobado con `grep -c`, sin leer valores). No voy a adivinar host/share.
- 2026-10-08 — **Fase 3 commiteada.** Suite Playwright completa pasada. Siguiente: verificación
  manual con fotos reales (montar el share ro en /tmp/psfotos, levantar el stack) y abrir el PR.
- 2026-10-09 — Verificación manual hecha y anotada. Limpieza: filas y paneles de prueba
  borrados, servidor dev parado, contenedores postgres/otel parados (no estaban levantados
  antes), Postgres de e2e eliminado. `FOTOS_SMB_URL` añadido al .env centralizado (copia previa
  en `.env.pre-fotos`). OJO: `/tmp/psfotos` quedó como montaje zombi tras el unmount forzado.
