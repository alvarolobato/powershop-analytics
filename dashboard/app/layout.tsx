import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import ThemeProvider from "@/components/ThemeProvider";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { getAppFooterLines } from "@/lib/app-version-label";
import "./globals.css";
export const metadata: Metadata = {
  title: "PowerShop Dashboard",
  description: "Cuadros de mando generados con inteligencia artificial para PowerShop Analytics",
};

function Sidebar() {
  const footer = getAppFooterLines();
  return (
    <>
      {/* Desktop sidebar — always visible on lg+ */}
      <aside className="hidden lg:flex h-screen w-56 flex-col border-r border-tremor-border dark:border-dark-tremor-border bg-tremor-background-muted dark:bg-dark-tremor-background-muted flex-shrink-0">
        <div className="flex h-14 items-center border-b border-tremor-border dark:border-dark-tremor-border px-4">
          <span className="text-lg font-semibold text-blue-600 dark:text-blue-400">PowerShop</span>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4">
          <Link
            href="/"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Paneles
          </Link>
          <Link
            href="/review"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Revisión semanal
          </Link>
          <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
            Administración
          </div>
          <Link
            href="/etl"
            className="flex items-center rounded-md py-2 pl-6 pr-3 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Monitor ETL
          </Link>
          <Link
            href="/admin/slow-queries"
            className="flex items-center rounded-md py-2 pl-6 pr-3 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Consultas lentas
          </Link>
          <Link
            href="/admin/tool-calls"
            className="flex items-center rounded-md py-2 pl-6 pr-3 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Herramientas LLM
          </Link>
          <Link
            href="/admin/usage"
            className="flex items-center rounded-md py-2 pl-6 pr-3 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Uso LLM
          </Link>
          <Link
            href="/admin/interactions"
            className="flex items-center rounded-md py-2 pl-6 pr-3 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Interacciones LLM
          </Link>
          <Link
            href="/admin/config"
            className="flex items-center rounded-md py-2 pl-6 pr-3 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Configuración
          </Link>
          <Link
            href="/dashboard/new"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            + Nuevo panel
          </Link>
        </nav>
        <div className="border-t border-tremor-border dark:border-dark-tremor-border px-2 py-3">
          <ThemeSwitcher />
          <p className="mt-2 px-3 text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
            {footer.primary}
            {footer.secondary ? (
              <>
                <br />
                <span className="font-mono text-[10px] opacity-90">{footer.secondary}</span>
              </>
            ) : null}
          </p>
        </div>
      </aside>

      {/* Mobile/tablet top bar — visible below lg */}
      <header className="lg:hidden flex items-center justify-between border-b border-tremor-border dark:border-dark-tremor-border bg-tremor-background-muted dark:bg-dark-tremor-background-muted px-4 h-14 flex-shrink-0">
        <span className="text-lg font-semibold text-blue-600 dark:text-blue-400">PowerShop</span>
        <nav className="flex items-center gap-3">
          <ThemeSwitcher />
          <Link
            href="/"
            className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Paneles
          </Link>
          <Link
            href="/review"
            className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Revisión
          </Link>
          <Link
            href="/etl"
            className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Admin · ETL
          </Link>
          <Link
            href="/admin/slow-queries"
            className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Admin · SQL
          </Link>
          <Link
            href="/admin/tool-calls"
            className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Admin · Tools
          </Link>
          <Link
            href="/admin/usage"
            className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Admin · Uso
          </Link>
          <Link
            href="/admin/interactions"
            className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Admin · Interacciones
          </Link>
          <Link
            href="/admin/config"
            className="text-sm font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis hover:text-tremor-content-strong dark:hover:text-dark-tremor-content-strong"
          >
            Admin · Config
          </Link>
          <Link
            href="/dashboard/new"
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
          >
            + Nuevo
          </Link>
        </nav>
      </header>
    </>
  );
}

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <head>
        {/* Inline script to apply theme before first paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="light"){document.documentElement.classList.remove("dark")}else{document.documentElement.classList.add("dark")}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="flex flex-col lg:flex-row h-screen bg-tremor-background dark:bg-dark-tremor-background text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis antialiased">
        <ThemeProvider>
          <Sidebar />
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
