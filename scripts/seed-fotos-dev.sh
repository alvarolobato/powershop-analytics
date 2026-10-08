#!/usr/bin/env bash
# Siembra fotos SINTETICAS de articulo para desarrollo (D-068).
#
# El espejo real (~3,5 GB) solo existe en produccion. Esto crea
# ./data/fotos/{1..4}/{codigo}.jpg con JPEG minimos (96x96, un color por slot)
# para que el hover y el lightbox se puedan ver sin VPN ni share.
#
# Uso:
#   scripts/seed-fotos-dev.sh                 # 12 codigos del PostgreSQL de dev
#   scripts/seed-fotos-dev.sh 144750 132374   # estos codigos
#   FOTOS_HOST_DIR=/otra/ruta scripts/seed-fotos-dev.sh
#
# Reparto: el 1er codigo recibe 1 foto, el 2o dos, el 3o tres, el 4o cuatro, y
# vuelta a empezar. El resto del catalogo queda sin foto, que es lo normal:
# solo el 16 % de los articulos reales tiene alguna.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${FOTOS_HOST_DIR:-$REPO_ROOT/data/fotos}"
N="${SEED_FOTOS_N:-12}"

# El marcador lo escribe sync-fotos.sh: si esta, esto es un espejo de verdad.
if [ -e "$DEST/.last-sync.json" ]; then
    echo "seed-fotos-dev: $DEST es un espejo real (.last-sync.json); no lo toco" >&2
    exit 1
fi

# Un JPEG de 96x96 por slot: rojo, azul, verde y morado, con una barra blanca
# que se desplaza. Basta para distinguir a ojo que foto se esta viendo.
jpeg_slot() {
    case "$1" in
        1) echo '/9j/2wBDAA0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//2wBDAQ0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//wgARCABgAGADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAYFB//EABkBAQEBAQEBAAAAAAAAAAAAAAAEBQMCBv/aAAwDAQACEAMQAAAAyxm/VAAAAAAN3Cufc7D6LLd4IYS64AAC5hrnpLUy1TLU5UMIt8AABcw1z0lqZaplqcqGEW+AAAuYbd9z9FlmH3gwhLrgAAAAAAAf/8QAJxAAAAMFBwUAAAAAAAAAAAAABhJFBRMwg8IAEBEUFSRCFkBlo+L/2gAIAQEAAT8A7tisXVsxuHTonA2JrdF+R9X1ZtMXScvuHr0/AuBYQLUZVVw0TptMIFqMqq4aJ02mEC1GVVcNE6bTCBajKquGidNphAtRlVXDROm0wgWoyqrhonTaYTFbWk5jbvXpOZcC2608d7fmzabWrZfbunR+ZsTd/wD/xAAaEQADAAMBAAAAAAAAAAAAAAABAgMAIDMw/9oACAECAQE/AN5gM4Byk0VCQNY9Fy3NtY9Fy3NtZkK4JylEZCAfL//EAB8RAAEEAgMBAQAAAAAAAAAAAAIBAwQRALEgNIFBMP/aAAgBAwEBPwDnKMm2DMFokreRZT7j4AZ2K38TjO6rnm8g9pv3XGd1XPN5B7TfuuMoCcYMASyWt5FivtvgZhQpf1Py/9k=' ;;
        2) echo '/9j/2wBDAA0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//2wBDAQ0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//wgARCABgAGADASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAYFBwT/xAAXAQEBAQEAAAAAAAAAAAAAAAAABAUD/9oADAMBAAIQAxAAAADxjawQAAAAAANrbUsOjz/FtYqmQOvEAAC1pZqlzNeairWKtgDtOAABa0s1S5mvNRVrFWwB2nAAAtaXn+3DooraxaZA68QAAAAAAP/EACcQAAADBQcFAAAAAAAAAAAAAAYSRQUTMIPCABARFBUkQhZAZaPi/9oACAEBAAE/AO8Y7H1TMbh06LxNia3R/kPV9WbDH0vL7h69NxLgWED1CVVcME+bTCB6hKquGCfNphA9QlVXDBPm0wgeoSqrhgnzaYQPUJVVwwT5tMIHqEqq4YJ82mEx2xpeY2716XkXAtusPH+35s2GxqmX27p0bkbE3ff/xAAeEQEAAQMFAQAAAAAAAAAAAAACAwAEMyAhMIGxMf/aAAgBAgEBPwDgmmlEqJW1QpOIpfdNxmfXlW+Ed+6bjM+vKt8I790zQyuVInaoShESvvD/AP/EAB4RAAIABwEBAAAAAAAAAAAAAAIDAAEEETOBsSAw/9oACAEDAQE/APghCjUJEN5w8RBpCMrS802AN9ipznrnmmwBvsVOc9c8oeoFCJFacPITaRDO8vj/AP/Z' ;;
        3) echo '/9j/2wBDAA0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//2wBDAQ0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//wgARCABgAGADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAYFAv/EABkBAQADAQEAAAAAAAAAAAAAAAADBAUCBv/aAAwDAQACEAMQAAAA5FXzIAAAAAADYx7Dqdj3E/JfjxDkgAALCPsO7VBP0E/Jpx4gwgAAFhH2Hdqgn6Cfk048QYQAACwj9jqe4n2PJfxxDkgAAAAAAf/EACYQAAADBgUFAAAAAAAAAAAAAAYSEwUQMESDwgARFSNCFkBko+L/2gAIAQEAAT8A71ksnUl99NMvE2ZsdJ+d6/rDWZOmob6ihuJciwgnPU7nCyRqWwgnPU7nCyRqWwgnPU7nCyRqWwgnPU7nCyRqWwgnPU7nCyRqWwgnPU7nCyRqWwmS1tNX2FFC8i5Fx1Z4Ps+cNZrakhsJpm5GzN3v/8QAGREBAQADAQAAAAAAAAAAAAAAAQIAIDIw/9oACAECAQE/APCQaMqZJUNY6Mvl1joy+XWUKMqpZQfH/8QAHxEAAQQBBQEAAAAAAAAAAAAAAgEDBBGxACAwNIFB/9oACAEDAQE/AOCMAm+Aklot41JjMAwZCFKlfV2w+y37jUzrOeZ2w+y37jUzrOeZ2xjEHwIlpEvGpMlg2DETtVr4vD//2Q==' ;;
        4) echo '/9j/2wBDAA0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//2wBDAQ0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//wgARCABgAGADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAYFB//EABgBAQEBAQEAAAAAAAAAAAAAAAAEAwUC/9oADAMBAAIQAxAAAADPHZ6IAAAAAAAG5tqeGbnuHbxFOwa+wAALenmKfmRTERbxFlIb6AAAW9PMU/MimIi3iLKQ30AAAt6fnu3DMiNzDp2DX2AAAAAB/8QAJxAAAAMFBwUAAAAAAAAAAAAABhJFBRMwg8IAEBEUFSRCFkBlo+L/2gAIAQEAAT8A75jMbVcxuHTonA2JrdG+Q9X1ZssbSsvuHr0/AuBYQNUJVVwyT5tMIGqEqq4ZJ82mEDVCVVcMk+bTCBqhKquGSfNphA1QlVXDJPm0wgaoSqrhknzaYTGbOlZjbvXpOZcC26y8f7fmzZbOq5fbunR+ZsTd5//EAB4RAAIBBAMBAAAAAAAAAAAAAAIDAQAEM4EgITAx/9oACAECAQE/APFzmCwoguqSUksZn7xuMx6q3whvjcZj1VvhDfFyWEwpgeqSMisYn74f/8QAGhEAAwADAQAAAAAAAAAAAAAAAQIDACAzMP/aAAgBAwEBPwDxpR1cgHJksgJ1t0bI811t0bI811pN2ckDJgqgB8P/2Q==' ;;
    esac
}

