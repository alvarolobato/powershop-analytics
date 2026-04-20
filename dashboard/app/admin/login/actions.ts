"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function loginAdmin(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_API_KEY?.trim();
  if (!expected) {
    redirect("/admin/login?error=2");
  }
  if (password !== expected) {
    redirect("/admin/login?error=1");
  }

  const jar = await cookies();
  jar.set("ps_admin", expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  redirect("/admin/slow-queries");
}
