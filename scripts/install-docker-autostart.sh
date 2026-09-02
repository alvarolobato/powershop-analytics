#!/bin/bash
# Instala el LaunchDaemon que arranca Docker tras un reinicio.
#
# Se ejecuta EN EL MAC DE PRODUCCIÓN y necesita sudo: un LaunchDaemon vive en
# /Library/LaunchDaemons y lo carga launchd al arrancar la máquina, sin
# depender de que nadie inicie sesión — que es justo el agujero que cubre
# (ver el comentario largo en start-docker-daemon.sh).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/start-docker-daemon.sh"
PLANTILLA="$REPO_ROOT/scripts/launchd/com.powershop.docker-autostart.plist.template"
DESTINO="/Library/LaunchDaemons/com.powershop.docker-autostart.plist"
USUARIO="${SUDO_USER:-$(whoami)}"
HOGAR="$(eval echo "~$USUARIO")"

[ -x "$SCRIPT" ] || { echo "ERROR: falta $SCRIPT o no es ejecutable"; exit 1; }
[ -f "$PLANTILLA" ] || { echo "ERROR: falta $PLANTILLA"; exit 1; }

echo "Instalando para el usuario '$USUARIO' (home: $HOGAR)"

sed -e "s|__SCRIPT__|$SCRIPT|g" \
    -e "s|__USER__|$USUARIO|g" \
    -e "s|__HOME__|$HOGAR|g" \
    "$PLANTILLA" | sudo tee "$DESTINO" >/dev/null

sudo chown root:wheel "$DESTINO"
sudo chmod 644 "$DESTINO"

# `bootout` antes de `bootstrap` para que reinstalar sea idempotente.
sudo launchctl bootout system "$DESTINO" 2>/dev/null || true
sudo launchctl bootstrap system "$DESTINO"

echo "Instalado. Comprobación:"
sudo launchctl print system/com.powershop.docker-autostart 2>/dev/null | grep -E "state|program" | head -3 || true
echo
echo "Log: /tmp/powershop-docker-autostart.log"
echo "Para desinstalarlo: sudo launchctl bootout system $DESTINO && sudo rm $DESTINO"
