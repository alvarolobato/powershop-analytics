import { redirect } from "next/navigation";
import { DEFAULT_ADMIN_LANDING } from "@/lib/admin-redirect";

/**
 * There is no dedicated landing page at `/admin`; redirect to the default
 * admin landing so that direct navigation to `/admin` (and post-login
 * redirects that land here) end up at a real page.
 */
export default function AdminRootPage() {
  redirect(DEFAULT_ADMIN_LANDING);
}
