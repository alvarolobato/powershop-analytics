---
id: D-063
title: Un full refresh que encoge aborta; una carga corta es pérdida de datos
date: 2026-09-01
---

# D-063: Un full refresh que encoge aborta; una carga corta es pérdida de datos

*Decided: 2026-09-01*

**Context**: La madrugada del 2026-09-01 la pasada 1553 dejó `ps_articulos` con
23.898 filas donde la pasada anterior (1552, 85 minutos antes) había escrito
42.275. El 43 % del catálogo desapareció, y con él las temporadas modernas
(V25, V26, I25, I26, 92-99). La pasada se marcó `success`: 25 tablas OK,
20,3 M filas.

El dueño lo detectó porque el dashboard le respondió que no había datos de la
temporada V26. La respuesta era correcta: en ese momento no los había.

El guardián de anomalías ([D-051](D-051-fetch-anomaly-guard.md)) **sí** detectó
la corrupción y la registró en `etl_fetch_anomalies`:

```
fetch anomaly: 29 row(s) at idx 39771-39799 (persisted_source_data)
total_rows 39800 -> refetch_total_rows 23900
```

El fetch trajo 39.800 filas con 29 todo-NULL al final; el refetch trajo 23.900
—dieciséis mil menos— y se persistió el corto. `safe_fetch` comparaba las
anomalías entre las dos lecturas pero nunca el VOLUMEN. Aguas abajo,
`truncate_and_insert` acepta la lista que le pasen: trunca, inserta y hace
commit.

**Decision**:

1. **Antes de un `TRUNCATE` de full refresh** se compara el volumen entrante
   con el que la tabla tiene. Si encoge más de un 10 %, se aborta sin tocarla
   (`FullRefreshShrankError`). Los datos de ayer valen más que medio catálogo
   de hoy. Escape explícito con `allow_shrink=True`; no aplica por debajo de
   100 filas, donde un porcentaje no significa nada.
2. **Cero filas entra en la misma regla.** Antes se truncaba y se hacía commit,
   así que un corte del 4D a las 2 de la mañana borraba el catálogo entero y lo
   reportaba como 0 filas correctas. `upsert()` se protege de esto desde
   [D-050](D-050-upsert-batch-loss.md); `truncate_and_insert` no lo hacía.
3. **Un refetch materialmente más corto que el fetch original no discrimina
   nada**: es un segundo fallo, peor que el primero. Lanza `FetchShrankError` y
   deja `refetch_outcome = refetch_shrank` como evidencia.

**Alternatives rejected**:
- *Avisar sin abortar* (log, métrica, alerta): el incidente ya dejó evidencia
  escrita en `etl_fetch_anomalies` y nadie la vio hasta que el dueño notó el
  síntoma doce horas después. Un aviso que no para la escritura no impide la
  pérdida.
- *Comparar sólo fetch contra refetch*: insuficiente. En este incidente el
  **primer** fetch ya venía corto (39.800 de 42.275), así que la comparación
  entre las dos lecturas no habría bastado. La guarda decisiva es contra lo que
  la tabla ya tiene.
- *Umbral más laxo (30-50 %)*: el dueño confirma que ninguna tabla encoge nunca
  con normalidad, así que un umbral estrecho no genera falsos positivos y
  detecta antes.

**Rationale**: el modo de fallo peligroso no es que el ETL se caiga —eso se ve—
sino que escriba menos de lo que debía y se declare correcto. Un fallo ruidoso
deja el espejo con los datos de ayer, que son utilizables; uno silencioso deja
medio catálogo y respuestas falsas que parecen buenas.

**See**: `etl/db/postgres.py` (`_guard_full_refresh_shrink`,
`FullRefreshShrankError`), `etl/db/fourd.py` (`FetchShrankError`),
`etl/tests/test_carga_corta_es_perdida.py`, PR #950,
[D-050](D-050-upsert-batch-loss.md), [D-051](D-051-fetch-anomaly-guard.md),
[D-064](D-064-temporadas-sin-formato-fijo.md).
