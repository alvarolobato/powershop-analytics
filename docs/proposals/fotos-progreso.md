# Fotos de artículo — progreso de la implementación

Plan: [fotos-de-articulo.md](fotos-de-articulo.md) · Rama: `feat/fotos-de-articulo` · Decisión: D-068
Lazo: CronCreate job `cbca1d81` (*/15). Detener con CronDelete cbca1d81.

**Al despertar, lee esto primero.** Marca cada casilla al completarla y añade una línea
fechada en la bitácora del final.

## PARADA DURA activa

Ninguna.

## Bloqueos (no son parada dura)

- 2026-10-08 — `FOTOS_SMB_URL` **no está** en `~/.config/powershop-analytics/.env` de esta
  máquina (0 líneas con `FOTOS`). Bloquea solo la verificación manual con fotos reales.
  Avisado al dueño. Todo lo demás sigue.

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
- [ ] `dashboard/package.json` + lock (`sharp`)
- [ ] `dashboard/lib/fotos.ts`
- [ ] `POST /api/articulos/fotos`
- [ ] `GET /api/fotos/[codigo]/[slot]`
- [ ] Tests vitest (rutaFoto, path traversal, lote, bytes, FOTOS_DIR ausente)
- [ ] `scripts/seed-fotos-dev.sh`
- [ ] Commit de la fase 2

## Fase 3 — UI (un commit)

- [ ] `dashboard/lib/schema.ts` (`articulo_codigo_col`, `articulo_ref_col`, `mostrar_fotos`)
- [ ] `dashboard/components/widgets/articulo.ts` (`detectArticleColumns`)
- [ ] `dashboard/lib/use-article-photos.ts`
- [ ] `dashboard/components/ArticlePhotoHover.tsx`
- [ ] `dashboard/components/PhotoLightbox.tsx`
- [ ] Enganche en `TableWidget.tsx` (envolver, stopPropagation, táctil, columna Foto)
- [ ] Regla `FOTOS DE ARTICULO` en `## LLM:rules` + `build:knowledge` + commit de `knowledge.ts`
- [ ] Tests vitest de la fase 3
- [ ] `dashboard/e2e/article-photos.spec.ts`
- [ ] Commit de la fase 3

## Criterio de terminado

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npx playwright test`
- [x] `shellcheck scripts/sync-fotos.sh`
- [ ] `npm run build:knowledge` + `git diff --exit-code lib/knowledge.ts`
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
