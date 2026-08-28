"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFreshness } from "@/components/FreshnessContext";

interface TopBarProps {
  onCogClick?: () => void;
  /** Override freshness text — falls back to context value */
  freshnessText?: string;
  /** Override freshness stale flag — falls back to context value */
  freshnessStale?: boolean;
  /** Override freshness tooltip (last-sync timestamp) — falls back to context value */
  freshnessTooltip?: string | null;
  /** Public URL of this dashboard app (for self-referencing links). */
  appPublicUrl?: string;
  /** Public URL of WrenAI — used for the "Wren" nav link. */
  wrenPublicUrl?: string;
}

export function TopBar({
  onCogClick,
  freshnessText: propFreshnessText,
  freshnessStale: propFreshnessStale,
  freshnessTooltip: propFreshnessTooltip,
  wrenPublicUrl = "http://localhost:3000",
}: TopBarProps) {
  const pathname = usePathname();
  const ctx = useFreshness();
  const freshnessText = propFreshnessText ?? ctx.freshnessText;
  const freshnessStale = propFreshnessStale ?? ctx.freshnessStale;
  const freshnessTooltip = propFreshnessTooltip ?? ctx.freshnessTooltip;

  // Mobile item 1: hamburger menu. At <768px the inline nav, Admin link and
  // avatar are hidden (Tailwind `hidden md:*` — display-only, never collides
  // with this component's inline styles) and replaced by a hamburger button
  // that opens a full-width panel listing the same destinations plus Admin.
  // Menu closes on link tap, outside tap, and Escape. Desktop (>=768px) is
  // untouched: same inline nav, same pixels.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close on route change (link tap navigates -> pathname changes).
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on outside tap and on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (menuPanelRef.current?.contains(target)) return;
      if (menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const navLinks = [
    { href: "/inicio", label: "Inicio" },
    { href: "/paneles", label: "Paneles" },
    { href: "/conversations", label: "Conversaciones" },
    { href: "/review", label: "Revisión" },
    { href: wrenPublicUrl, label: "Wren", external: true },
  ] as const;

  // Same active-route rule used by the desktop pills, reused by the mobile
  // menu rows (Admin must also be reachable there, so it's appended below).
  function isActiveHref(href: string): boolean {
    if (href === "/inicio") {
      return pathname === "/" || pathname.startsWith("/inicio");
    }
    return pathname.startsWith(href);
  }

  const menuLinks = [...navLinks, { href: "/admin", label: "Admin" }] as const;

  return (
    <header
      style={{ height: 56, borderBottom: "1px solid var(--border)", background: "var(--bg-1)" }}
      className="sticky top-0 z-20 flex items-center justify-between shrink-0"
    >
      {/* Left: logo + nav */}
      <div className="flex items-center gap-6 px-5">
        {/* Powershop bolt logo. Mobile item 10: the SVG is `aria-hidden`,
            so the wordmark is this mark's only accessible name — hidden
            below md via `sr-only md:not-sr-only` (stays in the
            accessibility tree, just visually hidden) rather than a bare
            `hidden`, which would drop it from the accessibility tree too.
            The "ANALYTICS" subtitle is purely decorative secondary text —
            plain `hidden md:inline` is fine there, same as the reference
            repo's own wordmark. */}
        <div className="flex items-center gap-1.5">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 2 L14 2 L20 11 L10 22 L4 22 L4 13 L11 13 L8 9 L4 9 Z" fill="var(--accent)" />
          </svg>
          <span
            className="sr-only md:not-sr-only"
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "-0.01em",
              color: "var(--fg)",
              whiteSpace: "nowrap",
            }}
          >
            Powershop
          </span>
          <span
            className="hidden md:inline"
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 11,
              color: "var(--fg-subtle)",
              marginLeft: 2,
            }}
          >
            ANALYTICS
          </span>
        </div>

        {/* Primary nav — hidden below md, replaced by the hamburger menu */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const isExternal = "external" in link && link.external;
            const isActive =
              !isExternal &&
              (link.href === "/inicio"
                ? pathname === "/" || pathname.startsWith("/inicio")
                : pathname.startsWith(link.href));
            const style = {
              padding: "6px 12px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? "var(--fg)" : "var(--fg-muted)",
              background: isActive ? "var(--bg-2)" : "transparent",
              textDecoration: "none",
            } as const;
            if (isExternal) {
              return (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={style}
                >
                  {link.label}
                </a>
              );
            }
            return (
              <Link key={link.href} href={link.href} style={style}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: status + cog + admin + avatar */}
      <div className="flex items-center gap-3 px-5">
        {/* Live status */}
        <div
          className="flex items-center gap-1.5"
          title={freshnessTooltip ?? undefined}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: freshnessStale ? "var(--warn)" : "var(--up)",
              animation: "pulse-dot 2s ease-in-out infinite",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          {/* Mobile item 11 (PR #894 review, finding 4): freshness text is
              the COMMON case, not an edge case — a stale-data message ("Datos
              desactualizados desde hace…") easily exceeds the ~110px left
              for it at 390px once the logo, cog and 44px hamburger take
              their share of the row. Unbounded, it wraps to 2-3 lines
              inside the fixed 56px header and clips. `.topbar-freshness-
              text` (globals.css, phone-only) caps it to one line with an
              ellipsis instead; desktop keeps the full string. */}
          <span
            className="topbar-freshness-text"
            style={{
              fontSize: 11,
              color: "var(--fg-muted)",
              fontFamily: "var(--font-jetbrains), monospace",
              cursor: freshnessTooltip ? "help" : "default",
            }}
          >
            {freshnessText || "Datos al día"}
          </span>
        </div>

        {/* Cog */}
        <button
          type="button"
          onClick={onCogClick}
          aria-label="Ajustes de visualización"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--fg-muted)",
            padding: "4px 8px",
            borderRadius: 6,
            height: 32,
            display: "flex",
            alignItems: "center",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Hamburger — mobile only. >=44x44 hit area for a thumb tap;
            toggles the menu panel below the header. The icon is centred by
            an inner span, not by `display` on the button itself: an inline
            `display` on this element would beat the `md:hidden` Tailwind
            class that hides it at >=768px (inline styles win over Tailwind
            for the same property — D-120), which is exactly the trap this
            component has to avoid. */}
        <button
          ref={menuButtonRef}
          type="button"
          className="md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menú"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav-panel"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--fg-muted)",
            width: 44,
            height: 44,
            borderRadius: 6,
            marginRight: -10,
            padding: 0,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </span>
        </button>

        {/* Admin link — hidden below md, folded into the hamburger menu */}
        <Link
          href="/admin"
          className="hidden md:inline"
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: "var(--fg-muted)",
            textDecoration: "none",
            padding: "6px 12px",
            borderRadius: 6,
          }}
        >
          Admin
        </Link>

        {/* Avatar — hidden below md (decorative, saves space) */}
        <div
          className="hidden md:flex"
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontSize: 11,
            fontWeight: 600,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-label="Avatar de usuario"
        >
          AL
        </div>
      </div>

      {/* Mobile nav panel — anchored under the 56px header, mobile only.
          Only ever mounted while open, so it never affects desktop. */}
      {menuOpen && (
        <>
          {/* Invisible backdrop. Without it the outside-tap-to-dismiss
              handler closes the menu on mousedown/touchstart but nothing
              swallows the subsequent click, so the tap ALSO activates
              whatever is underneath. Rendered with the panel, below it in
              z-order. */}
          <div
            data-testid="mobile-nav-backdrop"
            className="md:hidden"
            onClick={() => setMenuOpen(false)}
            style={{
              position: "fixed",
              top: 56,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 29,
            }}
          />
          <div
            id="mobile-nav-panel"
            ref={menuPanelRef}
            role="navigation"
            aria-label="Menú principal"
            className="md:hidden"
            style={{
              position: "fixed",
              top: 56,
              left: 0,
              right: 0,
              zIndex: 30,
              background: "var(--bg-1)",
              borderBottom: "1px solid var(--border)",
              boxShadow: "0 8px 16px rgba(0, 0, 0, 0.15)",
            }}
          >
            {menuLinks.map((link) => {
              const isExternal = "external" in link && link.external;
              const isActive = !isExternal && isActiveHref(link.href);
              const rowStyle = {
                display: "flex",
                alignItems: "center",
                minHeight: 44,
                padding: "12px 20px",
                fontSize: 15,
                fontWeight: isActive ? 500 : 400,
                color: isActive ? "var(--fg)" : "var(--fg-muted)",
                background: isActive ? "var(--bg-2)" : "transparent",
                textDecoration: "none",
                borderBottom: "1px solid var(--border)",
              } as const;
              if (isExternal) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    style={rowStyle}
                  >
                    {link.label}
                  </a>
                );
              }
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  style={rowStyle}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </header>
  );
}
