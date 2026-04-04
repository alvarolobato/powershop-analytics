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
      <aside className="hidden lg:flex h-screen w-56 flex-col border-r border-gray-200 bg-white flex-shrink-0">
        <div className="flex h-14 items-center border-b border-gray-200 px-4">
          <span className="text-lg font-semibold text-gray-900">PowerShop</span>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4">
          <Link
            href="/"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Dashboards
          </Link>
          <Link
            href="/dashboard/new"
            className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            + Nuevo Dashboard
          </Link>
        </nav>
      </aside>

      {/* Mobile/tablet top bar — visible below lg */}
      <header className="lg:hidden flex items-center justify-between border-b border-gray-200 bg-white px-4 h-14 flex-shrink-0">
        <span className="text-lg font-semibold text-gray-900">PowerShop</span>
        <nav className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            Dashboards
          </Link>
          <Link
            href="/dashboard/new"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
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
    <html lang="es">
      <body className="flex flex-col lg:flex-row h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </body>
    </html>
  );
}
