"use client";

/**
 * Markdown del chat con las fotos de artículo enganchadas (D-068, #986).
 *
 * El problema que resuelve: en un widget hay columnas declaradas y el spec
 * dice cuál lleva el identificador. En el chat hay markdown y no hay nada de
 * eso, así que la detección es al revés — se recogen los candidatos del texto,
 * se le pregunta a la base de datos cuáles son artículos con foto, y solo esos
 * se decoran. Nunca se adivina: si la BD no lo reconoce, el texto se queda
 * exactamente como estaba.
 *
 * Funciona en tablas, párrafos, listas, negritas y `código`, porque el LLM
 * mete las referencias en cualquiera de ellos.
 *
 * Un «modelo» (la Referencia sin los dos últimos caracteres) agrupa un
 * artículo por color. En ese caso el tooltip enseña el primero y avisa de
 * cuántos hay, y el lightbox los recorre todos rotulados con su color.
 */

import {
  createContext,
  createElement,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ElementType,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArticlePhotoHover } from "./ArticlePhotoHover";
import { ESQUEMA_ARTICULO, extraerTokens, idDeEnlace } from "@/lib/articulo-tokens";
import {
  useArticlePhotoTokens,
  type ArticuloConFoto,
  type FotosPorToken,
} from "@/lib/use-article-photo-tokens";

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Qué se enseña bajo la foto: el color distingue a los hermanos de un modelo. */
function etiquetaDe(a: ArticuloConFoto): string | undefined {
  const partes = [a.referencia, a.color].filter((p): p is string => !!p && p.trim() !== "");
  return partes.length > 0 ? partes.join(" · ") : undefined;
}

/**
 * Envuelve un token con su hover. Para un grupo, el disparador es el primer
 * artículo y el recorrido del lightbox son todas las fotos del grupo.
 */
function envolver(contenido: ReactNode, articulos: ArticuloConFoto[], key: string): ReactNode {
  const primero = articulos[0];
  const fotos = articulos.flatMap((a) =>
    a.slots.map((slot) => ({ codigo: a.codigo, slot, etiqueta: etiquetaDe(a) })),
  );
  const esGrupo = articulos.length > 1;
  return (
    <ArticlePhotoHover
      key={key}
      codigo={primero.codigo}
      slots={primero.slots}
      fotos={fotos}
      referencia={primero.referencia ?? undefined}
      descripcion={
        esGrupo
          ? `${primero.descripcion ?? ""} · ${articulos.length} colores`.trim()
          : (primero.descripcion ?? undefined)
      }
    >
      {contenido}
    </ArticlePhotoHover>
  );
}

/**
 * Parte un texto por los tokens reconocidos y envuelve cada coincidencia.
 * Devuelve el mismo string si no hay ninguna, para no añadir nodos de más al
 * 99 % del texto de una conversación.
 */
function decorarTexto(texto: string, porToken: FotosPorToken, re: RegExp | null): ReactNode {
  if (!re) return texto;
  re.lastIndex = 0;
  if (!re.test(texto)) return texto;
  re.lastIndex = 0;

  const trozos: ReactNode[] = [];
  let ultimo = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(texto)) !== null) {
    const articulos = porToken[m[0]];
    if (!articulos) continue;
    if (m.index > ultimo) trozos.push(texto.slice(ultimo, m.index));
    trozos.push(envolver(m[0], articulos, `${m[0]}-${m.index}-${n++}`));
    ultimo = m.index + m[0].length;
  }
  if (trozos.length === 0) return texto;
  if (ultimo < texto.length) trozos.push(texto.slice(ultimo));
  return <>{trozos}</>;
}

/** Recorre los hijos de un nodo decorando solo las cadenas. */
function decorarHijos(hijos: ReactNode, porToken: FotosPorToken, re: RegExp | null): ReactNode {
  if (typeof hijos === "string") return decorarTexto(hijos, porToken, re);
  if (Array.isArray(hijos)) {
    return hijos.map((h, i) =>
      typeof h === "string" ? (
        <Fragment key={i}>{decorarTexto(h, porToken, re)}</Fragment>
      ) : (
        h
      ),
    );
  }
  // Un elemento ya montado (un <strong> con su propio renderer) se deja: su
  // propio componente lo decorará cuando le toque.
  if (isValidElement(hijos)) return hijos;
  return hijos;
}

/**
 * Renderer de enlaces. Se queda con el esquema `articulo:` que pone el LLM y
 * delega el resto en el renderer del consumidor (o en un <a> normal).
 *
 * Es el canal SIN ambigüedad: el identificador viaja aparte del texto visible,
 * así que la foto puede colgar de una descripción o de un modelo, que por sí
 * solos no identifican nada.
 *
 * Lo que el LLM afirma NO se cree a ciegas: el identificador se resuelve
 * contra la base de datos como cualquier otro. Uno inventado no enseña nada —
 * se pinta el texto a secas, sin enlace, porque `articulo:` no es un esquema
 * que el navegador entienda y un enlace roto sería peor que ninguno.
 */
