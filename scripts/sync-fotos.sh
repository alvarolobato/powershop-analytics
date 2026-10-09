#!/usr/bin/env bash
# Espeja las fotos de articulo del share de PowerShop a disco local.
# Diario via launchd. Solo en produccion. Ver docs/decisions/D-068-fotos-por-convencion-de-ruta.md
#
# El servidor no necesita nada instalado: se habla SMB con rclone desde aqui, en
# espacio de usuario y sin montar ningun volumen. Ver el bloque "Dos modos de
# origen" mas abajo para por que no se monta el share.
#
# Variables:
#   FOTOS_SMB_URL     //[usuario[:clave]@]HOST/SHARE. Obligatoria salvo con FOTOS_SRC_DIR.
#   FOTOS_SMB_SUBDIR  ruta de Imagenes dentro del share (def. PS_Ficheros/Imagenes).
#   FOTOS_RCLONE      binario de rclone (def. el del PATH).
#   FOTOS_TRANSFERS   copias en paralelo (def. 16).
#   FOTOS_HOST_DIR    raiz del espejo: la MISMA variable que monta docker-compose
#                     (def. ./data/fotos, relativa al directorio del .env).
#   FOTOS_DEST        fuerza otro destino (tests, pruebas a mano).
#   FOTOS_ALLOW_SHRINK=1  permite que el espejo encoja mas de un 10 %.
#   FOTOS_ENV_FILE    .env del que leer las anteriores si no vienen en el entorno.
#   FOTOS_LOCK        ruta del lock (def. /tmp/psfotos-sync.lock). Solo para tests.
#   FOTOS_SRC_DIR     origen ya montado: salta el mount_smbfs. Lo usan los tests
#                     y sirve para reintentar a mano contra un montaje existente.
set -euo pipefail

# launchd no carga el .env del stack, asi que se leen de el las claves que
# falten. Se extraen una a una en vez de hacer `source`: el fichero trae valores
# (un JSON entre comillas, por ejemplo) que bash no tiene por que saber evaluar.
leer_env() {
    local clave="$1" fichero="$2" linea
    # Compose acepta tambien `export CLAVE=valor`.
    linea="$(grep -E "^(export[[:space:]]+)?${clave}=" "$fichero" 2>/dev/null | tail -n 1)" || return 0
    linea="${linea%$'\r'}"
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
        # Solo la variable HOME exacta: "$HOMEDIR/x" es OTRA variable y cae
        # en el aborto de abajo.
        '${HOME}' | '${HOME}/'*) FOTOS_DEST="$HOME${FOTOS_DEST#'${HOME}'}" ;;
        '$HOME' | '$HOME/'*) FOTOS_DEST="$HOME${FOTOS_DEST#'$HOME'}" ;;
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
# un lanzamiento a mano) no debe solaparse con ella.
#
# El lock es un ENLACE SIMBOLICO cuyo destino es el PID del dueno: `ln -s` es
# atomico y el PID esta desde el primer instante (con un directorio + fichero
# habia una ventana sin PID). Ruta fija y no $TMPDIR: launchd y una shell por
# ssh ven TMPDIR distintos y no se excluirian. Nunca se hace `rm -rf` sobre el
# lock: una ruta mal puesta en FOTOS_LOCK no puede borrar un directorio.
LOCK="${FOTOS_LOCK:-/tmp/psfotos-sync.lock}"

# Un lock cuyo dueno ya no existe (kill -9, apagon) se reclama, en vez de dejar
# el espejo congelado para siempre. El PID puede haberlo heredado otro proceso:
# solo cuenta como vivo si ademas es un sync-fotos.
lock_vivo() {
    local pid="$1"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    case "$(ps -p "$pid" -o command= 2>/dev/null)" in
        *sync-fotos*) return 0 ;;
        *) return 1 ;;
    esac
}

if [ -e "$LOCK" ] && [ ! -L "$LOCK" ]; then
    echo "sync-fotos: $LOCK existe y no es un lock mio; no lo toco. Revisa FOTOS_LOCK." >&2
    exit 1
fi
if ! ln -s "$$" "$LOCK" 2>/dev/null; then
    dueno="$(readlink "$LOCK" 2>/dev/null || true)"
    if lock_vivo "$dueno"; then
        echo "sync-fotos: ya hay una sincronizacion en curso (pid $dueno, $LOCK)" >&2
        exit 1
    fi
    echo "sync-fotos: lock huerfano de un proceso que ya no existe (pid ${dueno:-desconocido}); lo reclamo" >&2
    # Sin mas ceremonia: el job corre una vez al dia. Si dos arranques vieran el
    # mismo lock muerto en el mismo instante, el ln de uno falla y sale; en el
    # peor caso dos rsync al mismo destino no pierden datos.
    rm -f "$LOCK"
    if ! ln -s "$$" "$LOCK" 2>/dev/null; then
        echo "sync-fotos: otra ejecucion ha tomado el lock; salgo" >&2
        exit 1
    fi
