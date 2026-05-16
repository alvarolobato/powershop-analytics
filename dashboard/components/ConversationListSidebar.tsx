"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { ConversationRow } from "@/app/conversations/types";

interface ConversationListSidebarProps {
  selectedId: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function ConversationListSidebar({ selectedId }: ConversationListSidebarProps) {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/conversations?mode=chat&context_kind=global&limit=50",
      );
      if (!res.ok) return;
      const data = await res.json();
      const rows: ConversationRow[] = Array.isArray(data) ? data : data.conversations ?? [];
      // Sort by last_interaction_at DESC
      rows.sort(
        (a, b) =>
          new Date(b.last_interaction_at).getTime() -
          new Date(a.last_interaction_at).getTime(),
      );
      setConversations(rows);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch_();
  }, [fetch_]);

  return (
    <div
      data-testid="conversation-list-sidebar"
      style={{
        width: 280,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        overflowY: "auto",
        background: "var(--bg-1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Sidebar header */}
      <div
        style={{
          padding: "12px 14px 8px",
          borderBottom: "1px solid var(--border)",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--fg-muted)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          flexShrink: 0,
        }}
      >
        Conversaciones
      </div>

      {loading && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "24px 0",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: "2px solid var(--border)",
              borderTopColor: "var(--accent)",
              animation: "spin 0.8s linear infinite",
            }}
          />
        </div>
      )}

      {!loading && conversations.length === 0 && (
        <div
          style={{
            padding: "16px 14px",
            fontSize: 12,
            color: "var(--fg-muted)",
          }}
        >
          Sin conversaciones
        </div>
      )}

      {!loading &&
        conversations.map((conv) => {
          const title =
            conv.title?.trim() ||
            (conv.first_user_prompt
              ? conv.first_user_prompt.slice(0, 50)
              : "Sin título");
          const isSelected = conv.id === selectedId;
          const isUnread = conv.is_unread === true;

          return (
            <Link
              key={conv.id}
              href={`/conversations/${conv.id}`}
              data-testid={`sidebar-conv-${conv.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                textDecoration: "none",
                color: "var(--fg)",
                background: isSelected ? "var(--bg-3)" : "transparent",
                borderLeft: isSelected
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                minWidth: 0,
              }}
            >
              {/* Unread indicator */}
              <span
                aria-label={isUnread ? "No leído" : undefined}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: isUnread ? "var(--accent)" : "transparent",
                  flexShrink: 0,
                }}
              />

              {/* Title + timestamp */}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: isSelected || isUnread ? 600 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--fg)",
                  }}
                >
                  {title}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--fg-muted)",
                  }}
                >
                  {formatRelativeTime(conv.last_interaction_at)}
                </span>
              </span>
            </Link>
          );
        })}
    </div>
  );
}
