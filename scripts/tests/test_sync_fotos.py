"""Tests de scripts/sync-fotos.sh (espejo de fotos, D-068).

Usan FOTOS_SRC_DIR para saltarse el montaje SMB: ni VPN ni share. Lo que se
prueba es lo que protege el espejo, sobre todo el guard previo al --delete.
"""

import json
import os
import pathlib
import shutil
import subprocess
import time

import pytest

SCRIPT = pathlib.Path(__file__).parent.parent / "sync-fotos.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("rsync") is None, reason="rsync no esta instalado"
)


def _run(src: pathlib.Path, dest: pathlib.Path, **extra):
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(dest.parent),
        # Cada test con su propio lock.
        "FOTOS_LOCK": str(dest.parent / "psfotos-sync.lock"),
        "FOTOS_SRC_DIR": str(src),
        "FOTOS_DEST": str(dest),
        # Que no lea el .env real de la maquina.
        "FOTOS_ENV_FILE": str(dest.parent / "no-existe.env"),
        **extra,
    }
    return subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
    )


def _origen(tmp_path: pathlib.Path) -> pathlib.Path:
    src = tmp_path / "share"
    for d in "1234":
        (src / d).mkdir(parents=True)
        (src / d / "144750.jpg").write_bytes(b"jpeg-" + d.encode())
    (src / "1" / "132374.JPG").write_bytes(b"mayusculas")
    (src / "1" / "200.jpeg").write_bytes(b"jpeg largo")
    (src / "1" / "Thumbs.db").write_bytes(b"basura")
    (src / "1" / "copiar.cmd").write_bytes(b"basura")
    # Carpetas de trabajo de quien edita las fotos: no se recorren.
    (src / "1NO").mkdir()
    (src / "1NO" / "132705.jpg").write_bytes(b"original")
    (src / "1" / "procesadas").mkdir()
    (src / "1" / "procesadas" / "x.jpg").write_bytes(b"x")
    return src


def test_copia_solo_jpeg_de_1_a_4_y_escribe_el_marcador(tmp_path):
    src, dest = _origen(tmp_path), tmp_path / "espejo"

    r = _run(src, dest)

    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in (dest / "1").iterdir()) == [
        "132374.JPG",
        "144750.jpg",
        "200.jpeg",
    ]
    assert (dest / "4" / "144750.jpg").read_bytes() == b"jpeg-4"
    assert not (dest / "1NO").exists()
    marcador = json.loads((dest / ".last-sync.json").read_text())
    assert marcador["ficheros"] == 6
    assert marcador["last_sync"].endswith("Z")


def test_borra_del_espejo_lo_que_desaparece_del_origen(tmp_path):
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    assert _run(src, dest).returncode == 0

    (src / "1" / "200.jpeg").unlink()
    r = _run(src, dest)

    assert r.returncode == 0, r.stderr
    assert not (dest / "1" / "200.jpeg").exists()
    assert (dest / "1" / "144750.jpg").exists()


@pytest.mark.parametrize("rotura", ["vacio", "ausente"])
def test_origen_roto_no_toca_el_espejo_ni_el_marcador(tmp_path, rotura):
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    assert _run(src, dest).returncode == 0
    marcador_antes = (dest / ".last-sync.json").read_text()
    antes = sorted(str(p.relative_to(dest)) for p in dest.rglob("*.jp*g"))

    # Share caido a medias: el ULTIMO directorio falla. Los tres primeros no
    # deben haberse sincronizado (y borrado) antes de descubrirlo.
    shutil.rmtree(src / "4")
    if rotura == "vacio":
        (src / "4").mkdir()
    (src / "1" / "144750.jpg").unlink()

    r = _run(src, dest)

    assert r.returncode != 0
    assert "aborto sin tocar el espejo" in r.stderr
    assert sorted(str(p.relative_to(dest)) for p in dest.rglob("*.jp*g")) == antes
    assert (dest / ".last-sync.json").read_text() == marcador_antes


def test_sin_url_ni_origen_falla_con_mensaje(tmp_path):
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(tmp_path),
        "FOTOS_LOCK": str(tmp_path / "psfotos-sync.lock"),
        "FOTOS_DEST": str(tmp_path / "espejo"),
        "FOTOS_ENV_FILE": str(tmp_path / "no-existe.env"),
    }
    r = subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
    )
    assert r.returncode != 0
    assert "FOTOS_SMB_URL" in r.stderr
    assert not (tmp_path / "espejo").exists()


