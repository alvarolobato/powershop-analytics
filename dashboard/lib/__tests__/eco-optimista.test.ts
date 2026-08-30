/**
 * El eco optimista del mensaje del usuario no puede duplicarse.
 *
 * `ConversationPane` pinta `pendingUserMsg` ADEMÁS de `conv.messages`, y
 * `POST /turns` persiste el mensaje del usuario de inmediato. Cualquier
 * refresco de la conversación antes de que el turno termine trae el mensaje ya
 * guardado, así que la burbuja sale dos veces — observado en producción
 * (conversación ba3a5a6cdacc, 2026-08-30): en la base de datos había UNA sola
 * fila y la interfaz mostraba dos burbujas idénticas.
 *
 * El eco no tiene id con el que casar contra el persistido, así que la
 * comparación es por texto contra el último mensaje de usuario.
 */
import { describe, it, expect } from "vitest";

type Msg = { role: string; content: unknown };

/** Misma lógica que `ConversationPane`: ¿el eco ya llegó persistido? */
function yaPersistido(messages: Msg[], pendingUserMsg: string): boolean {
  const ultimoUsuario = [...messages].reverse().find((m) => m.role === "user");
  const textoUltimo =
    typeof ultimoUsuario?.content === "object" && ultimoUsuario?.content !== null
      ? ((ultimoUsuario.content as Record<string, unknown>).text as string | undefined)
      : undefined;
  return pendingUserMsg.trim().length > 0 && textoUltimo?.trim() === pendingUserMsg.trim();
}

const TEXTO = "Ordenalo por tallas no por ventas así puedo ver la distribución";

describe("eco optimista del mensaje de usuario", () => {
  it("se oculta cuando el mensaje ya llegó persistido", () => {
    const messages: Msg[] = [
      { role: "user", content: { text: "pregunta anterior" } },
      { role: "assistant", content: { text: "respuesta" } },
      { role: "user", content: { text: TEXTO } },
    ];
    expect(yaPersistido(messages, TEXTO)).toBe(true);
  });

  it("se sigue mostrando mientras el servidor no lo ha devuelto", () => {
    const messages: Msg[] = [
      { role: "user", content: { text: "pregunta anterior" } },
      { role: "assistant", content: { text: "respuesta" } },
    ];
    expect(yaPersistido(messages, TEXTO)).toBe(false);
  });

  it("no se confunde con un mensaje anterior de texto distinto", () => {
    const messages: Msg[] = [{ role: "user", content: { text: "otra cosa" } }];
    expect(yaPersistido(messages, TEXTO)).toBe(false);
  });

  it("tolera espacios de más al comparar", () => {
    const messages: Msg[] = [{ role: "user", content: { text: `  ${TEXTO}  ` } }];
    expect(yaPersistido(messages, TEXTO)).toBe(true);
  });

  it("compara con el ÚLTIMO mensaje de usuario, no con cualquiera", () => {
    // Repetir una pregunta anterior es legítimo: el eco debe verse hasta que
    // esa repetición se persista.
    const messages: Msg[] = [
      { role: "user", content: { text: TEXTO } },
      { role: "assistant", content: { text: "respuesta" } },
      { role: "user", content: { text: "otra pregunta" } },
    ];
    expect(yaPersistido(messages, TEXTO)).toBe(false);
  });

  it("no oculta nada cuando no hay eco pendiente", () => {
    const messages: Msg[] = [{ role: "user", content: { text: TEXTO } }];
    expect(yaPersistido(messages, "")).toBe(false);
  });
});
