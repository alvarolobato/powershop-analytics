/**
 * Fixture de fotos de artículo para e2e (D-068).
 *
 * El espejo real (~3,5 GB) solo existe en producción y los tests no pueden
 * depender ni de él ni de la VPN. Aquí se siembra un `FOTOS_DIR` de mentira,
 * con JPEG mínimos, para los códigos del seed sintético (`ART0000N`).
 *
 * `playwright.config.ts` arranca el servidor con `FOTOS_DIR` apuntando a
 * `E2E_FOTOS_DIR`; el spec escribe los ficheros ahí. Las rutas se resuelven en
 * cada petición, así que da igual que el servidor arranque antes.
 */
import fs from "fs";
import os from "os";
import path from "path";

// SIEMPRE un directorio propio en tmp. Nunca se hereda FOTOS_DIR del entorno:
// `sembrarFotos()` borra los directorios 1..4, y quien tenga FOTOS_DIR
// apuntando a un espejo de verdad (o a uno parcial en dev) lo perdería al
// lanzar Playwright desde la misma shell.
export const E2E_FOTOS_DIR = path.join(os.tmpdir(), "powershop-e2e-fotos", "espejo");
export const E2E_FOTOS_CACHE_DIR = path.join(os.tmpdir(), "powershop-e2e-fotos", "cache");

/** JPEG de 96×96 (638 bytes), el mismo del slot 1 de scripts/seed-fotos-dev.sh. */
const JPEG_MINIMO = Buffer.from(
  "/9j/2wBDAA0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//2wBDAQ0NDQ0ODQ4QEA4UFhMWFB4bGRkbHi0gIiAiIC1EKjIqKjIqRDxJOzc7STxsVUtLVWx9aWNpfZeHh5e+tb75+f//wgARCABgAGADASIAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAYFB//EABkBAQEBAQEBAAAAAAAAAAAAAAAEBQMCBv/aAAwDAQACEAMQAAAAyxm/VAAAAAAN3Cufc7D6LLd4IYS64AAC5hrnpLUy1TLU5UMIt8AABcw1z0lqZaplqcqGEW+AAAuYbd9z9FlmH3gwhLrgAAAAAAAf/8QAJxAAAAMFBwUAAAAAAAAAAAAABhJFBRMwg8IAEBEUFSRCFkBlo+L/2gAIAQEAAT8A7tisXVsxuHTonA2JrdF+R9X1ZtMXScvuHr0/AuBYQLUZVVw0TptMIFqMqq4aJ02mEC1GVVcNE6bTCBajKquGidNphAtRlVXDROm0wgWoyqrhonTaYTFbWk5jbvXpOZcC2608d7fmzabWrZfbunR+ZsTd/wD/xAAaEQADAAMBAAAAAAAAAAAAAAABAgMAIDMw/9oACAECAQE/AN5gM4Byk0VCQNY9Fy3NtY9Fy3NtZkK4JylEZCAfL//EAB8RAAEEAgMBAQAAAAAAAAAAAAIBAwQRALEgNIFBMP/aAAgBAwEBPwDnKMm2DMFokreRZT7j4AZ2K38TjO6rnm8g9pv3XGd1XPN5B7TfuuMoCcYMASyWt5FivtvgZhQpf1Py/9k=",
  "base64",
);

/** Qué artículos del seed tienen foto, y en qué slots. El resto, ninguna. */
export const FOTOS_SEMBRADAS: Record<string, number[]> = {
  ART00001: [1, 2, 3],
  ART00002: [1],
};

/** Artículos del seed que se dejan SIN foto a propósito. */
export const SIN_FOTO = ["ART00003", "ART00004", "ART00005"];

/** Deja `E2E_FOTOS_DIR` exactamente con `FOTOS_SEMBRADAS`. Idempotente. */
export function sembrarFotos(): void {
  // Cinturón: el marcador lo escribe sync-fotos.sh. Si está, esto es un espejo real.
  if (fs.existsSync(path.join(E2E_FOTOS_DIR, ".last-sync.json"))) {
    throw new Error(`${E2E_FOTOS_DIR} parece un espejo real (.last-sync.json); no lo toco`);
  }
  for (const slot of [1, 2, 3, 4]) {
    const dir = path.join(E2E_FOTOS_DIR, String(slot));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const [codigo, slots] of Object.entries(FOTOS_SEMBRADAS)) {
    for (const slot of slots) {
      fs.writeFileSync(path.join(E2E_FOTOS_DIR, String(slot), `${codigo}.jpg`), JPEG_MINIMO);
    }
  }
}
