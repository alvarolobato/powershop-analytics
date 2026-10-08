---
id: D-068
title: Las fotos de artículo se resuelven por convención de ruta sobre un espejo local
date: 2026-10-08
---

# D-068: Las fotos de artículo se resuelven por convención de ruta sobre un espejo local

*Decidido: 2026-10-08*

**Context**:

Se quiere ver la foto de un artículo en el dashboard: al pasar el ratón sobre un código, referencia o descripción, y ampliada al hacer click. Cada artículo tiene hasta 4 fotos.

En 4D, `Articulos` trae `Path`, `Path2`, `Path3`, `Path4` con la forma `W:\PS_Ficheros\Imagenes\{slot}\{codigo}.jpg`, donde `W:` es una unidad mapeada al share de ficheros del servidor PowerShop. Lo natural habría sido sincronizar esos campos. Medido contra el servidor y la BD reales (2026-10-08), no aportan nada:

| Hecho | Medida |
|---|---|
| Valores de `Path`..`Path4` comparados uno a uno con el patrón derivado del código | 171.928 de 171.928 exactos, 0 desviaciones |
| Paths rellenos aunque el fichero no exista | sí (el artículo 169 tiene los 4 y ninguna foto) |
| `Articulos.TieneImagen` | `False` en los 42.982 registros |
| `Articulos.Imagen`, `Imagen2..4` (Picture/Blob) | vacíos |
| Otras tablas con clave de artículo + imagen (`FAMateriales`, `Catalogos`, `FOFotografiaCotejo`, `WebImagenesCarrusel`) | 0 filas |
| Artículos con al menos una foto en disco | 6.876 de 42.880 (16 %) |
| Ficheros que cumplen el patrón en `1..4` | 12.666, ~278 KB de media, ~3,5 GB |

La verdad sobre qué fotos existen está solo en el sistema de ficheros, y PowerShop deriva la ruta del código igual que nosotros.

Latencias del share por VPN, con acceso directo por ruta y sin listar:

| Operación | Mediana | p90 |
|---|---|---|
| `stat` de una foto que existe | 57 ms | 65 ms |
| leer el JPEG completo en frío | 346 ms | **5,25 s** |
| `rsync` sobre el montaje | 0,21 MB/s | |

La cola de 5 s no depende del tamaño del fichero: es varianza del enlace.

**Decision**:

1. **La ruta se deriva, nunca se consulta**: `{FOTOS_DIR}/{slot}/{codigo}.jpg`, con `slot` 1..4 = 1ª..4ª foto. Saber si un artículo tiene foto es un `stat()` local. El único punto que toca el filesystem es `dashboard/lib/fotos.ts`.
2. **No hay tabla de fotos ni paso de ETL.** No se tocan `etl/schema/init.sql`, `etl/main.py`, `etl/sync/*` ni `config/schema.yaml`. `Articulos.Path*` y `TieneImagen` no se leen desde la app.
3. **Espejo local diario, solo en producción.** Un job launchd (`com.powershop.fotos-sync`, 01:00) monta el share en solo lectura y hace `rsync -rt --delete` de los directorios `1..4` a `<stack>/data/fotos`. El contenedor del dashboard lo ve en `/fotos`, montado `:ro`.
4. **Nunca se lista un directorio en el camino de una petición.** Solo acceso directo por ruta derivada.
5. **El espejo no se vacía por un share caído.** `scripts/sync-fotos.sh` comprueba que los cuatro orígenes existen y enumeran algo antes del primer `rsync --delete`. El marcador `.last-sync.json` solo se escribe si todo fue bien, igual que el watermark del ETL ([D-065](D-065-watermark-solo-avanza-con-exito.md)).
6. **Miniaturas WebP bajo demanda**, con `sharp`, cacheadas en `FOTOS_CACHE_DIR` con el `mtime` del original en la clave: una foto sobrescrita invalida su miniatura sola y no hace falta ningún job de limpieza.
7. **Por defecto no se muestran fotos.** Solo hover; una columna de miniaturas aparece únicamente si el spec trae `mostrar_fotos: true`, que el LLM pone solo cuando el usuario lo pide.
8. **La descripción no identifica un artículo.** Una foto se resuelve por código, o por referencia traducida a código; nunca por descripción sola.
9. **Alerta de desviación en vez de sincronizar los paths.** Los `PATH IMAGEM` son campos editables en PowerShop. `scripts/check-fotos-paths.py` corre en el mismo job, extrae los ~172.000 valores y avisa si alguno deja de seguir la convención.

