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
- [ ] Verificación manual con fotos reales (132374 → 1; 144750 → 3; 169 → sin foto, sin
      indicador y sin petición de imagen; desmontar el share con la app levantada)
- [ ] PR abierto contra `main`
- [ ] Lazo detenido

## Verificación manual — qué comprobé y qué vi

(pendiente)

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
