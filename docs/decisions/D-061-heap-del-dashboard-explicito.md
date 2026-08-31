---
id: D-061
title: El heap de Node del dashboard se fija explícitamente, no se hereda del mem_limit
date: 2026-08-31
---

# D-061: El heap de Node del dashboard se fija explícitamente, no se hereda del mem_limit

*Decidido: 2026-08-31*

**Context**: Al poner límites de memoria a los contenedores (2026-08-30) el
dashboard quedó con `mem_limit: 1g`. Node **deriva su heap del límite del
contenedor**, así que el tope efectivo pasó a ser **524 MB** sin que nadie lo
decidiera ni lo viera: `NODE_OPTIONS` no estaba definido y el número no aparece
en ninguna configuración.

El contenedor aguantó 21 horas. Al día siguiente, dos conversaciones de
free-chat sobre rentabilidad por proveedor tumbaron el proceso:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

**13 reinicios**, cada proceso muriendo entre 12 y 30 segundos después de
arrancar, siempre con el heap en ~589 MB. Las dos conversaciones quedaron con el
turno en `error` y el mensaje "El servidor se reinició mientras se procesaba
este turno" — que es exactamente lo que había pasado.

Lo que descarté con datos antes de tocar nada: los resultados de herramienta
eran diminutos (máximo 7 KB), los ficheros de contexto por turno ocupan 0,1 MB,
y entre el `Ready` y el crash no había ni una línea de petición. Lo único en el
log eran 3.435 `model_thinking_delta` por minuto y el RSS subiendo ~24 MB/s.

**Decisión**: el dashboard declara su heap con
`NODE_OPTIONS=--max-old-space-size=1536` en el compose, y su `mem_limit` es
**2g**. Las dos cosas juntas y explícitas:

- El `mem_limit` acota lo que el contenedor puede pedirle a la máquina.
- `--max-old-space-size` acota el heap, que es lo que de verdad mata al proceso,
  y deja ~500 MB para lo que no es heap (buffers, código, pilas).

Nunca dejar que el heap sea un efecto secundario del `mem_limit`: el número
resultante no aparece en ninguna configuración, no sale en ninguna revisión, y
sólo se descubre leyendo un volcado de GC después de la caída.

**Alternativas rechazadas**: *subir sólo el `mem_limit`* — funciona por
casualidad y vuelve a dejar el heap sin declarar, que es la mitad del problema.
*Quitar el límite* — es lo que había antes de 2026-08-30, y sin límite macOS
mata procesos sin dejar traza (`ExitCode=0`, sin `OOMKilled`); el ETL murió así
104 veces.

**Pendiente**: subir el techo compra margen, no explica el consumo. Medio giga
de heap para una conversación es mucho y no está justificado. Queda por
identificar qué acumula — candidatos: el registro por delta de razonamiento, la
acumulación del stream SSE, o el estado del bucle agéntico a lo largo de sus 40
rondas.

**See**: `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`
(`DASHBOARD_NODE_OPTIONS`), [D-058](D-058-wrenai-retirado.md) (los límites de
memoria entraron con la retirada de WrenAI).
