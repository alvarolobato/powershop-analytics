"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFreshness } from "@/components/FreshnessContext";

interface TopBarProps {
  onCogClick?: () => void;
  /** Override freshness text — falls back to context value */
  freshnessText?: string;
  /** Override freshness stale flag — falls back to context value */
  freshnessStale?: boolean;
}

export function TopBar({ onCogClick, freshnessText: propFreshnessText, freshnessStale: propFreshnessStale }: TopBarProps) {
  const pathname = usePathname();
  const ctx = useFreshness();
  const freshnessText = propFreshnessText ?? ctx.freshnessText;
  const freshnessStale = propFreshnessStale ?? ctx.freshnessStale;

  const navLinks = [
    { href: "/", label: "Paneles" },
    { href: "/review", label: "Revisión" },
    { href: "/glossary", label: "Glosario" },
  ];

  return (
    <header
      style={{ height: 56, borderBottom: "1px solid var(--border)", background: "var(--bg-1)" }}
      className="sticky top-0 z-20 flex items-center justify-between shrink-0"
    >
      {/* Left: logo + nav */}
      <div className="flex items-center gap-6 px-5">
        {/* Powershop bolt logo */}
        <div className="flex items-center gap-1.5">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 2 L14 2 L20 11 L10 22 L4 22 L4 13 L11 13 L8 9 L4 9 Z" fill="var(--accent)" />
          </svg>
          <span
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "-0.01em",
              color: "var(--fg)",
            }}
          >
            Powershop
          </span>
          <span
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

        {/* Primary nav */}
        <nav className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? "var(--fg)" : "var(--fg-muted)",
                  background: isActive ? "var(--bg-2)" : "transparent",
                  textDecoration: "none",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: status + cog + admin + avatar */}
      <div className="flex items-center gap-3 px-5">
        {/* Live status */}
        <div className="flex items-center gap-1.5">
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
          <span
            style={{
              fontSize: 11,
              color: "var(--fg-muted)",
              fontFamily: "var(--font-jetbrains), monospace",
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
            fontSize: 16,
            padding: "4px 8px",
            borderRadius: 6,
            height: 32,
            display: "flex",
            alignItems: "center",
          }}
        >
          ⚙
        </button>

        {/* Admin link */}
        <Link
          href="/admin"
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

        {/* Avatar */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--accent-soft)",
            color: "var(--accent)",
            fontSize: 11,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-label="Avatar de usuario"
        >
          AL
        </div>
      </div>
    </header>
  );
}
