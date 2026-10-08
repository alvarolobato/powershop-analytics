#!/usr/bin/env bash
# Espeja las fotos de articulo del share de PowerShop a disco local.
# Diario via launchd. Solo en produccion. Ver docs/decisions/D-068-fotos-por-convencion-de-ruta.md
#
# El servidor no necesita rsync: se ejecuta aqui y copia entre dos rutas
# locales, el punto de montaje SMB (solo lectura) y el espejo.
#
# Variables:
#   FOTOS_SMB_URL     //usuario:clave@HOST/SHARE. Obligatoria salvo con FOTOS_SRC_DIR.
#   FOTOS_SMB_SUBDIR  ruta de Imagenes dentro del share (def. PS_Ficheros/Imagenes).
#   FOTOS_DEST        raiz del espejo (def. ~/powershop/data/fotos).
#   FOTOS_ENV_FILE    .env del que leer las anteriores si no vienen en el entorno.
#   FOTOS_SRC_DIR     origen ya montado: salta el mount_smbfs. Lo usan los tests
#                     y sirve para reintentar a mano contra un montaje existente.
set -euo pipefail

# launchd no carga el .env del stack, asi que se leen de el las claves que
# falten. Se extraen una a una en vez de hacer `source`: el fichero trae valores
# (un JSON entre comillas, por ejemplo) que bash no tiene por que saber evaluar.
leer_env() {
    local clave="$1" fichero="$2" linea
    linea="$(grep -E "^${clave}=" "$fichero" 2>/dev/null | tail -n 1)" || return 0
    linea="${linea#*=}"
    # Sin comentario de cola ni comillas envolventes.
    linea="${linea%%[[:space:]]#*}"
    linea="${linea%"${linea##*[![:space:]]}"}"
    linea="${linea#[\"\']}"
    linea="${linea%[\"\']}"
    printf '%s' "$linea"
}

if [ -z "${FOTOS_ENV_FILE:-}" ]; then
    for candidato in "$HOME/powershop/.env" "$HOME/.config/powershop-analytics/.env"; do
        if [ -f "$candidato" ]; then
            FOTOS_ENV_FILE="$candidato"
            break
        fi
    done
fi
if [ -n "${FOTOS_ENV_FILE:-}" ] && [ -f "$FOTOS_ENV_FILE" ]; then
    : "${FOTOS_SMB_URL:=$(leer_env FOTOS_SMB_URL "$FOTOS_ENV_FILE")}"
    : "${FOTOS_SMB_SUBDIR:=$(leer_env FOTOS_SMB_SUBDIR "$FOTOS_ENV_FILE")}"
    : "${FOTOS_DEST:=$(leer_env FOTOS_DEST "$FOTOS_ENV_FILE")}"
fi

FOTOS_SMB_SUBDIR="${FOTOS_SMB_SUBDIR:-PS_Ficheros/Imagenes}"
FOTOS_DEST="${FOTOS_DEST:-$HOME/powershop/data/fotos}"

if [ -n "${FOTOS_SRC_DIR:-}" ]; then
    SRC="$FOTOS_SRC_DIR"
else
    FOTOS_SMB_URL="${FOTOS_SMB_URL:?define FOTOS_SMB_URL en el .env (ver .env.example)}"

    MOUNT_POINT="$(mktemp -d /tmp/psfotos.XXXXXX)"
    cleanup() {
        umount "$MOUNT_POINT" 2>/dev/null || true
        rmdir "$MOUNT_POINT" 2>/dev/null || true
    }
    trap cleanup EXIT

    mount_smbfs -o ro,nobrowse "$FOTOS_SMB_URL" "$MOUNT_POINT"
    SRC="$MOUNT_POINT/$FOTOS_SMB_SUBDIR"
fi

# GUARD: los cuatro origenes se comprueban ANTES del primer rsync con --delete.
# Sin esto, un share caido o a medio montar vaciaria el espejo entero.
for d in 1 2 3 4; do
    if [ ! -d "$SRC/$d" ]; then
        echo "sync-fotos: $SRC/$d no existe — aborto sin tocar el espejo" >&2
        exit 1
    fi
    if [ -z "$(find "$SRC/$d" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
        echo "sync-fotos: $SRC/$d enumera vacio — aborto sin tocar el espejo" >&2
        exit 1
    fi
done

copiados=0
for d in 1 2 3 4; do
    mkdir -p "$FOTOS_DEST/$d"
    # -rt y no -a: tamano + mtime es la senal incremental correcta. Nada de
    # --checksum, que releeria los 3,5 GB por VPN cada noche.
    rsync -rt --delete \
        --include='*.jpg' --include='*.JPG' \
        --include='*.jpeg' --include='*.JPEG' \
        --exclude='*' \
        "$SRC/$d/" "$FOTOS_DEST/$d/"
    n="$(find "$FOTOS_DEST/$d" -mindepth 1 -maxdepth 1 -type f | wc -l)"
    copiados=$((copiados + n))
done

# Marcador de estado. Solo se escribe si todo fue bien (set -e corta antes en
# cualquier fallo), igual que el watermark del ETL solo avanza con exito.
printf '{"last_sync":"%s","ficheros":%d}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$copiados" > "$FOTOS_DEST/.last-sync.json"

echo "sync-fotos: $copiados ficheros en $FOTOS_DEST"
