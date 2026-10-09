#!/bin/bash
# Instala el agente launchd que espeja a diario las fotos de articulo y vigila
# que los PATH IMAGEM sigan la convencion (D-068). Idempotente.
#
# Se ejecuta EN EL MAC DE PRODUCCION: el espejo solo existe alli.
#
# Uso:  bash scripts/install-fotos-sync-launchd.sh [directorio-del-stack]
#       (por defecto ~/powershop, el directorio del docker-compose.yml)
#
# Que hace:
#   1. COPIA los scripts del job a <stack>/scripts. Produccion es un despliegue
#      plano sin checkout: si el plist apuntara al clon desde el que se instala
#      (a menudo un /tmp/ps-repo que luego se borra), el job dejaria de existir.
#   2. Renderiza la plantilla en ~/Library/LaunchAgents.
#   3. Lo carga en launchd. NO lo ejecuta: la primera copia son ~4,6 h y se
#      lanza a mano (el comando sale al final).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STACK_DIR="${1:-$HOME/powershop}"
TEMPLATE="$SCRIPT_DIR/launchd/com.powershop.fotos-sync.plist.template"
LABEL="com.powershop.fotos-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
JOB_FILES="fotos-sync-job.sh sync-fotos.sh check-fotos-paths.py"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: Template not found at $TEMPLATE" >&2
  exit 1
fi
if [ ! -f "$STACK_DIR/docker-compose.yml" ]; then
  echo "ERROR: $STACK_DIR no tiene docker-compose.yml; pasa el directorio del stack como argumento" >&2
  exit 1
fi
STACK_DIR=$(cd "$STACK_DIR" && pwd)

if ! grep -qE '^(export[[:space:]]+)?FOTOS_SMB_URL=' "$STACK_DIR/.env" 2>/dev/null; then
  echo "AVISO: $STACK_DIR/.env no define FOTOS_SMB_URL; el job fallara hasta que se anada." >&2
fi

mkdir -p "$STACK_DIR/scripts" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
for f in $JOB_FILES; do
  # Instalando desde el propio stack no hay nada que copiar.
  if [ "$SCRIPT_DIR/$f" -ef "$STACK_DIR/scripts/$f" ]; then
    continue
  fi
  cp "$SCRIPT_DIR/$f" "$STACK_DIR/scripts/$f"
done
chmod +x "$STACK_DIR/scripts/fotos-sync-job.sh" "$STACK_DIR/scripts/sync-fotos.sh"

sed \
  -e "s|__SCRIPTS_DIR__|$STACK_DIR/scripts|g" \
  -e "s|__STACK_DIR__|$STACK_DIR|g" \
  -e "s|__HOME__|$HOME|g" \
  "$TEMPLATE" > "$PLIST"
chmod 644 "$PLIST"

UID_REAL=$(id -u)
launchctl bootout "gui/$UID_REAL/$LABEL" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
if ! launchctl bootstrap "gui/$UID_REAL" "$PLIST" 2>/dev/null; then
  launchctl load "$PLIST"
fi

echo "Installed launchd agent: $LABEL"
echo "  Plist:      $PLIST"
echo "  Scripts:    $STACK_DIR/scripts"
echo "  Espejo:     FOTOS_HOST_DIR de $STACK_DIR/.env (por defecto $STACK_DIR/data/fotos),"
echo "              el mismo directorio que monta el contenedor del dashboard"
echo "  Log file:   $HOME/Library/Logs/$LABEL.log"
echo "  Cadencia:   diario a la 01:00"
echo
echo "Primera copia (~4,6 h, con la VPN levantada; dejala terminar):"
echo "  launchctl kickstart gui/$UID_REAL/$LABEL"
echo "  tail -f \$HOME/Library/Logs/$LABEL.log"
echo
echo "Desinstalar:"
echo "  launchctl bootout gui/$UID_REAL/$LABEL && rm $PLIST"
