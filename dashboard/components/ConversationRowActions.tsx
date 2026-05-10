"use client";

import { useRouter } from "next/navigation";
import type { ConversationRow } from "@/app/conversations/types";

interface ConversationRowActionsProps {
  conversation: ConversationRow;
  onArchiveToggle: (id: string, currentlyArchived: boolean) => void;
  onRenameStart: () => void;
}

export function ConversationRowActions({
  conversation,
  onArchiveToggle,
  onRenameStart,
}: ConversationRowActionsProps) {
  const router = useRouter();
  const isArchived = conversation.archived_at !== null;
  const isGlobal = conversation.context_kind === "global";

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => undefined);
    }
  };

  const btnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--fg-muted)",
    padding: "4px 6px",
    borderRadius: 4,
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };

  const disabledStyle: React.CSSProperties = {
    ...btnStyle,
    cursor: "not-allowed",
    opacity: 0.4,
  };

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 2 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Continuar */}
      <button
        type="button"
        title="Continuar conversación"
        style={btnStyle}
        onClick={() => router.push(`/c/${conversation.id}`)}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)")
        }
        aria-label="Continuar"
      >
        ↗
      </button>

      {/* Abrir en contexto */}
      {isGlobal ? (
        <button
          type="button"
          title="Sin contexto nativo para esta conversación"
          style={disabledStyle}
          disabled
          aria-label="Abrir en contexto (no disponible)"
        >
          ⊞
        </button>
      ) : (
        <button
          type="button"
          title="Abrir en contexto"
          style={btnStyle}
          onClick={() => router.push(`/k/${conversation.id}`)}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)")
          }
          aria-label="Abrir en contexto"
        >
          ⊞
        </button>
      )}

      {/* Archivar / Desarchivar */}
      <button
        type="button"
        title={isArchived ? "Desarchivar" : "Archivar"}
        style={btnStyle}
        onClick={() => onArchiveToggle(conversation.id, isArchived)}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)")
        }
        aria-label={isArchived ? "Desarchivar" : "Archivar"}
      >
        {isArchived ? "↩" : "⬓"}
      </button>

      {/* Renombrar */}
      <button
        type="button"
        title="Renombrar"
        style={btnStyle}
        onClick={() => onRenameStart()}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)")
        }
        aria-label="Renombrar"
      >
        ✎
      </button>

      {/* Copiar enlace */}
      <button
        type="button"
        title="Copiar enlace (/c/<id>)"
        style={btnStyle}
        onClick={() =>
          copyToClipboard(`${window.location.origin}/c/${conversation.id}`)
        }
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)")
        }
        aria-label="Copiar enlace"
      >
        ⎘
      </button>

      {/* Copiar enlace en contexto */}
      <button
        type="button"
        title="Copiar enlace en contexto (/k/<id>)"
        style={btnStyle}
        onClick={() =>
          copyToClipboard(`${window.location.origin}/k/${conversation.id}`)
        }
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)")
        }
        aria-label="Copiar enlace en contexto"
      >
        ⎘⊞
      </button>
    </div>
  );
}
