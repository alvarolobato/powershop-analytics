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
  createElement,
  Fragment,
  isValidElement,
  useMemo,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArticlePhotoHover } from "./ArticlePhotoHover";
import { extraerTokens } from "@/lib/articulo-tokens";
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
function envolver(tok: string, articulos: ArticuloConFoto[], key: string): ReactNode {
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
      {tok}
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
  const tokens = useMemo(() => extraerTokens(children), [children]);
  const porToken = useArticlePhotoTokens(tokens);

  const re = useMemo(() => {
    const claves = Object.keys(porToken);
    if (claves.length === 0) return null;
    // Más largos primero: una Referencia contiene a su modelo como prefijo, y
    // sin esto "I26300201" se partiría como "I263002" + "01".
    claves.sort((a, b) => b.length - a.length);
    return new RegExp(`\\b(?:${claves.map(escapar).join("|")})\\b`, "g");
  }, [porToken]);

  const conFotos: Components = useMemo(() => {
    if (!re) return components ?? {};
    type Etiqueta = "td" | "th" | "p" | "li" | "strong" | "em" | "code";
    // Atributos comunes a todas: las siete etiquetas solo reciben los
    // genéricos de HTML. `node` es el nodo de hast de react-markdown y no debe
    // llegar al DOM, por eso se desestructura y se tira.
    type Props = HTMLAttributes<HTMLElement> & { node?: unknown };
    const envoltorio = (Tag: Etiqueta) => {
      const Decorado = ({ children: hijos, node: _node, ...props }: Props) =>
        createElement(Tag, props, decorarHijos(hijos, porToken, re));
      Decorado.displayName = `ConFotos(${Tag})`;
      return Decorado;
    };
    return {
      td: envoltorio("td"),
      th: envoltorio("th"),
      p: envoltorio("p"),
      li: envoltorio("li"),
      strong: envoltorio("strong"),
      em: envoltorio("em"),
      code: envoltorio("code"),
      ...components,
    };
  }, [re, porToken, components]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={conFotos}
      allowedElements={allowedElements}
    >
      {children}
    </ReactMarkdown>
  );
}
