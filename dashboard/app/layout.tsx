import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PowerShop Dashboard",
  description: "AI-generated dashboards for PowerShop Analytics",
};

function Sidebar() {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
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
  );
}

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="es">
      <body className="flex h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </body>
    </html>
  );
}
