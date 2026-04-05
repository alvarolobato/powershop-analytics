import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: "PowerShop Dashboard",
  description: "Cuadros de mando generados con inteligencia artificial para PowerShop Analytics",
};

function Sidebar() {
  return (
    <>
      {/* Desktop sidebar — always visible on lg+ */}
      <aside className="hidden lg:flex h-screen w-56 flex-col border-r border-dark-tremor-border bg-dark-tremor-background-muted flex-shrink-0">
        <div className="flex h-14 items-center border-b border-dark-tremor-border px-4">
          <span className="text-lg font-semibold text-blue-400">PowerShop</span>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4">
          <Link
            href="/"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-dark-tremor-content-emphasis hover:bg-dark-tremor-background-subtle hover:text-dark-tremor-content-strong"
          >
            Paneles
          </Link>
          <Link
            href="/dashboard/new"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-dark-tremor-content-emphasis hover:bg-dark-tremor-background-subtle hover:text-dark-tremor-content-strong"
          >
            + Nuevo panel
          </Link>
        </nav>
      </aside>

      {/* Mobile/tablet top bar — visible below lg */}
      <header className="lg:hidden flex items-center justify-between border-b border-dark-tremor-border bg-dark-tremor-background-muted px-4 h-14 flex-shrink-0">
        <span className="text-lg font-semibold text-blue-400">PowerShop</span>
        <nav className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm font-medium text-dark-tremor-content-emphasis hover:text-dark-tremor-content-strong"
          >
            Paneles
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
    <html lang="es" className="dark">
      <body className="flex flex-col lg:flex-row h-screen bg-dark-tremor-background text-dark-tremor-content-emphasis antialiased">
        <Sidebar />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </body>
    </html>
  );
}