**Alternatives rejected**:

- **Leer del share en vivo desde la app.** Un hover podría tardar 5 s, y la app dependería de la VPN en cada petición.
- **Inventario de fotos en PostgreSQL** (tabla nueva alimentada por el ETL). Innecesario con el espejo local: un `stat` cuesta microsegundos y nunca está desfasado respecto al fichero que se va a servir. Añadiría un paso al ETL, que ya es la pieza más frágil del sistema.
- **Sincronizar `Path..Path4` a `ps_articulos`.** Son 171.928 valores idénticos a lo que se deduce del código, rellenos incluso cuando no hay fichero. Queda como salida si las desviaciones llegaran a ser frecuentes: 4 columnas y traducir `W:\` a la raíz del espejo.
- **`rsync -a` o `--checksum`.** `-a` arrastra permisos y propietarios que en SMB no significan nada; `--checksum` releería los 3,5 GB por VPN cada noche. Tamaño + mtime (`-rt`) es la señal incremental correcta.
- **Generar las miniaturas al copiar.** Solo se piden las de los artículos que alguien mira; el 84 % del catálogo no tiene foto.
- **FTP/FTPS** (el servidor lo expone, no SFTP). Exigiría credenciales nuevas sin saber si mejora los 0,21 MB/s. Plan B si se retirase el acceso SMB, con `lftp mirror`.

**Rationale**:

Derivar la ruta elimina la única fuente de datos que podía mentir. El espejo saca la varianza del enlace del camino del usuario y la deja en un job nocturno donde no molesta. Y como nada de esto pasa por el ETL ni por el esquema, una avería en las fotos no puede afectar a los datos: lo peor que ocurre es que no se ven.

Consecuencias asumidas:

- **Frescura de 24 h**: una foto subida hoy aparece mañana.
- Si alguien escribe un `PATH IMAGEM` fuera de la convención, ese artículo deja de mostrar esa foto. Degrada en silencio y nunca enseña la foto de otro artículo; el chequeo diario lo avisa.
- Los ~99 códigos duplicados de `Articulos` comparten foto. Es fiel al origen: el fichero se llama por código.
- De los nombres que no cumplen `{codigo}.jpg` (`<cod>.1.jpg`, `<cod> (2).jpg`, basura) se pierden 9 ficheros de 12.666; todos los demás son duplicados de uno que sí cumple.
- Los endpoints de fotos van sin autenticación, igual que `/api/query`.
- La primera copia son ~4,6 h (extrapolado de 0,21 MB/s) y el delta nocturno ~15 min.

**Trampa de 4D SQL descubierta al verificarlo**: `COUNT(*)` devuelve `NULL`, no `0`, sobre un resultado vacío. No sirve para concluir "no hay desviaciones"; hay que extraer y comparar. Documentado en `docs/skills/data-access.md`.

**See**:

- Plan completo, con todas las medidas: [`docs/proposals/fotos-de-articulo.md`](../proposals/fotos-de-articulo.md)
- Espejo: `scripts/sync-fotos.sh`, `scripts/fotos-sync-job.sh`, `scripts/install-fotos-sync-launchd.sh`, `scripts/launchd/com.powershop.fotos-sync.plist.template`
- Alerta: `scripts/check-fotos-paths.py`
- App: `dashboard/lib/fotos.ts`, `dashboard/app/api/fotos/`, `dashboard/app/api/articulos/fotos/`
- Operación: [`docs/deployment/production.md`](../deployment/production.md) § Fotos de artículo
- Relacionadas: [D-001](D-001-postgres-mirror.md) (la app no toca 4D), [D-002](D-002-bind-mounts.md) (bind mounts), [D-067](D-067-vigia-del-socket-de-4d.md) (por qué el chequeo lleva un tope de reloj)
