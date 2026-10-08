#!/usr/bin/env python3
"""Verifica que Articulos.Path..Path4 siguen la convencion derivada del codigo.

Sale 0 si todos cumplen, 1 si hay desviaciones (listandolas) y 2 si no se pudo
consultar. Pensado para correr a diario junto al espejo de fotos.
Ver docs/decisions/D-068-fotos-por-convencion-de-ruta.md

El dashboard NO lee estos campos: reconstruye la ruta desde el codigo. Este
chequeo es el seguro contra el dia en que alguien edite un PATH IMAGEM a mano,
que es el unico escenario en que el dashboard dejaria de ver una foto.

NO uses COUNT(*) con un LIKE para esto: en 4D SQL, COUNT(*) devuelve NULL (no 0)
sobre un resultado vacio, asi que un "0 desviaciones" seria indistinguible de un
fallo de la consulta. Hay que extraer los valores y comparar.

Solo depende de p4d y de la libreria estandar, a proposito: en produccion no
hay checkout ni venv en el host, y se ejecuta dentro del contenedor del ETL
(`docker compose exec -T etl python - < check-fotos-paths.py`).
"""

import os
import signal
import sys

ESPERADO = "W:\\PS_Ficheros\\Imagenes\\{slot}\\{codigo}.jpg"
QUERY = "SELECT Codigo, Path, Path2, Path3, Path4 FROM Articulos"

# Menos de esto y la consulta no ha devuelto la tabla: 4D tiene ~43.000
# articulos. Un resultado corto no puede leerse como "todo en orden".
MIN_FILAS = 1000

# Tope de reloj. Si 4D cierra el socket a mitad de lectura, p4d se queda girando
# en C al 100 % de CPU para siempre (D-067) y ningun manejador de Python llega a
# ejecutarse; la accion por defecto de SIGALRM si mata el proceso.
TIMEOUT_S = 900

MAX_LISTADAS = 50


def _texto(valor):
    """Normaliza un valor de p4d: bytes -> str, sin relleno NUL ni espacios."""
    if valor is None:
        return ""
    if isinstance(valor, bytes):
        valor = valor.decode("utf-8", errors="replace")
    return str(valor).replace("\x00", "").strip()


def desviaciones(filas):
    """Devuelve [(codigo, slot, valor)] para cada path fuera de la convencion.

    `filas` son tuplas (Codigo, Path, Path2, Path3, Path4).
    """
    fuera = []
    for fila in filas:
        codigo = _texto(fila[0])
        for slot in (1, 2, 3, 4):
            valor = _texto(fila[slot])
            if valor != ESPERADO.format(slot=slot, codigo=codigo):
                fuera.append((codigo, slot, valor))
    return fuera


def informar(filas, salida=sys.stdout):
    """Imprime el resultado y devuelve el codigo de salida."""
    if len(filas) < MIN_FILAS:
        print(
            f"check-fotos-paths: solo {len(filas)} articulos leidos "
            f"(se esperan > {MIN_FILAS}); la consulta no es fiable",
            file=salida,
        )
        return 2

    fuera = desviaciones(filas)
    total = len(filas) * 4
    if not fuera:
        print(
            f"check-fotos-paths: OK — {total} paths de {len(filas)} articulos "
            "siguen la convencion",
            file=salida,
        )
        return 0

    print(
        f"check-fotos-paths: {len(fuera)} DESVIACIONES de {total} paths. "
        "Esos articulos no mostraran esa foto en el dashboard:",
        file=salida,
    )
    for codigo, slot, valor in fuera[:MAX_LISTADAS]:
        print(f"  codigo={codigo!r} slot={slot} path={valor!r}", file=salida)
    if len(fuera) > MAX_LISTADAS:
        print(f"  ... y {len(fuera) - MAX_LISTADAS} mas", file=salida)
    return 1


def leer_filas():
    import p4d

    conn = p4d.connect(
        host=os.environ["P4D_HOST"],
        port=int(os.environ.get("P4D_PORT", "19812")),
        user=os.environ.get("P4D_USER", ""),
        password=os.environ.get("P4D_PASSWORD", ""),
    )
    try:
        cur = conn.cursor()
        cur.execute(QUERY)
        return cur.fetchall()
    finally:
        conn.close()


def main():
    signal.alarm(TIMEOUT_S)
    try:
        filas = leer_filas()
    except Exception as exc:  # noqa: BLE001 - cualquier fallo es "no se pudo consultar"
        print(f"check-fotos-paths: no se pudo consultar 4D: {exc}", file=sys.stderr)
        return 2
    return informar(filas)


if __name__ == "__main__":
    sys.exit(main())
