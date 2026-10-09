// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  __resetArticlePhotosCache,
  cargarFotos,
  MAX_LOTE,
  REINTENTO_MS,
  useArticlePhotos,
} from "../use-article-photos";

type Cuerpo = { codigos: string[]; refs: string[] };

/** Servidor de mentira: 144750 tiene 3 fotos, 132374 una, V26212484 → 144750. */
function servidor(extra: Record<string, number[]> = {}) {
  const conFoto: Record<string, number[]> = { "144750": [1, 2, 3], "132374": [1], ...extra };
  const refs: Record<string, string> = { V26212484: "144750", V26000001: "169" };
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { codigos, refs: rs } = JSON.parse(String(init.body)) as Cuerpo;
    const porCodigo: Record<string, number[]> = {};
    for (const c of codigos) porCodigo[c] = conFoto[c] ?? [];
    const porRef: Record<string, { codigo: string; slots: number[] }> = {};
    for (const r of rs) {
      if (refs[r]) porRef[r] = { codigo: refs[r], slots: conFoto[refs[r]] ?? [] };
    }
    return new Response(JSON.stringify({ porCodigo, porRef }), { status: 200 });
  });
}

function cuerpos(f: ReturnType<typeof servidor>): Cuerpo[] {
  return f.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Cuerpo);
}

let fetchMock: ReturnType<typeof servidor>;