def test_el_destino_es_el_FOTOS_HOST_DIR_que_monta_compose(tmp_path):
    # El espejo tiene que acabar en el MISMO directorio que monta el contenedor.
    # Relativo, se resuelve contra el directorio del .env, como hace Compose.
    src = _origen(tmp_path)
    stack = tmp_path / "stack"
    stack.mkdir()
    envfile = stack / ".env"
    envfile.write_text(
        'CLAUDE_CODE_OAUTH_TOKEN=\'{"a": "$(no se evalua)"}\'\n'
        'FOTOS_HOST_DIR="./datos/fotos"   # comentario de cola\n'
    )
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(tmp_path),
        "FOTOS_LOCK": str(tmp_path / "psfotos-sync.lock"),
        "FOTOS_SRC_DIR": str(src),
        "FOTOS_ENV_FILE": str(envfile),
    }
    r = subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
    )
    assert r.returncode == 0, r.stderr
    assert (stack / "datos" / "fotos" / "1" / "144750.jpg").exists()
    assert (stack / "datos" / "fotos" / ".last-sync.json").exists()


def test_sin_FOTOS_HOST_DIR_el_destino_es_data_fotos_del_stack(tmp_path):
    src = _origen(tmp_path)
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("OTRA=1\n")
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(tmp_path),
        "FOTOS_LOCK": str(tmp_path / "psfotos-sync.lock"),
        "FOTOS_SRC_DIR": str(src),
        "FOTOS_ENV_FILE": str(stack / ".env"),
    }
    r = subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
    )
    assert r.returncode == 0, r.stderr
    assert (stack / "data" / "fotos" / "1" / "144750.jpg").exists()


def test_un_origen_que_lista_muchas_menos_fotos_no_borra_nada(tmp_path):
    # Share a medio caer: el directorio existe y lista ALGO, pero solo una
    # parte. Sin este guard, --delete borraria el resto del espejo.
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    for i in range(60):
        (src / "2" / f"{200000 + i}.jpg").write_bytes(b"x")
    assert _run(src, dest).returncode == 0
    marcador_antes = (dest / ".last-sync.json").read_text()

    for i in range(40):
        (src / "2" / f"{200000 + i}.jpg").unlink()
    r = _run(src, dest)

    assert r.returncode != 0
    assert "aborto sin borrar nada" in r.stderr
    assert len(list((dest / "2").iterdir())) == 61
    assert (dest / ".last-sync.json").read_text() == marcador_antes

    # Si el borrado es real, se dice explicitamente.
    r = _run(src, dest, FOTOS_ALLOW_SHRINK="1")
    assert r.returncode == 0, r.stderr
    assert len(list((dest / "2").iterdir())) == 21


def test_no_se_solapan_dos_ejecuciones(tmp_path):
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    lock = tmp_path / "psfotos-sync.lock"
    # El dueno del lock es un sync-fotos VIVO (un proceso con ese nombre).
    otro = tmp_path / "otro" / "sync-fotos.sh"
    otro.parent.mkdir()
    otro.write_text("sleep 30\n")
    vivo = subprocess.Popen(["bash", str(otro)])
    try:
        os.symlink(str(vivo.pid), lock)

        r = _run(src, dest)

        assert r.returncode != 0
        assert "ya hay una sincronizacion en curso" in r.stderr
        assert not dest.exists()
        # Y no se lleva por delante el lock de la otra ejecucion.
        assert os.readlink(lock) == str(vivo.pid)
    finally:
        vivo.kill()
        vivo.wait()


def test_un_lock_huerfano_se_reclama(tmp_path):
    # kill -9 o un apagon dejan el lock sin dueno: no debe congelar el espejo
    # todas las noches hasta que alguien lo borre a mano.
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    lock = tmp_path / "psfotos-sync.lock"
    muerto = subprocess.Popen(["true"])
    muerto.wait()
    os.symlink(str(muerto.pid), lock)

    r = _run(src, dest)

    assert r.returncode == 0, r.stderr
    assert "lock huerfano" in r.stderr
    assert (dest / "1" / "144750.jpg").exists()
    assert not os.path.lexists(lock)


