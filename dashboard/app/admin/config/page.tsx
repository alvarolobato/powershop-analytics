import type { Metadata } from "next";
import { cookies } from "next/headers";
import ConfigPageClient from "./ConfigForm";

export const metadata: Metadata = {
  title: "Configuración — Admin",
};

export const dynamic = "force-dynamic";

/**
 * Server component — reads the `ps_admin` cookie that middleware already
 * validated. Passes the admin key to the client component so it can attach
 * it to API requests without ever touching localStorage.
 */
export default function AdminConfigPage() {
  // The `ps_admin` cookie value equals ADMIN_API_KEY (set by /admin/login action).
  // Middleware already verified it's correct before we reach this component.
  const cookieStore = cookies();
  const adminKey = cookieStore.get("ps_admin")?.value ?? "";

  return <ConfigPageClient adminKeyFromCookie={adminKey} />;
}
