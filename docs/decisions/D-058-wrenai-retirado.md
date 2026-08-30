---
id: D-058
title: WrenAI se retira de producción
date: 2026-08-30
---

# D-058: WrenAI se retira de producción

*Decidido: 2026-08-30*

**Context**: El Mac de producción tiene 16 GB y estaba con 46 MB libres y
4.463 MB comprimidos. Las sincronizaciones completas del ETL fallaban **104 de
132 veces (79 %)**, siempre en el mismo punto y sin dejar traza: salida limpia
con código 0, `OOMKilled=false`, contenedor reiniciado. La causa inmediata era
que dos tablas de un millón de filas usaban el camino que materializa todo
(ver [D-059](D-059-tablas-grandes-troceadas.md)), pero la causa de fondo era
que en la máquina conviven tres proyectos y no sobraba memoria para nadie.

Los seis contenedores de WrenAI (`wren-ui`, `wren-ai-service`, `wren-engine`,
`ibis-server`, `qdrant`, `bootstrap`) sumaban **1,2 GB**. El dashboard hace el
mismo trabajo —texto a SQL sobre el espejo— y es la interfaz que se usa.

**Decision**: WrenAI sale de producción y del `docker-compose`. Con él salen
sus dependencias exclusivas: `qdrant` (sólo lo usaba su RAG), `ibis-server` y
`wren-engine` (capa semántica), y `bootstrap`. El dashboard nunca dependió de
ellos: su único `depends_on` es `postgres`.

El empuje de conocimiento (`ps prod push-knowledge` y el paso automático de
`ps prod deploy`) desaparece: el conocimiento vive ahora sólo en
`dashboard/lib/knowledge.ts`, que viaja dentro de la imagen del dashboard.

`ps wren validate` **se conserva**: ejecuta los pares SQL contra PostgreSQL y
no depende de WrenAI. Es la comprobación que evita que un par mal escrito
llegue al bundle del modelo, y hoy es más valiosa que nunca porque el bundle
es la única fuente de conocimiento que le queda al dashboard.

**Alternatives rejected**: dejarlo parado sin tocar el compose — el siguiente
`ps prod deploy` lo habría resucitado. Subir la RAM de la VM de Docker — ayuda,
pero no justifica mantener 1,2 GB de un subsistema que nadie usa.

**Rationale**: dos interfaces de texto a SQL sobre el mismo espejo es una de
más, y la que sobra es la que cuesta 1,2 GB y seis contenedores. Retirarla
libera memoria en la máquina que más la necesitaba y elimina un camino de
conocimiento que había que mantener sincronizado con el otro.

**See**: D-005 a D-009 (retiradas por esta), `docker-compose.yml`,
`cli/commands/prod.sh`, `cli/commands/wren.sh`.