beforeEach(() => {
  __resetArticlePhotosCache();
  fetchMock = servidor();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useArticlePhotos", () => {
  it("una sola llamada por widget, con los códigos deduplicados", async () => {
    const codigos = ["144750", "169", "144750", "132374", "169"];
    const { result } = renderHook(() => useArticlePhotos(codigos, []));

    await waitFor(() => expect(result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/articulos/fotos");
    expect(cuerpos(fetchMock)[0].codigos.sort()).toEqual(["132374", "144750", "169"]);
    expect(result.current.slotsDeCodigo("132374")).toEqual([1]);
    expect(result.current.slotsDeCodigo("169")).toEqual([]);
  });

  it("resuelve referencias a código + slots", async () => {
    const { result } = renderHook(() => useArticlePhotos([], ["V26212484", "V26000001", "NOEXISTE"]));

    await waitFor(() =>
      expect(result.current.deRef("V26212484")).toEqual({ codigo: "144750", slots: [1, 2, 3] }),
    );
    expect(result.current.deRef("V26000001")).toEqual({ codigo: "169", slots: [] });
    expect(result.current.deRef("NOEXISTE")).toBeNull();
    // Lo aprendido por referencia sirve también por código.
    expect(result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]);
  });

  it("sin códigos ni referencias no pregunta nada", async () => {
    const { result } = renderHook(() => useArticlePhotos([], []));
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.slotsDeCodigo("144750")).toEqual([]);
  });

  it("antes de la respuesta no hay fotos: ningún indicador prematuro", () => {
    const { result } = renderHook(() => useArticlePhotos(["144750"], []));
    expect(result.current.slotsDeCodigo("144750")).toEqual([]);
  });

  it(`trocea en lotes de ${MAX_LOTE}`, async () => {
    const codigos = Array.from({ length: 450 }, (_, i) => String(200000 + i));
    await cargarFotos(codigos, []);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(cuerpos(fetchMock).map((c) => c.codigos.length)).toEqual([200, 200, 50]);
    expect(new Set(cuerpos(fetchMock).flatMap((c) => c.codigos)).size).toBe(450);
  });

  it("caché compartida: el mismo artículo en otro widget no vuelve a preguntar", async () => {
    const a = renderHook(() => useArticlePhotos(["144750", "132374"], []));
    await waitFor(() => expect(a.result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]));

    const b = renderHook(() => useArticlePhotos(["144750"], []));
    await waitFor(() => expect(b.result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Un tercero con un artículo nuevo solo pregunta por el que falta.
    const c = renderHook(() => useArticlePhotos(["144750", "169"], []));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(cuerpos(fetchMock)[1].codigos).toEqual(["169"]);
    c.unmount();
  });

  it("tres widgets que montan a la vez comparten la petición en vuelo", async () => {
    const a = renderHook(() => useArticlePhotos(["144750"], []));
    const b = renderHook(() => useArticlePhotos(["144750"], []));
    const c = renderHook(() => useArticlePhotos(["144750"], []));

    await waitFor(() => {
      for (const h of [a, b, c]) expect(h.result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("la caché caduca a los 10 minutos", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T10:00:00Z") });
    await cargarFotos(["144750"], []);
    await cargarFotos(["144750"], []);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-08T10:09:59Z"));
    await cargarFotos(["144750"], []);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-10-08T10:10:01Z"));
    await cargarFotos(["144750"], []);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("con el widget montado, lo caducado se sigue viendo y se revalida solo", async () => {
    // Regresión de la revisión: el lector aplicaba el TTL, así que a los 10
    // minutos cualquier re-render (ordenar la tabla) borraba todos los
    // indicadores y nadie volvía a pedirlos.
    vi.useFakeTimers({ now: new Date("2026-10-08T10:00:00Z") });
    const { result, rerender } = renderHook(() => useArticlePhotos(["144750", "169"], []));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Pasan 10 min y medio SIN que se dispare aún la revalidación… el dato sigue.
    vi.setSystemTime(new Date("2026-10-08T10:10:30Z"));
    rerender();
    expect(result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]);

    // …y el temporizador vuelve a preguntar: la 169 ahora tiene foto.
    vi.stubGlobal("fetch", servidor({ "169": [2] }));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    expect(result.current.slotsDeCodigo("169")).toEqual([2]);
    expect(result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]);
  });

  it("al desmontar deja de revalidar", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T10:00:00Z") });
    const { unmount } = renderHook(() => useArticlePhotos(["144750"], []));
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["la red falla", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["el servidor da 500", () => Promise.resolve(new Response("boom", { status: 500 }))],
    ["la respuesta no es JSON", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["la respuesta tiene otra forma", () => Promise.resolve(new Response('{"porCodigo":"x"}', { status: 200 }))],
  ])("si %s no hay fotos y no se lanza nada", async (_n, respuesta) => {
    vi.stubGlobal("fetch", vi.fn(respuesta));
    const { result } = renderHook(() => useArticlePhotos(["144750"], ["V26212484"]));

    await expect(cargarFotos(["144750"], ["V26212484"])).resolves.toEqual(expect.any(Boolean));
    expect(result.current.slotsDeCodigo("144750")).toEqual([]);
    expect(result.current.deRef("V26212484")).toBeNull();
  });

  it("un fallo al abrir el panel se reintenta a los 15 s, sin esperar a los 10 minutos", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T10:00:00Z") });
    const roto = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })));
    vi.stubGlobal("fetch", roto);
    const { result, unmount } = renderHook(() => useArticlePhotos(["144750"], []));
    await vi.advanceTimersByTimeAsync(0);
    expect(roto).toHaveBeenCalledTimes(1);
    expect(result.current.slotsDeCodigo("144750")).toEqual([]);

    vi.stubGlobal("fetch", fetchMock);
    await vi.advanceTimersByTimeAsync(REINTENTO_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]);

    // Y una vez bien, no sigue reintentando.
    await vi.advanceTimersByTimeAsync(5 * REINTENTO_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("cargarFotos dice si quedó algo sin saber", async () => {
    expect(await cargarFotos(["144750"], [])).toBe(true);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await cargarFotos(["999"], [])).toBe(false);
  });

  it("un fallo no se cachea: el siguiente intento vuelve a preguntar", async () => {
    const roto = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", roto);
    await cargarFotos(["144750"], []);

    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useArticlePhotos(["144750"], []));
    await waitFor(() => expect(result.current.slotsDeCodigo("144750")).toEqual([1, 2, 3]));
  });

  it("descarta slots que no sean 1..4", async () => {
    vi.stubGlobal("fetch", servidor({ "777": [1, 9] }));
    await cargarFotos(["777"], []);
    const { result } = renderHook(() => useArticlePhotos(["777"], []));
    expect(result.current.slotsDeCodigo("777")).toEqual([]);
  });
});
