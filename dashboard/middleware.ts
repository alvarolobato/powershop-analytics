import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json(
        { error: "admin_not_configured", detail: "Set ADMIN_API_KEY in the environment." },
        { status: 503 },
      );
    }
    if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
      return NextResponse.redirect(new URL("/admin/login?error=2", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin")) {
    const headerKey = request.headers.get("x-admin-key")?.trim();
    const auth = request.headers.get("authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const provided = headerKey ?? bearer;
    if (provided !== adminKey) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const cookie = request.cookies.get("ps_admin")?.value;
    if (cookie !== adminKey) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*", "/admin/:path*"],
};