fi
COPIA_PID=""
cleanup() {
    # Si nos matan a mitad, el hijo que copia no debe seguir escribiendo sin lock.
    if [ -n "$COPIA_PID" ]; then
        kill "$COPIA_PID" 2>/dev/null || true
        wait "$COPIA_PID" 2>/dev/null || true
    fi
    # Solo si el lock sigue siendo mio.
    if [ "$(readlink "$LOCK" 2>/dev/null || true)" = "$$" ]; then
        rm -f "$LOCK"
    fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Dos modos de origen:
#
#   local  — FOTOS_SRC_DIR apunta a un directorio ya accesible. rsync. Lo usan
#            los tests (ni VPN ni share) y sirve para reintentar a mano.
#   smb    — se habla SMB por TCP con rclone, SIN montar nada.
#
# Por que rclone y no mount_smbfs + rsync, que es lo que habia: macOS aplica TCC
# (privacidad) a los volumenes de RED montados. Un proceso lanzado por launchd no
# tiene ese permiso y, aunque el mount_smbfs devuelve 0 y el stat de un fichero
# funciona, listar un directorio y LEER el contenido dan "Operation not
# permitted". El guard veia el origen vacio y abortaba, que es justo lo que debe
# hacer. Concederlo exige "Acceso total al disco" a /bin/bash desde la pantalla
# del Mac: ni se puede automatizar ni conviene. rclone habla el protocolo por TCP
# y no monta ningun volumen, asi que TCC no le aplica. De paso es mas rapido:
# 0,68 MB/s frente a 0,21, y listar el directorio de 6.900 fotos baja de mas de
# 2 minutos a 1,6 segundos.
MODO="smb"
if [ -n "${FOTOS_SRC_DIR:-}" ]; then
    MODO="local"
    SRC="$FOTOS_SRC_DIR"
else
    FOTOS_SMB_URL="${FOTOS_SMB_URL:?define FOTOS_SMB_URL en el .env (ver .env.example)}"
    RCLONE="${FOTOS_RCLONE:-rclone}"
    command -v "$RCLONE" >/dev/null 2>&1 || {
        echo "sync-fotos: falta rclone (brew install rclone). Es el cliente SMB del espejo." >&2
        exit 1
    }
    # //[usuario[:clave]@]HOST/SHARE
    # Se corta por el ULTIMO @, no por el primero: una clave puede llevar @ y
    # con %%@* el host saldria partido por la mitad.
    _u="${FOTOS_SMB_URL#//}"
    case "$_u" in
        *@*) _cred="${_u%@*}"; _resto="${_u##*@}" ;;
        *) _cred=""; _resto="$_u" ;;
    esac
    SMB_HOST="${_resto%%/*}"
    SMB_SHARE="${_resto#*/}"
    SMB_USER="${_cred%%:*}"
    SMB_PASS="${_cred#*:}"
    [ "$SMB_PASS" = "$_cred" ] && SMB_PASS=""
    # El share tiene que existir y no estar vacio: //HOST/ a secas daria
    # ":smb:/PS_Ficheros/..." y abortaria mas tarde con un "no existe" enganoso.
    if [ -z "$SMB_HOST" ] || [ "$SMB_SHARE" = "$_resto" ] || [ -z "$SMB_SHARE" ]; then
        echo "sync-fotos: FOTOS_SMB_URL mal formada; se espera //[usuario[:clave]@]HOST/SHARE" >&2
        exit 1
    fi
    RC_ARGS=(--smb-host="$SMB_HOST" --smb-user="${SMB_USER:-guest}")
    # La clave NO va en argv: la linea de comandos de un rclone que corre horas
    # la ve cualquiera con `ps`, y la forma ofuscada de rclone es reversible.
    # Via variable de entorno (rclone acepta RCLONE_<FLAG>) y ofuscando por
    # stdin, que tampoco deja el texto plano en argv.
    if [ -n "$SMB_PASS" ]; then
        RCLONE_SMB_PASS="$(printf '%s' "$SMB_PASS" | "$RCLONE" obscure -)"
        export RCLONE_SMB_PASS
    fi
    unset SMB_PASS _cred
    SRC=":smb:$SMB_SHARE/$FOTOS_SMB_SUBDIR"
