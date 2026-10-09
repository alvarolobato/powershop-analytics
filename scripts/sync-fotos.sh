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
#   FOTOS_HOST_DIR    raiz del espejo: la MISMA variable que monta docker-compose
#                     (def. ./data/fotos, relativa al directorio del .env).
#   FOTOS_DEST        fuerza otro destino (tests, pruebas a mano).
#   FOTOS_ALLOW_SHRINK=1  permite que el espejo encoja mas de un 10 %.
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
STACK_DIR="$HOME/powershop"
if [ -n "${FOTOS_ENV_FILE:-}" ] && [ -f "$FOTOS_ENV_FILE" ]; then
    STACK_DIR="$(cd "$(dirname "$FOTOS_ENV_FILE")" && pwd)"
    : "${FOTOS_SMB_URL:=$(leer_env FOTOS_SMB_URL "$FOTOS_ENV_FILE")}"
    : "${FOTOS_SMB_SUBDIR:=$(leer_env FOTOS_SMB_SUBDIR "$FOTOS_ENV_FILE")}"
    : "${FOTOS_HOST_DIR:=$(leer_env FOTOS_HOST_DIR "$FOTOS_ENV_FILE")}"
fi

FOTOS_SMB_SUBDIR="${FOTOS_SMB_SUBDIR:-PS_Ficheros/Imagenes}"

