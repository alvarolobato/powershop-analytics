import type { Metadata } from "next";
import ConfigPageClient from "./ConfigForm";

export const metadata: Metadata = {
  title: "Configuración — Admin",
};

export const dynamic = "force-dynamic";

export default function AdminConfigPage() {
  return <ConfigPageClient />;
}
