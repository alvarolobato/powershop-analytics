"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeAdminRedirectTarget } from "@/lib/admin-redirect";

export async function loginAdmin(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const rawRedirect = formData.get("redirect");
  const target = safeAdminRedirectTarget(typeof rawRedirect === "string" ? rawRedirect : null);

  const expected = process.env.ADMIN_API_KEY?.trim();
  if (!expected) {
    redirect(buildLoginRedirect("/admin/login?error=2", target));
  }
  if (password !== expected) {
    redirect(buildLoginRedirect("/admin/login?error=1", target));
  }

  const jar = cookies();
  const secureFlag = process.env.ADMIN_COOKIE_SECURE === "true";
  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureFlag,
    maxAge: 60 * 60 * 8,
  };
  // Set path-scoped cookies so the session credential is only sent to the
  // paths that need it — not every request on the site.
  //   /admin       — admin UI pages and the login page
  //   /etl         — ETL monitor UI pages (same-origin browser navigation)
  //   /api/etl     — ETL data API endpoints called by same-origin fetch from /etl
  //   /api/admin   — admin data API endpoints called by same-origin fetch from /admin/*
  for (const path of ["/admin", "/etl", "/api/etl", "/api/admin"]) {
    jar.set("ps_admin", expected, { ...cookieBase, path });
  }

  redirect(target);
}

/**
 * Preserve the redirect target when bouncing back to the login page with an
 * error, so the user still ends up where they intended after a retry.
 */
function buildLoginRedirect(base: string, target: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}redirect=${encodeURIComponent(target)}`;
}
