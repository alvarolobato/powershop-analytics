"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ADMIN_LINKS = [
  { href: "/etl", label: "Monitor ETL" },
  { href: "/admin/slow-queries", label: "Consultas lentas" },
  { href: "/admin/tool-calls", label: "Herramientas LLM" },
  { href: "/admin/usage", label: "Uso LLM" },
] as const;

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-tremor-border bg-tremor-background-muted/60 p-4 dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted/40">
        <p className="text-xs font-medium uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
          Administración
        </p>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Secciones de administración">
          {ADMIN_LINKS.map(({ href, label }) => {
            const active = pathname === href || (href !== "/etl" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={
                  active
                    ? "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white dark:bg-blue-500"
                    : "rounded-md border border-transparent px-3 py-1.5 text-sm font-medium text-tremor-content-emphasis hover:border-tremor-border hover:bg-tremor-background dark:text-dark-tremor-content-emphasis dark:hover:border-dark-tremor-border dark:hover:bg-dark-tremor-background-subtle"
                }
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
