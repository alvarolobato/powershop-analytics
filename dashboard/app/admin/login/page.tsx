import Link from "next/link";
import { loginAdmin } from "./actions";
import { safeAdminRedirectTarget } from "@/lib/admin-redirect";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: { error?: string; redirect?: string };
}) {
  const sp = searchParams;
  const err = sp.error === "1";
  const noConfig = sp.error === "2";
  // Sanitize early so the hidden input only ever carries a safe local path.
  const redirectTarget = safeAdminRedirectTarget(sp.redirect);

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-muted dark:bg-dark-tremor-background-muted p-6">
      <h1 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
        Acceso administración
      </h1>
      <p className="text-sm text-tremor-content dark:text-dark-tremor-content">
        Introduce la clave configurada en{" "}
        <code className="rounded bg-tremor-background-subtle px-1">ADMIN_API_KEY</code>.
      </p>
      {err && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Clave incorrecta.
        </p>
      )}
      {noConfig && (
        <p className="text-sm text-amber-700 dark:text-amber-300" role="alert">
          Falta <code className="rounded bg-tremor-background-subtle px-1">ADMIN_API_KEY</code> en el entorno del
          servidor.
        </p>
      )}
      <form action={loginAdmin}>
        <input type="hidden" name="redirect" value={redirectTarget} />
        <label className="block text-sm font-medium text-tremor-content dark:text-dark-tremor-content">
          Clave
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Entrar
        </button>
      </form>
      <Link
        href="/"
        className="block text-center text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
