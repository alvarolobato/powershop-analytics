// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const ADMIN_KEY = "test-admin-key";

const ORIGINAL_ADMIN_KEY = process.env.ADMIN_API_KEY;

beforeEach(() => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_KEY === undefined) {
    delete process.env.ADMIN_API_KEY;
  } else {
    process.env.ADMIN_API_KEY = ORIGINAL_ADMIN_KEY;
  }
});

function makeRequest(
  pathname: string,
  opts: { cookie?: string; search?: string } = {},
): NextRequest {
  const url = `http://localhost:4000${pathname}${opts.search ?? ""}`;
  const headers: Record<string, string> = {};
  if (opts.cookie) {
    headers["cookie"] = `ps_admin=${opts.cookie}`;
  }
  return new NextRequest(url, { headers });
}

describe("middleware — admin UI gating", () => {
  describe("when ADMIN_API_KEY is set", () => {
    it("redirects unauthenticated /admin/slow-queries to login with redirect param", () => {
      const res = middleware(makeRequest("/admin/slow-queries"));
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      expect(location).toContain("/admin/login");
      expect(location).toContain("redirect=%2Fadmin%2Fslow-queries");
    });

    it("redirects unauthenticated /etl to login with redirect=%2Fetl", () => {
      const res = middleware(makeRequest("/etl"));
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      expect(location).toContain("/admin/login");
      expect(location).toContain("redirect=%2Fetl");
    });

    it("redirects unauthenticated /etl/42 to login with redirect=%2Fetl%2F42", () => {
      const res = middleware(makeRequest("/etl/42"));
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      expect(location).toContain("redirect=%2Fetl%2F42");
    });

    it("preserves the original query string in the redirect param", () => {
      const res = middleware(makeRequest("/admin/usage", { search: "?period=7d" }));
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      // "/admin/usage?period=7d" percent-encoded.
      expect(location).toContain("redirect=%2Fadmin%2Fusage%3Fperiod%3D7d");
    });

    it("allows authenticated requests to /etl to pass through", () => {
      const res = middleware(makeRequest("/etl", { cookie: ADMIN_KEY }));
      // NextResponse.next() returns status 200 and no location header.
      expect(res.headers.get("location")).toBeNull();
    });

    it("allows authenticated requests to /admin/slow-queries to pass through", () => {
      const res = middleware(makeRequest("/admin/slow-queries", { cookie: ADMIN_KEY }));
      expect(res.headers.get("location")).toBeNull();
    });

    it("redirects authenticated /etl request with wrong cookie back to login", () => {
      const res = middleware(makeRequest("/etl", { cookie: "stale" }));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/admin/login");
    });

    it("lets /admin/login through without requiring auth", () => {
      const res = middleware(makeRequest("/admin/login"));
      expect(res.headers.get("location")).toBeNull();
    });

    it("returns 401 JSON for /api/admin/* without a valid header", async () => {
      const res = middleware(makeRequest("/api/admin/usage"));
      expect(res.status).toBe(401);
    });
  });

  describe("when ADMIN_API_KEY is missing", () => {
    beforeEach(() => {
      delete process.env.ADMIN_API_KEY;
    });

    it("returns 503 JSON for /api/admin/*", async () => {
      const res = middleware(makeRequest("/api/admin/usage"));
      expect(res.status).toBe(503);
    });

    it("redirects /admin/slow-queries to login with error=2 and redirect param", () => {
      const res = middleware(makeRequest("/admin/slow-queries"));
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      expect(location).toContain("error=2");
      expect(location).toContain("redirect=%2Fadmin%2Fslow-queries");
    });

    it("redirects /etl to login with error=2 and redirect=%2Fetl", () => {
      const res = middleware(makeRequest("/etl"));
      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      expect(location).toContain("error=2");
      expect(location).toContain("redirect=%2Fetl");
    });

    it("does not interfere with non-admin paths", () => {
      const res = middleware(makeRequest("/"));
      expect(res.headers.get("location")).toBeNull();
    });
  });
});
