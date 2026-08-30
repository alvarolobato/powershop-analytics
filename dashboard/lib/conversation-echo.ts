/**
 * ¿El eco optimista del mensaje del usuario ya llegó persistido del servidor?
 *
 * `ConversationPane` pinta `pendingUserMsg` ADEMÁS de `conv.messages`, y
 * `POST /turns` persiste el mensaje del usuario de inmediato: cualquier
 * refresco de la conversación antes de que el turno termine lo trae ya
 * guardado y la burbuja sale dos veces. Observado en producción (conversación
 * `ba3a5a6cdacc`, 2026-08-30): una sola fila en la base, dos burbujas idénticas
 * en pantalla.
 *
 * Vive aquí, y no dentro del componente, para que el test ejercite ESTA función
 * y no una copia suya. Un test que reimplementa la lógica que vigila puede
 * quedarse verde mientras el componente vuelve a duplicar.
 */

/** Texto de un mensaje, tolerando el formato antiguo donde `content` era una cadena. */
export function textoDelMensaje(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (typeof content === "object" && content !== null) {
    const t = (content as Record<string, unknown>).text;
    if (typeof t === "string") return t;
  }
  return undefined;
}

/**
 * @param messages       mensajes tal como los devuelve el servidor
 * @param pendingUserMsg el eco optimista pendiente ("" si no hay)
 */
export function ecoYaPersistido(
  messages: ReadonlyArray<{ role: string; content: unknown }>,
  pendingUserMsg: string,
): boolean {
  const pendiente = pendingUserMsg.trim();
  if (!pendiente) return false;
  // El ÚLTIMO mensaje de usuario, no cualquiera: repetir una pregunta anterior
  // es legítimo, y ahí el eco debe verse hasta que la repetición se persista.
  const ultimo = [...messages].reverse().find((m) => m.role === "user");
  return textoDelMensaje(ultimo?.content)?.trim() === pendiente;
}