def test_un_pid_reutilizado_por_otro_programa_no_cuenta_como_sync_en_curso(tmp_path):
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    lock = tmp_path / "psfotos-sync.lock"
    # Este test (python) esta vivo, pero no es un sync-fotos.
    os.symlink(str(os.getpid()), lock)

    r = _run(src, dest)

    assert r.returncode == 0, r.stderr
    assert "lock huerfano" in r.stderr


def test_el_lock_nunca_borra_un_directorio_ajeno(tmp_path):
    # FOTOS_LOCK mal puesto apuntando a algo que existe: no se toca.
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    valioso = tmp_path / "valioso"
    valioso.mkdir()
    (valioso / "datos.txt").write_text("no me borres")

    r = _run(src, dest, FOTOS_LOCK=str(valioso))

    assert r.returncode != 0
    assert "no es un lock mio" in r.stderr
    assert (valioso / "datos.txt").read_text() == "no me borres"
    assert not dest.exists()


def test_el_marcador_cuenta_fotos_no_cualquier_fichero(tmp_path):
    # Finder deja un .DS_Store al abrir la carpeta, y rsync --delete con
    # --exclude='*' nunca lo borra: no debe inflar la cifra que ve /api/health.
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    (dest / "1").mkdir(parents=True)
    (dest / "1" / ".DS_Store").write_bytes(b"x")
    (dest / "1" / "parcial.tmp").write_bytes(b"x")

    r = _run(src, dest)

    assert r.returncode == 0, r.stderr
    assert json.loads((dest / ".last-sync.json").read_text())["ficheros"] == 6


def test_si_rsync_falla_no_hay_marcador_y_el_lock_se_libera(tmp_path):
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    falso = tmp_path / "bin"
    falso.mkdir()
    (falso / "rsync").write_text("#!/bin/sh\nexit 23\n")
    (falso / "rsync").chmod(0o755)

    r = _run(src, dest, PATH=f"{falso}:{os.environ['PATH']}")

    assert r.returncode == 23
    assert not (dest / ".last-sync.json").exists()
    assert not os.path.lexists(tmp_path / "psfotos-sync.lock")


def test_al_recibir_TERM_mata_al_rsync_hijo_y_libera_el_lock(tmp_path):
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    falso = tmp_path / "bin"
    falso.mkdir()
    marca = tmp_path / "rsync.pid"
    (falso / "rsync").write_text(f"#!/bin/sh\necho $$ > {marca}\nexec sleep 60\n")
    (falso / "rsync").chmod(0o755)
    env = {
        "PATH": f"{falso}:{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "FOTOS_LOCK": str(tmp_path / "psfotos-sync.lock"),
        "FOTOS_SRC_DIR": str(src),
        "FOTOS_DEST": str(dest),
        "FOTOS_ENV_FILE": str(tmp_path / "no-existe.env"),
    }
    p = subprocess.Popen(
        ["bash", str(SCRIPT)], env=env, stderr=subprocess.PIPE, text=True
    )
    for _ in range(100):
        if marca.exists() and marca.read_text().strip():
            break
        time.sleep(0.05)
    hijo = int(marca.read_text())

    p.terminate()
    p.communicate(timeout=20)

    assert p.returncode == 143
    assert not os.path.lexists(tmp_path / "psfotos-sync.lock")
    assert not (dest / ".last-sync.json").exists()
    with pytest.raises(ProcessLookupError):
        os.kill(hijo, 0)


@pytest.mark.parametrize(
    "forma", ["~/espejo-en-home", "${HOME}/espejo-en-home", "$HOME/espejo-en-home"]
)
def test_FOTOS_HOST_DIR_con_tilde_o_HOME_se_expande_como_hace_compose(tmp_path, forma):
    src = _origen(tmp_path)
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(f"FOTOS_HOST_DIR={forma}\n")
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(tmp_path),
        "FOTOS_LOCK": str(tmp_path / "psfotos-sync.lock"),
        "FOTOS_SRC_DIR": str(src),
        "FOTOS_ENV_FILE": str(stack / ".env"),
    }
    r = subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
    )
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "espejo-en-home" / "1" / "144750.jpg").exists()
    assert not (stack / "~").exists()


