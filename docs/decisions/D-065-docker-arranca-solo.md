---
id: D-065
title: Docker arranca por LaunchDaemon, no por sesión de usuario
date: 2026-09-02
---

# D-065: Docker arranca por LaunchDaemon, no por sesión de usuario

*Decidido: 2026-09-02*

**Contexto**: el Mac de producción se apagó. Al volver se quedó en la pantalla
de inicio de sesión —`stat -f %Su /dev/console` devolvía `root`, es decir nadie
había entrado— y **Docker Desktop no arrancó**, porque en macOS es una
aplicación de interfaz que se lanza al iniciar sesión. Todo el stack estuvo
caído hasta que el dueño lo notó.

Tampoco se podía arreglar desde fuera: por SSH, `open -a Docker` falla con
`Launch failed / Domain does not support specified action`, y
`launchctl asuser` con `Operation not permitted`. Las dos por lo mismo: no hay
sesión de interfaz a la que adjuntarse.

**Decisión**:

1. Un **LaunchDaemon** (`/Library/LaunchDaemons/com.powershop.docker-autostart.plist`)
   arranca `com.docker.backend` al arrancar la máquina. Daemon y no agent: un
   LaunchAgent corre por sesión de usuario, así que no cubriría precisamente el
   caso de que nadie inicie sesión.
2. El daemon corre **como el usuario dueño de `~/.docker`**, no como root: el
   socket del motor vive en su home.
3. **No levanta contenedores.** Todos llevan `restart: unless-stopped`, así que
   vuelven solos en cuanto el motor responde. No hacerlo evita que el arranque
   automático resucite algo que alguien paró a propósito.
4. Se reintenta cada 5 minutos. El script sale sin hacer nada si el motor ya
   responde, así que repetirlo no cuesta.

**Alternativas descartadas**:
- *Inicio de sesión automático del usuario*: deja la sesión gráfica abierta de
  forma permanente en una máquina que hace de servidor.
- *LaunchAgent de usuario*: no corre sin sesión iniciada, que es el caso a
  cubrir.
- *Levantar los contenedores desde el script*: innecesario con
  `unless-stopped`, y convierte una recuperación en una decisión.

**Comprobado** el 2026-09-02 en producción: matando `com.docker.backend`, los
10 contenedores caen y el script los devuelve en 6 segundos.

**Instalación**: `sudo bash scripts/install-docker-autostart.sh` en el Mac de
producción. Necesita sudo una vez (un LaunchDaemon vive en `/Library`).

**Ver**: `scripts/start-docker-daemon.sh`,
`scripts/launchd/com.powershop.docker-autostart.plist.template`,
`scripts/install-docker-autostart.sh`.
