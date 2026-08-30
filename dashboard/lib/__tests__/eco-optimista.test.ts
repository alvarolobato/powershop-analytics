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
 *
 * Este test importa la MISMA función que usa el componente. La primera versión
 * reimplementaba la lógica aquí, y eso la habría dejado pasando en verde
 * mientras el componente volvía a duplicar.
 */
import { describe, it, expect } from "vitest";
import { ecoYaPersistido, textoDelMensaje } from "../conversation-echo";

type Msg = { role: string; content: unknown };

const TEXTO = "Ordenalo por tallas no por ventas así puedo ver la distribución";

describe("eco optimista del mensaje de usuario", () => {
  it("se oculta cuando el mensaje ya llegó persistido", () => {
    const messages: Msg[] = [
      { role: "user", content: { text: "pregunta anterior" } },
      { role: "assistant", content: { text: "respuesta" } },
      { role: "user", content: { text: TEXTO } },
    ];
    expect(ecoYaPersistido(messages, TEXTO)).toBe(true);
  });

  it("se sigue mostrando mientras el servidor no lo ha devuelto", () => {
    const messages: Msg[] = [
      { role: "user", content: { text: "pregunta anterior" } },
      { role: "assistant", content: { text: "respuesta" } },
    ];
    expect(ecoYaPersistido(messages, TEXTO)).toBe(false);
  });

  it("no se confunde con un mensaje anterior de texto distinto", () => {
    const messages: Msg[] = [{ role: "user", content: { text: "otra cosa" } }];
    expect(ecoYaPersistido(messages, TEXTO)).toBe(false);
  });

  it("tolera espacios de más al comparar", () => {
    const messages: Msg[] = [{ role: "user", content: { text: `  ${TEXTO}  ` } }];
    expect(ecoYaPersistido(messages, TEXTO)).toBe(true);
  });

  it("compara con el ÚLTIMO mensaje de usuario, no con cualquiera", () => {
    // Repetir una pregunta anterior es legítimo: el eco debe verse hasta que
    // esa repetición se persista.
    const messages: Msg[] = [
      { role: "user", content: { text: TEXTO } },
      { role: "assistant", content: { text: "respuesta" } },
      { role: "user", content: { text: "otra pregunta" } },
    ];
    expect(ecoYaPersistido(messages, TEXTO)).toBe(false);
  });

  it("no oculta nada cuando no hay eco pendiente", () => {
    const messages: Msg[] = [{ role: "user", content: { text: TEXTO } }];
    expect(ecoYaPersistido(messages, "")).toBe(false);
  });

  it("tolera el formato antiguo, con content como cadena", () => {
    // Hoy no hay ninguno en producción (312 mensajes, todos objeto), pero si
    // apareciera, el eco quedaría sin detectar y volvería el duplicado.
    const messages = [{ role: "user", content: TEXTO }];
    expect(ecoYaPersistido(messages, TEXTO)).toBe(true);
  });

  it("textoDelMensaje entiende ambos formatos y descarta el resto", () => {
    expect(textoDelMensaje({ text: "hola" })).toBe("hola");
    expect(textoDelMensaje("hola")).toBe("hola");
    expect(textoDelMensaje(null)).toBeUndefined();
    expect(textoDelMensaje({ otra: "cosa" })).toBeUndefined();
  });
});
