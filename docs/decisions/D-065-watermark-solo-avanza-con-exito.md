---
id: D-065
title: El watermark sólo avanza en una pasada correcta
date: 2026-09-02
---

# D-065: El watermark sólo avanza en una pasada correcta

*Decidido: 2026-09-02*

**Context**:

Investigando por qué `/inicio` se caía en producción ([#961](https://github.com/alvarolobato/powershop-analytics/pull/961)) se acabó auditando el ETL, y apareció un fallo mucho peor que el que se estaba persiguiendo: **el camino de error adelantaba el watermark igual que el camino correcto**.

`etl/main.py::_run_sync` hacía, al capturar una excepción:

```python
wm_to = datetime.now(timezone.utc)
set_watermark(conn_pg, name, wm_to, 0, "error", err)
```

y `set_watermark` escribe `last_sync_at = EXCLUDED.last_sync_at` en su `ON CONFLICT`, sin condición. O sea que un intento **fallido** movía la marca a *ahora* exactamente igual que uno bueno.

La consecuencia es pérdida de datos silenciosa y permanente. El delta siguiente calcula `since = last_sync_at - lookback_days`, así que su ventana arranca en el último **intento** y no en el último **éxito**. Si una tabla falla dos días naturales seguidos sin que se cuele un barrido con `since=None`, las filas modificadas entre medias no se vuelven a mirar jamás: el delta no retrocede nunca.

No era teórico. Auditando los **16.144 deltas correctos** del histórico, buscando ventanas que arrancan después del último éxito (`watermark_from::date > prev_ok::date`), salen dos casos reales, los dos del run 41 el 2026-04-23:

```
 stock      último ok 2026-04-18 19:21  recuperado 2026-04-23  ventana desde 2026-04-23 02:01
 traspasos  último ok 2026-04-18 19:26  recuperado 2026-04-23  ventana desde 2026-04-23 02:01
```

Cinco días (18–22 de abril) de modificaciones de stock y traspasos que el delta de recuperación saltó. Sólo los rescató el siguiente barrido completo.

Que no hubiera vuelto a morder se debía a que el «full» nocturno de las tablas upsert usa `since=2014-01-01` y barre todo cada noche, se mire la marca o no. **Eso era lo único que hacía seguros a los deltas** — y es justo el run que falla 114 de 151 veces en 30 días, y el que estábamos a punto de espaciar.

El test que debía cubrir esto se llamaba `test_watermark_not_updated_on_error` y comprobaba `status='error'` y `rows_synced=0`. Nunca miró `last_sync_at`, que es exactamente lo que promete el nombre. Por eso el fallo sobrevivió años en verde.

**Decision**:

El watermark **sólo** avanza cuando la pasada termina bien. El camino de error usa `set_watermark_error()`, que escribe `status`, `error_msg` y `updated_at`, y **no incluye `last_sync_at` en el `DO UPDATE SET`**. Un fallo deja la marca donde estaba y el siguiente intento vuelve a cubrir la ventana entera.

Una tabla que falla sin tener marca previa (primer sync de su vida) se inserta con **la época**, nunca con `now()`: con `now()` se quedaría con marca de hoy y su primer delta se traería sólo el último día, dando por bueno un espejo vacío.

Cualquier test que afirme que un fallo no mueve la marca tiene que comprobar `last_sync_at`, no sólo `status`.

**Alternatives rejected**:

- *Dejar el barrido `since=2014` nocturno como red de seguridad.* Es lo que veníamos haciendo sin saberlo, y es una red que falla el 75 % de las veces. Además el objetivo declarado es reducir su frecuencia ([#963](https://github.com/alvarolobato/powershop-analytics/issues/963)), lo que dejaría el agujero al descubierto.
- *No escribir nada en `etl_watermarks` al fallar.* Se perdería la señal de estado que consume el panel de ETL. Escribir estado sin tocar la marca da las dos cosas.
- *Ampliar `lookback_days` para cubrir huecos.* Tapa el síntoma a costa de reprocesar más cada hora, y sigue perdiendo datos ante cualquier racha de fallos más larga que la ventana elegida.

**Rationale**:

Un watermark es una promesa: «todo lo anterior a esto está en el espejo». Escribirlo tras un fallo convierte la promesa en mentira y no deja ninguna traza de que se ha mentido — el run queda registrado como fallido, pero el dato perdido no se vuelve a pedir nunca. De los modos de fallo del ETL este es el único que es **silencioso y permanente**: los demás (fetch truncado, muerte por memoria, socket muerto) son ruidosos y se recuperan solos en la siguiente pasada.

**See**:

- `etl/db/postgres.py::set_watermark_error`, `etl/main.py::_run_sync`
- `etl/tests/test_watermark_solo_avanza_con_exito.py`, `etl/tests/test_scheduler.py::test_watermark_not_updated_on_error`
- [#963](https://github.com/alvarolobato/powershop-analytics/issues/963) — auditoría del ETL que lo destapó
- [D-051](D-051-fetch-anomaly-guard.md) — ya describía este comportamiento («advances the watermark even when a sync ultimately fails») sin tratarlo como fallo
- [D-063](D-063-una-carga-corta-es-perdida-de-datos.md) — la otra mitad: una carga corta no debe pisar la tabla
