"use client";

/**
 * Admin Configuration Page — /admin/config
 *
 * Shows all system configuration keys grouped by section.
 * Requires admin authentication (cookie session — same as all /admin/* pages).
 *
 * Features:
 * - Source badges (env / file / default)
 * - Sensitive fields use SecretField with eye-toggle + server reveal
 * - "Save to file" per-key for env-sourced keys
 * - "Import all env vars" global button
 * - Restart-required banners per section when changed
 * - Inline editing with save
 */

import { useCallback, useEffect, useRef, useState } from "react";
import SecretField from "@/components/SecretField";

// ---------------------------------------------------------------------------
// Types (mirror server response shape)
// ---------------------------------------------------------------------------

interface ConfigKey {
  key: string;
  env: string;
  section: string;
  description: string;
  type: "string" | "int" | "bool" | "enum";
  sensitive: boolean;
  source: "env" | "file" | "default";
  requires_restart: string[];
  editable: boolean;
  value_display: string;
  has_value: boolean;
}

interface ConfigSection {
  name: string;
  keys: ConfigKey[];
}

interface ConfigData {
  sections: ConfigSection[];
  values: ConfigKey[];
}

// ---------------------------------------------------------------------------
// Source badge
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: "env" | "file" | "default" }) {
  const styles = {
    env: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    file: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    default: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  const labels = {
    env: "Variable de entorno",
    file: "Fichero",
    default: "Valor por defecto",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[source]}`}
    >
      {labels[source]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Restart banner
// ---------------------------------------------------------------------------

function RestartBanner({ services }: { services: string[] }) {
  if (!services.length) return null;
  return (
    <div className="mt-1 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      <svg className="h-3 w-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
      </svg>
      Requiere reiniciar: {services.join(", ")}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single config key row
// ---------------------------------------------------------------------------

interface ConfigRowProps {
  item: ConfigKey;
  adminKey: string;
  onSaved: () => void;
}

function ConfigRow({ item, adminKey, onSaved }: ConfigRowProps) {
  const [editValue, setEditValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToFile, setSavedToFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);

  const canEdit = item.editable;

  async function handleReveal() {
    try {
      const res = await fetch(`/api/admin/config/reveal?key=${encodeURIComponent(item.key)}`, {
        headers: { "x-admin-key": adminKey },
      });
      if (!res.ok) throw new Error("No autorizado");
      const data = await res.json();
      setRevealedValue(data.value as string);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startEdit() {
    setEditValue(revealedValue ?? item.value_display);
    setIsEditing(true);
    setError(null);
  }

  function cancelEdit() {
    setIsEditing(false);
    setError(null);
  }

  async function saveValue() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ updates: { [item.key]: editValue } }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error((body as { error?: string }).error ?? "Error al guardar");
      }
      setIsEditing(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveToFile() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ updates: { [item.key]: revealedValue ?? item.value_display } }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error((body as { error?: string }).error ?? "Error al guardar");
      }
      setSavedToFile(true);
      setTimeout(() => setSavedToFile(false), 3000);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-tremor-border dark:border-dark-tremor-border py-3 last:border-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {/* Key name + description */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
              {item.key}
            </span>
            <span className="font-mono text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              ${item.env}
            </span>
            <SourceBadge source={item.source} />
            {!item.editable && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
                Solo lectura
              </span>
            )}
          </div>
          {item.description && (
            <p className="mt-0.5 text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
              {item.description}
            </p>
          )}
        </div>

        {/* Value area */}
        <div className="w-full sm:w-auto sm:min-w-[300px]">
          {isEditing ? (
            <div className="space-y-1">
              {item.sensitive ? (
                <SecretField
                  value={editValue}
                  revealed={editValue}
                  onChange={setEditValue}
                  placeholder="Introduce el valor..."
                />
              ) : (
                <input
                  type={item.type === "int" ? "number" : "text"}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-full rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-1.5 text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              )}
              <div className="flex gap-2">
                <button
                  onClick={saveValue}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-md border border-tremor-border dark:border-dark-tremor-border px-3 py-1 text-xs font-medium hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {item.sensitive ? (
                <SecretField
                  value={item.value_display}
                  revealed={revealedValue}
                  onReveal={handleReveal}
                  readOnly
                />
              ) : (
                <span className="font-mono text-sm text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
                  {item.value_display || (
                    <span className="italic text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                      (sin valor)
                    </span>
                  )}
                </span>
              )}
              {canEdit && (
                <button
                  onClick={startEdit}
                  className="rounded-md border border-tremor-border dark:border-dark-tremor-border px-2 py-0.5 text-xs hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle"
                >
                  Editar
                </button>
              )}
              {item.source === "env" && canEdit && (
                <button
                  onClick={saveToFile}
                  disabled={saving}
                  title="Copia el valor actual al fichero config.yaml"
                  className="rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40 disabled:opacity-50"
                >
                  {savedToFile ? "Guardado" : "Guardar en fichero"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Env precedence warning */}
      {item.source === "env" && (
        <p className="mt-1 text-xs text-purple-700 dark:text-purple-400">
          Variable de entorno activa — tiene prioridad sobre el fichero hasta que la elimines del entorno.
        </p>
      )}

      {/* Restart warning (shown after edit) */}
      {item.requires_restart?.length > 0 && isEditing && (
        <RestartBanner services={item.requires_restart} />
      )}

      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function SectionCard({
  section,
  adminKey,
  onRefresh,
}: {
  section: ConfigSection;
  adminKey: string;
  onRefresh: () => void;
}) {
  const restartServices = Array.from(
    new Set(section.keys.flatMap((k) => k.requires_restart)),
  );

  return (
    <div className="rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background">
      <div className="flex items-center justify-between border-b border-tremor-border dark:border-dark-tremor-border px-4 py-2">
        <h2 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          {section.name}
        </h2>
        {restartServices.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Cambios requieren reinicio
          </span>
        )}
      </div>
      <div className="px-4">
        {section.keys.map((item) => (
          <ConfigRow
            key={item.key}
            item={item}
            adminKey={adminKey}
            onSaved={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function ConfigPageClient() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminKey, setAdminKey] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // Try to read admin key from cookie or localStorage
  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? (localStorage.getItem("admin_key") ?? "") : "";
    setAdminKey(stored);
  }, []);

  const loadConfig = useCallback(async (key?: string) => {
    const k = key ?? adminKey;
    if (!k) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/config", {
        headers: { "x-admin-key": k },
      });
      if (res.status === 401) {
        setError("No autorizado. Verifica tu clave de administrador.");
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const json = (await res.json()) as ConfigData;
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    if (adminKey) {
      void loadConfig(adminKey);
    } else {
      setLoading(false);
    }
  }, [adminKey, loadConfig]);

  async function handleImportAll() {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/config/import-env", {
        method: "POST",
        headers: { "x-admin-key": adminKey },
      });
      const body = await res.json() as { message?: string; error?: string };
      setImportResult(body.message ?? body.error ?? "Hecho");
      await loadConfig();
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // Admin key login form
  if (!adminKey) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Configuración del sistema
        </h1>
        <div className="max-w-sm space-y-3 rounded-lg border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4">
          <p className="text-sm text-tremor-content dark:text-dark-tremor-content">
            Introduce la clave de administrador para acceder.
          </p>
          <AdminKeyForm
            onSubmit={(k) => {
              localStorage.setItem("admin_key", k);
              setAdminKey(k);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
          Configuración del sistema
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void loadConfig()}
            disabled={loading}
            className="rounded-md border border-tremor-border dark:border-dark-tremor-border px-3 py-1.5 text-sm hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-subtle disabled:opacity-50"
          >
            Recargar
          </button>
          <button
            onClick={() => void handleImportAll()}
            disabled={importing || loading}
            title="Copia todas las variables de entorno activas al fichero config.yaml"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? "Importando..." : "Importar todas las env al fichero"}
          </button>
        </div>
      </div>

      {importResult && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          {importResult}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
          Cargando configuración...
        </div>
      )}

      {data && !loading && (
        <div className="space-y-4">
          <p className="text-sm text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
            {data.values.length} claves de configuración en {data.sections.length} secciones.
            Los cambios en el fichero se aplican inmediatamente para ajustes LLM/agentic; las
            conexiones de base de datos requieren reiniciar el contenedor correspondiente.
          </p>
          {data.sections.map((section) => (
            <SectionCard
              key={section.name}
              section={section}
              adminKey={adminKey}
              onRefresh={() => void loadConfig()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline admin key form (shown when not authenticated)
// ---------------------------------------------------------------------------

function AdminKeyForm({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
      className="flex gap-2"
    >
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ADMIN_API_KEY"
        autoComplete="current-password"
        className="flex-1 rounded-md border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button
        type="submit"
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        Acceder
      </button>
    </form>
  );
}