@pytest.mark.parametrize(
    "valor", ["${DATOS}/fotos", "$HOMEDIR/fotos", "${HOME}DIR/fotos"]
)
def test_FOTOS_HOST_DIR_con_otra_variable_aborta_en_vez_de_escribir_en_un_sitio_raro(
    tmp_path, valor
):
    src = _origen(tmp_path)
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(f"export FOTOS_HOST_DIR={valor}\r\n")
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(tmp_path),
        "FOTOS_LOCK": str(tmp_path / "psfotos-sync.lock"),
        "FOTOS_SRC_DIR": str(src),
        "FOTOS_ENV_FILE": str(stack / ".env"),
    }
    r = subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
    )
    assert r.returncode != 0
    assert "ruta absoluta" in r.stderr
    assert list(stack.iterdir()) == [stack / ".env"]


def test_el_lock_se_libera_al_terminar_bien_o_mal(tmp_path):
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    assert _run(src, dest).returncode == 0
    assert not os.path.lexists(tmp_path / "psfotos-sync.lock")
    shutil.rmtree(src / "4")
    assert _run(src, dest).returncode != 0
    assert not os.path.lexists(tmp_path / "psfotos-sync.lock")


# --- modo SMB (rclone): se prueban los caminos que no necesitan red ---------


def _run_smb(tmp_path: pathlib.Path, url: str, **extra):
    """Ejecuta el script en modo SMB (sin FOTOS_SRC_DIR), que es el de produccion."""
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(tmp_path),
        "FOTOS_LOCK": str(tmp_path / "psfotos-sync.lock"),
        "FOTOS_DEST": str(tmp_path / "espejo"),
        "FOTOS_ENV_FILE": str(tmp_path / "no-existe.env"),
        "FOTOS_SMB_URL": url,
        **extra,
    }
    return subprocess.run(
        ["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
    )


def test_sin_rclone_lo_dice_en_vez_de_fallar_raro(tmp_path):
    # rclone es el cliente SMB del espejo: si falta, el mensaje debe decirlo.
    r = _run_smb(tmp_path, "//guest@servidor/share", FOTOS_RCLONE="/no/existe/rclone")

    assert r.returncode == 1
    assert "falta rclone" in r.stderr
    assert not (tmp_path / "espejo" / ".last-sync.json").exists()


@pytest.mark.parametrize(
    "url",
    [
        "basura",  # ni // ni host ni share
        "//servidor",  # host sin share
        "//usuario@servidor",  # con credenciales pero sin share
    ],
)
def test_una_url_smb_mal_formada_para_antes_de_tocar_nada(tmp_path, url):
    # Un rclone que existe pero que no se debe llegar a invocar: si la URL no
    # se valida antes, el fallo seria un error de rclone y no uno legible.
    falso = tmp_path / "bin"
    falso.mkdir()
    (falso / "rclone").write_text("#!/bin/sh\necho 'NO DEBERIA EJECUTARSE' >&2\nexit 0\n")
    (falso / "rclone").chmod(0o755)

    r = _run_smb(tmp_path, url, FOTOS_RCLONE=str(falso / "rclone"))

    assert r.returncode == 1
    assert "FOTOS_SMB_URL mal formada" in r.stderr
    assert "NO DEBERIA EJECUTARSE" not in r.stderr
    assert not (tmp_path / "espejo" / ".last-sync.json").exists()


def test_el_lock_se_libera_aunque_la_url_sea_invalida(tmp_path):
    # El guard mas facil de romper: salir por error dejando el lock puesto
    # congelaria el espejo todas las noches siguientes.
    #
    # FOTOS_RCLONE apunta a un rclone de mentira a proposito: sin el, en una
    # maquina sin rclone (CI) el script saldria en la comprobacion del binario
    # y el test pasaria sin llegar nunca al camino que dice probar.
    falso = tmp_path / "bin"
    falso.mkdir()
    (falso / "rclone").write_text("#!/bin/sh\nexit 0\n")
    (falso / "rclone").chmod(0o755)

    r = _run_smb(tmp_path, "basura", FOTOS_RCLONE=str(falso / "rclone"))

    assert r.returncode == 1
    # lexists y no exists: el lock es un enlace simbolico a un PID, asi que
    # exists() sigue el enlace y da False tanto si quedo puesto como si no.
    assert not os.path.lexists(str(tmp_path / "psfotos-sync.lock"))