# Sin argumentos: codigos del PostgreSQL de dev. Se prefieren los que tienen
# ventas recientes para que salgan en los dashboards de plantilla.
codigos_de_postgres() {
    (cd "$REPO_ROOT" && docker compose exec -T postgres sh -c \
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v n='"$N"' -f -' <<'SQL'
SELECT codigo FROM (
    SELECT lv.codigo, SUM(lv.unidades) AS uds
      FROM ps_lineas_ventas lv
      JOIN ps_articulos a ON a.codigo = lv.codigo
     WHERE lv.codigo ~ '^[A-Za-z0-9_-]{1,40}$'
       AND lv.fecha_creacion >= (SELECT MAX(fecha_creacion) - 90 FROM ps_lineas_ventas)
     GROUP BY lv.codigo
     ORDER BY uds DESC NULLS LAST
     LIMIT :n
) t;
SQL
    )
}

if [ "$#" -gt 0 ]; then
    CODIGOS=("$@")
else
    CODIGOS=()
    while IFS= read -r c; do
        [ -n "$c" ] && CODIGOS+=("$c")
    done < <(codigos_de_postgres)
    if [ "${#CODIGOS[@]}" -eq 0 ]; then
        echo "seed-fotos-dev: PostgreSQL no devolvio codigos (¿stack levantado?)." >&2
        echo "  Pasa los codigos a mano: scripts/seed-fotos-dev.sh 144750 132374" >&2
        exit 1
    fi
fi

for d in 1 2 3 4; do
    mkdir -p "$DEST/$d"
done

i=0
for codigo in "${CODIGOS[@]}"; do
    # La misma regla que valida la app: nada que pueda escapar del directorio.
    if ! [[ "$codigo" =~ ^[A-Za-z0-9_-][A-Za-z0-9._-]{0,39}$ ]]; then
        echo "seed-fotos-dev: codigo no valido, lo salto: $codigo" >&2
        continue
    fi
    nfotos=$(( i % 4 + 1 ))
    for slot in $(seq 1 "$nfotos"); do
        jpeg_slot "$slot" | base64 -d > "$DEST/$slot/$codigo.jpg"
    done
    echo "  $codigo → $nfotos foto(s)"
    i=$(( i + 1 ))
done

echo "seed-fotos-dev: $i articulos sembrados en $DEST"