# El destino es EL MISMO directorio que monta el contenedor: FOTOS_HOST_DIR, la
# variable que lee docker-compose. Una ruta relativa se resuelve contra el
# directorio del stack, igual que hace Compose. Si el espejo se escribiera en
# un sitio y el contenedor montara otro, no habria fotos ni error.
if [ -z "${FOTOS_DEST:-}" ]; then
    FOTOS_DEST="${FOTOS_HOST_DIR:-./data/fotos}"
    # Compose expande ~ y ${HOME} en el .env; aqui hay que hacer lo mismo o el
    # espejo acabaria en un directorio literal "~" que el contenedor no monta.
    # shellcheck disable=SC2016,SC2088  # ~, $HOME y ${HOME} son patrones literales a proposito
    case "$FOTOS_DEST" in
        "~") FOTOS_DEST="$HOME" ;;
        "~/"*) FOTOS_DEST="$HOME/${FOTOS_DEST#"~/"}" ;;
        '${HOME}'*) FOTOS_DEST="$HOME${FOTOS_DEST#'${HOME}'}" ;;
        '$HOME'*) FOTOS_DEST="$HOME${FOTOS_DEST#'$HOME'}" ;;
    esac
    case "$FOTOS_DEST" in
        *'$'* | *'~'*)
            echo "sync-fotos: FOTOS_HOST_DIR=$FOTOS_DEST usa una expansion que no se interpretar; pon una ruta absoluta" >&2
            exit 1
            ;;
    esac
    case "$FOTOS_DEST" in
        /*) ;;
        *) FOTOS_DEST="$STACK_DIR/${FOTOS_DEST#./}" ;;
    esac
fi

# Una sola ejecucion a la vez: la primera copia dura horas y el job diario (o
# un lanzamiento a mano) no debe solaparse con ella. mkdir es atomico. Ruta
# fija y no $TMPDIR: launchd y una shell por ssh ven TMPDIR distintos y no se
# excluirian. El lock lleva el PID de su dueno: si ese proceso ya no existe
# (kill -9, apagon), se reclama en vez de dejar el espejo congelado para siempre.
LOCK="${FOTOS_LOCK:-/tmp/psfotos-sync.lock}"
if ! mkdir "$LOCK" 2>/dev/null; then
    dueno="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -n "$dueno" ] && kill -0 "$dueno" 2>/dev/null; then
        echo "sync-fotos: ya hay una sincronizacion en curso (pid $dueno, $LOCK)" >&2
        exit 1
    fi
    echo "sync-fotos: lock huerfano de un proceso que ya no existe (pid ${dueno:-desconocido}); lo reclamo" >&2
    rm -rf "$LOCK"
    mkdir "$LOCK"
fi
echo "$$" > "$LOCK/pid"
MOUNT_POINT=""
RSYNC_PID=""
cleanup() {
    # Si nos matan a mitad, el rsync hijo no debe seguir escribiendo sin lock
    # ni con el share desmontado debajo.
    if [ -n "$RSYNC_PID" ]; then
        kill "$RSYNC_PID" 2>/dev/null || true
        wait "$RSYNC_PID" 2>/dev/null || true
    fi
    if [ -n "$MOUNT_POINT" ]; then
        umount "$MOUNT_POINT" 2>/dev/null \
            || diskutil unmount force "$MOUNT_POINT" >/dev/null 2>&1 \
            || echo "sync-fotos: no se pudo desmontar $MOUNT_POINT; desmontalo a mano" >&2
        rmdir "$MOUNT_POINT" 2>/dev/null || true
    fi
    rm -rf "$LOCK"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

if [ -n "${FOTOS_SRC_DIR:-}" ]; then
    SRC="$FOTOS_SRC_DIR"
else
    FOTOS_SMB_URL="${FOTOS_SMB_URL:?define FOTOS_SMB_URL en el .env (ver .env.example)}"
    MOUNT_POINT="$(mktemp -d /tmp/psfotos.XXXXXX)"
    mount_smbfs -o ro,nobrowse "$FOTOS_SMB_URL" "$MOUNT_POINT"
    SRC="$MOUNT_POINT/$FOTOS_SMB_SUBDIR"
fi

contar_fotos() {
    find "$1" -mindepth 1 -maxdepth 1 -type f \
        \( -name '*.jpg' -o -name '*.JPG' -o -name '*.jpeg' -o -name '*.JPEG' \) | wc -l | tr -d ' '
}

# GUARD de un directorio. Aborta si el origen no esta, enumera vacio o trae
# bastantes menos fotos que el espejo: un share a medio caer que lista solo una
# parte haria que --delete borrase el resto. Mismo criterio que D-063 para las
# cargas del ETL: una carga que encoge mas de un 10 % es perdida de datos, no
# una actualizacion. FOTOS_ALLOW_SHRINK=1 lo permite cuando el borrado es real.
guard() {
    local d="$1" en_origen en_espejo
    if [ ! -d "$SRC/$d" ]; then
        echo "sync-fotos: $SRC/$d no existe — aborto sin tocar el espejo" >&2
        exit 1
    fi
    if [ -z "$(find "$SRC/$d" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
        echo "sync-fotos: $SRC/$d enumera vacio — aborto sin tocar el espejo" >&2
        exit 1
    fi
    [ -d "$FOTOS_DEST/$d" ] || return 0
    # Con pipefail, un find que falla a medias tumbaria el script sin decir nada.
    en_espejo="$(contar_fotos "$FOTOS_DEST/$d")" || {
        echo "sync-fotos: no se pudo contar $FOTOS_DEST/$d — aborto sin tocar el espejo" >&2
        exit 1
    }
    [ "$en_espejo" -gt 0 ] || return 0
    en_origen="$(contar_fotos "$SRC/$d")" || {
        echo "sync-fotos: no se pudo contar $SRC/$d — aborto sin tocar el espejo" >&2
        exit 1
    }
    # Las dos condiciones: mas de un 10 % Y mas de 20 fotos. Sin el suelo
    # absoluto, retirar 2 fotos de un directorio con 15 pararia el job.
    if [ "${FOTOS_ALLOW_SHRINK:-0}" != "1" ] \
        && [ $((en_origen * 10)) -lt $((en_espejo * 9)) ] \
        && [ $((en_espejo - en_origen)) -gt 20 ]; then
        echo "sync-fotos: $SRC/$d lista $en_origen fotos y el espejo tiene $en_espejo (mas de un 10 % y de 20 fotos menos) — aborto sin borrar nada. Si el borrado es real: FOTOS_ALLOW_SHRINK=1" >&2
        exit 1
    fi
}

# Los cuatro origenes se comprueban ANTES del primer rsync con --delete, y cada
# uno otra vez justo antes del suyo: la primera copia dura horas y el share
# puede degradarse a mitad.
for d in 1 2 3 4; do
    guard "$d"
done

copiados=0
for d in 1 2 3 4; do
    guard "$d"
    mkdir -p "$FOTOS_DEST/$d"
    # -rt y no -a: tamano + mtime es la senal incremental correcta. Nada de
    # --checksum, que releeria los 3,5 GB por VPN cada noche.
    rsync -rt --delete \
        --include='*.jpg' --include='*.JPG' \
        --include='*.jpeg' --include='*.JPEG' \
        --exclude='*' \
        "$SRC/$d/" "$FOTOS_DEST/$d/" &
    RSYNC_PID=$!
    wait "$RSYNC_PID"
    RSYNC_PID=""
    n="$(find "$FOTOS_DEST/$d" -mindepth 1 -maxdepth 1 -type f | wc -l)"
    copiados=$((copiados + n))
done

# Marcador de estado. Solo se escribe si todo fue bien (set -e corta antes en
# cualquier fallo), igual que el watermark del ETL solo avanza con exito.
printf '{"last_sync":"%s","ficheros":%d}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$copiados" > "$FOTOS_DEST/.last-sync.json"

echo "sync-fotos: $copiados ficheros en $FOTOS_DEST"
