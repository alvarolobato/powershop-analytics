"""Tests de scripts/sync-fotos.sh (espejo de fotos, D-068).

Usan FOTOS_SRC_DIR para saltarse el montaje SMB: ni VPN ni share. Lo que se
prueba es lo que protege el espejo, sobre todo el guard previo al --delete.
"""

import json
import os
import pathlib
import shutil
import subprocess

import pytest

SCRIPT = pathlib.Path(__file__).parent.parent / "sync-fotos.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("rsync") is None, reason="rsync no esta instalado"
)


def _run(src: pathlib.Path, dest: pathlib.Path, **extra):
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(dest.parent),
        # El lock vive en TMPDIR: cada test el suyo.
        "TMPDIR": str(dest.parent),
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
        "TMPDIR": str(tmp_path),
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
        "TMPDIR": str(tmp_path),
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
        "TMPDIR": str(tmp_path),
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
    (tmp_path / "psfotos-sync.lock").mkdir()

    r = _run(src, dest)

    assert r.returncode != 0
    assert "ya hay una sincronizacion en curso" in r.stderr
    assert not dest.exists()
    # Y no se lleva por delante el lock de la otra ejecucion.
    assert (tmp_path / "psfotos-sync.lock").exists()


def test_el_lock_se_libera_al_terminar_bien_o_mal(tmp_path):
    src, dest = _origen(tmp_path), tmp_path / "espejo"
    assert _run(src, dest).returncode == 0
    assert not (tmp_path / "psfotos-sync.lock").exists()
    shutil.rmtree(src / "4")
    assert _run(src, dest).returncode != 0
    assert not (tmp_path / "psfotos-sync.lock").exists()
