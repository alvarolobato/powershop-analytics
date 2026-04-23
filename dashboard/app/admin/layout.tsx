import type { ReactNode } from "react";

/**
 * The sidebar in the root layout is the single source of navigation for the
 * admin area, so we intentionally do not wrap children in any additional
 * chrome here.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