function EnlaceArticulo({
  children: hijos,
  node: _node,
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const { porToken, components } = useContext(CtxFotos);
  const id = idDeEnlace(href);
  if (id === null) {
    // Un `articulo:` que no se pudo interpretar (vacío, o más largo de lo
    // aceptable) NO se pinta: el navegador no entiende el esquema y quedaría
    // un enlace muerto. Se deja el texto.
    if (href?.trim().toLowerCase().startsWith(ESQUEMA_ARTICULO)) return <>{hijos}</>;
    // `node` no se reenvía: es del parser, no un atributo del DOM.
    const Original = (components?.a ?? "a") as ElementType;
    return (
      <Original href={href} {...props}>
        {hijos}
      </Original>
    );
  }
  const articulos = porToken[id];
  // Identificador que la BD no reconoce: el texto, sin enlace.
  if (!articulos || articulos.length === 0) return <>{hijos}</>;
  return envolver(hijos, articulos, `enlace-${id}`);
}

/**
 * Estado que ven los renderers. Va por contexto, y no capturado en closures,
 * por una razón concreta: los componentes que recibe ReactMarkdown tienen que
 * ser SIEMPRE los mismos objetos. Si se recrean cuando llegan las fotos, React
 * ve componentes nuevos, desmonta el mensaje entero y lo vuelve a montar —
 * parpadeo y pérdida del foco a mitad de una conversación.
 */
interface EstadoFotos {
  porToken: FotosPorToken;
  re: RegExp | null;
  components?: Components;
}

const CtxFotos = createContext<EstadoFotos>({ porToken: {}, re: null });

type Etiqueta = "td" | "th" | "p" | "li" | "strong" | "em" | "code";
type PropsEtiqueta = HTMLAttributes<HTMLElement> & { node?: unknown; className?: string };

/**
 * COMPONE con el renderer del consumidor; ni lo sustituye ni se deja
 * sustituir. Dárselo a ReactMarkdown detrás de `...components` haría ganar a
 * los suyos y no se decoraría nada (ConversationPane trae el suyo para `p`);
 * delante sin más haría desaparecer los suyos. Aquí los suyos reciben los
 * hijos ya decorados.
 */
function hacerEtiqueta(Tag: Etiqueta) {
  const Decorado = ({ children: hijos, node: _node, ...props }: PropsEtiqueta) => {
    const { porToken, re, components } = useContext(CtxFotos);
    const Consumidor = components?.[Tag] as ElementType | undefined;
    // Un bloque cercado es `pre > code.language-*`: ahí vive el SQL de la
    // respuesta y no se toca. El `code` en línea sí.
    const enBloque = Tag === "code" && typeof props.className === "string";
    const contenido = enBloque ? hijos : decorarHijos(hijos, porToken, re);
    return createElement((Consumidor ?? Tag) as ElementType, props, contenido);
  };
  Decorado.displayName = `ConFotos(${Tag})`;
  return Decorado;
}

/** Se crean UNA vez, al cargar el módulo. Identidad estable para siempre. */
const ETIQUETAS: Components = {
  td: hacerEtiqueta("td"),
  th: hacerEtiqueta("th"),
  p: hacerEtiqueta("p"),
  li: hacerEtiqueta("li"),
  strong: hacerEtiqueta("strong"),
  em: hacerEtiqueta("em"),
  code: hacerEtiqueta("code"),
  a: EnlaceArticulo,
};

/**
 * Mantiene quieta la lista de tokens mientras el texto crece.
 *
 * Una respuesta en streaming se re-renderiza con cada fragmento, y cada
 * prefijo de una referencia es un candidato distinto: "I263", "I2630",
 * "I26300"... Sin esto, una sola respuesta dispara ~100 peticiones y llena la
 * caché de basura. El primer valor se usa tal cual (los mensajes del historial
 * ya están completos y no deben esperar); solo los cambios posteriores, que
 * son los del streaming, esperan a que el texto se calme.
 */
function useTokensEstables(tokens: string[], msEspera = 400): string[] {
  const clave = tokens.join(" ");
  const [estable, setEstable] = useState(clave);
  const primera = useRef(true);

  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      setEstable(clave);
      return;
    }
    const t = setTimeout(() => setEstable(clave), msEspera);
    return () => clearTimeout(t);
  }, [clave, msEspera]);

  return useMemo(() => (estable ? estable.split(" ") : []), [estable]);
}

export interface MarkdownConFotosProps {
  children: string;
  /** Renderers extra o sobreescrituras del consumidor. */
  components?: Components;
  /** Lista blanca de etiquetas, igual que en ReactMarkdown. */
  allowedElements?: string[];
}

export function MarkdownConFotos({
  children,
  components,
  allowedElements,
}: MarkdownConFotosProps) {
  const candidatos = useMemo(() => extraerTokens(children), [children]);
  const porToken = useArticlePhotoTokens(useTokensEstables(candidatos));

  const re = useMemo(() => {
    const claves = Object.keys(porToken);
    if (claves.length === 0) return null;
    // Más largos primero: una Referencia contiene a su modelo como prefijo, y
    // sin esto "I26300201" se partiría como "I263002" + "01".
    claves.sort((a, b) => b.length - a.length);
    return new RegExp(`\\b(?:${claves.map(escapar).join("|")})\\b`, "g");
  }, [porToken]);

  const estado = useMemo<EstadoFotos>(
    () => ({ porToken, re, components }),
    [porToken, re, components],
  );
  // Los renderers del consumidor para etiquetas que no decoramos (h1, pre...)
  // siguen valiendo; las que sí, las recibe `hacerEtiqueta` por contexto.
  const conFotos = useMemo<Components>(() => ({ ...components, ...ETIQUETAS }), [components]);

  return (
    <CtxFotos.Provider value={estado}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={conFotos}
        allowedElements={allowedElements}
        // react-markdown sanea las URLs y deja solo http/https/mailto/tel, así
        // que `articulo:` llegaba vacío al renderer. Se deja pasar SOLO ese
        // esquema y todo lo demás sigue pasando por el saneado de siempre, que
        // es lo que para un `javascript:`. Nuestro renderer nunca lo pone en el
        // DOM: o lo convierte en el disparador de la foto, o deja el texto solo.
        urlTransform={(url) =>
          url.toLowerCase().startsWith(ESQUEMA_ARTICULO) ? url : defaultUrlTransform(url)
        }
      >
        {children}
      </ReactMarkdown>
    </CtxFotos.Provider>
  );
}
