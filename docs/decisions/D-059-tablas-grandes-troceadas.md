---
id: D-059
title: Las tablas grandes se insertan por lotes, nunca materializando todo
date: 2026-08-30
---

# D-059: Las tablas grandes se insertan por lotes, nunca materializando todo

*Decidido: 2026-08-30*

**Context**: `truncate_and_insert()` construye la lista mapeada entera antes de
insertar. Su docstring ya avisaba —"Used for full-refresh tables (catalogs,
small dimension tables)"— pero una nota no es una barrera, y dos tablas de un
millón de filas acabaron usándolo: `ps_gc_lin_albarane` (1.048.417) y
`ps_gc_lin_facturas` (1.009.447).

Eso deja tres copias vivas a la vez: las tuplas crudas de 4D, los diccionarios
mapeados y el lote que construye psycopg2. En una máquina de 16 GB con tres
proyectos conviviendo, el proceso muere **sin dejar traza**: salida limpia con
código 0, `OOMKilled=false`, contenedor reiniciado, y la pasada marcada como
fallida por la reconciliación de huérfanas del arranque siguiente.

Las sincronizaciones completas fallaban **104 de 132 veces (79 %)** en 30 días,
siempre en el mismo punto. No era determinista —28 sí terminaban— porque
dependía de cuánta memoria libre hubiera en ese momento, que es exactamente el
perfil de un problema de memoria y la razón de que costara tanto diagnosticarlo.

**Decision**: cualquier tabla que en producción supere las **100.000 filas** usa
`truncate_and_insert_streaming()`, que mapea e inserta por trozos de 50.000: en
memoria sólo hay un trozo mapeado además del crudo. Todo en una transacción —
una tabla truncada a medias es peor que no sincronizar.

Un test (`etl/tests/test_tablas_grandes_troceadas.py`) cruza las llamadas a
`truncate_and_insert` con los tamaños reales de producción y falla por encima
del umbral, con un segundo test de contrapeso para que no pueda pasar en vacío
si el patrón de detección deja de casar.

**Alternatives rejected**: convertir las trece tablas restantes al camino
troceado — la mayor de ellas es `ps_lineas_compras` con 46.201 filas, y cambiar
el camino de inserción de código que funciona, sin un fallo que lo justifique,
es riesgo sin retorno. Subir la memoria de la VM de Docker — ayuda pero no
arregla el pico, que es de la aplicación.

**Rationale**: las tablas grandes que ya iban por lotes nunca dieron problema
—`ps_stock_tienda` con 13,5 M lo hace tienda a tienda por [D-004](D-004-stock-sync-per-store.md),
y ventas, pagos y traspasos con `BATCH_SIZE`—. El patrón correcto ya existía en
el código; lo que faltaba era que nadie pudiera saltárselo por descuido.

**See**: `etl/db/postgres.py`, `etl/sync/mayorista.py`,
`etl/tests/test_tablas_grandes_troceadas.py`, [D-050](D-050-upsert-batch-loss.md),
[D-058](D-058-wrenai-retirado.md).