fi

# Solo fotos. Con --include, rclone excluye todo lo demas: fuera Thumbs.db,
# desktop.ini y los .txt sueltos del share.
RC_FILTROS=(--include='*.jpg' --include='*.JPG' --include='*.jpeg' --include='*.JPEG')

contar_fotos() {
    find "$1" -mindepth 1 -maxdepth 1 -type f \
        \( -name '*.jpg' -o -name '*.JPG' -o -name '*.jpeg' -o -name '*.JPEG' \) | wc -l | tr -d ' '
}

# Las tres operaciones sobre el ORIGEN, cada una en sus dos modos.
# El stderr de rclone NO se tira: una VPN caida o unas credenciales malas se
# verian si no como "enumera vacio", que es exactamente el callejon sin salida
# diagnostico que motivo este cambio de transporte.
origen_existe() {
    if [ "$MODO" = "local" ]; then
        [ -d "$SRC/$1" ]
    else
        "$RCLONE" "${RC_ARGS[@]}" lsjson --stat "$SRC/$1" >/dev/null
    fi
}

origen_vacio() {
    if [ "$MODO" = "local" ]; then
        [ -z "$(find "$SRC/$1" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]
    else
        # Sin `| head`: con pipefail, el SIGPIPE a rclone haria fallar al script.
        [ -z "$("$RCLONE" "${RC_ARGS[@]}" lsf --files-only --max-depth 1 "$SRC/$1")" ]
    fi
}

origen_contar_fotos() {
    if [ "$MODO" = "local" ]; then
        contar_fotos "$SRC/$1"
    else
        "$RCLONE" "${RC_ARGS[@]}" "${RC_FILTROS[@]}" lsf --files-only --max-depth 1 "$SRC/$1" | wc -l | tr -d ' '
    fi
}

# GUARD de un directorio. Aborta si el origen no esta, enumera vacio o trae
# bastantes menos fotos que el espejo: un share a medio caer que lista solo una
# parte haria que --delete borrase el resto. Mismo criterio que D-063 para las
# cargas del ETL: una carga que encoge mas de un 10 % es perdida de datos, no
# una actualizacion. FOTOS_ALLOW_SHRINK=1 lo permite cuando el borrado es real.
guard() {
    local d="$1" en_origen en_espejo
    if ! origen_existe "$d"; then
        echo "sync-fotos: $SRC/$d no existe — aborto sin tocar el espejo" >&2
        exit 1
    fi
    if origen_vacio "$d"; then
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
    en_origen="$(origen_contar_fotos "$d")" || {
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
    if [ "$MODO" = "local" ]; then
        # -rt y no -a: tamano + mtime es la senal incremental correcta. Nada de
        # --checksum, que releeria los 3,5 GB cada noche.
        rsync -rt --delete \
            --include='*.jpg' --include='*.JPG' \
            --include='*.jpeg' --include='*.JPEG' \
            --exclude='*' \
            "$SRC/$d/" "$FOTOS_DEST/$d/" &
    else
        # sync (no copy): borra del espejo lo que ya no esta en el origen, con
        # el guard del 10 % cubriendo el caso del share a medio caer. Compara
        # tamano + mtime, igual que rsync -rt. --transfers 16 medido: 0,68 MB/s
        # frente a 0,54 con los 4 por defecto.
        # --max-depth 1: los --include de rclone NO estan anclados y casan a
        # cualquier profundidad, asi que sin esto bajaria a los subdirectorios
        # de trabajo de quien edita las fotos. rsync los podaba con --exclude.
        "$RCLONE" "${RC_ARGS[@]}" "${RC_FILTROS[@]}" sync --max-depth 1 \
            --transfers="${FOTOS_TRANSFERS:-16}" --checkers="${FOTOS_TRANSFERS:-16}" \
            --stats=0 --stats-one-line \
            "$SRC/$d" "$FOTOS_DEST/$d" &
    fi
    COPIA_PID=$!
    wait "$COPIA_PID"
    COPIA_PID=""
    # Solo fotos, con el mismo criterio que el guard: un .DS_Store de Finder o
    # un temporal de rsync no son ficheros del espejo.
    n="$(contar_fotos "$FOTOS_DEST/$d")"
    copiados=$((copiados + n))
done

# Marcador de estado. Solo se escribe si todo fue bien (set -e corta antes en
# cualquier fallo), igual que el watermark del ETL solo avanza con exito.
printf '{"last_sync":"%s","ficheros":%d}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$copiados" > "$FOTOS_DEST/.last-sync.json"

echo "sync-fotos: $copiados ficheros en $FOTOS_DEST"
