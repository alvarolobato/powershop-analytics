"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { DashboardRenderer } from "@/components/DashboardRenderer";
import ChatSidebar from "@/components/ChatSidebar";
import type { DashboardSpec } from "@/lib/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardRecord {
  id: number;
  name: string;
  description: string | null;
  spec: DashboardSpec;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ViewDashboard() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [dashboard, setDashboard] = useState<DashboardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveCounter = useRef(0);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load dashboard
  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/dashboard/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error("Error al cargar el dashboard");
      const data: DashboardRecord = await res.json();
      setDashboard(data);
      setNameValue(data.name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al cargar el dashboard",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Focus input when editing name
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  // Save spec (and optionally name)
  const saveSpec = useCallback(
    async (spec: DashboardSpec, prompt?: string) => {
      const thisCount = ++saveCounter.current;
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/dashboard/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spec, prompt }),
        });
        if (!res.ok) throw new Error("Error al guardar");
        const updated: DashboardRecord = await res.json();
        // Only apply if this is still the latest save
        if (thisCount === saveCounter.current) {
          setDashboard(updated);
        }
      } catch (err) {
        if (thisCount === saveCounter.current) {
          setSaveError(
            err instanceof Error ? err.message : "Error al guardar",
          );
        }
      } finally {
        if (thisCount === saveCounter.current) {
          setSaving(false);
        }
      }
    },
    [id],
  );

  // Handle chat modification
  const handleSpecUpdate = useCallback(
    (newSpec: DashboardSpec, prompt: string) => {
      setDashboard((prev) =>
        prev ? { ...prev, spec: newSpec } : prev,
      );
      // Auto-save after chat modification with the actual user prompt
      saveSpec(newSpec, prompt);
    },
    [saveSpec],
  );

  // Handle name edit — persist via PUT endpoint
  const handleNameSave = useCallback(async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || !dashboard) {
      setEditingName(false);
      setNameValue(dashboard?.name || "");
      return;
    }
    setEditingName(false);
    if (trimmed === dashboard.name) return;

    setDashboard((prev) => (prev ? { ...prev, name: trimmed } : prev));
    // Persist name change via the PUT endpoint, coordinated with saveCounter
    const thisCount = ++saveCounter.current;
    try {
      const res = await fetch(`/api/dashboard/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: dashboard.spec, name: trimmed }),
      });
      if (!res.ok) throw new Error("Error al guardar el nombre");
      const updated: DashboardRecord = await res.json();
      if (thisCount === saveCounter.current) {
        setDashboard(updated);
      }
    } catch {
      if (thisCount === saveCounter.current) {
        // Revert on failure
        setDashboard((prev) =>
          prev ? { ...prev, name: dashboard.name } : prev,
        );
        setNameValue(dashboard.name);
      }
    }
  }, [nameValue, dashboard, id]);

  // Handle manual save button
  const handleSave = useCallback(() => {
    if (dashboard) {
      saveSpec(dashboard.spec);
    }
  }, [dashboard, saveSpec]);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"
          role="status"
          aria-label="Cargando"
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Not found
  // -------------------------------------------------------------------------

  if (notFound) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">
          Dashboard no encontrado
        </h1>
        <p className="text-sm text-gray-500">
          El dashboard solicitado no existe o fue eliminado.
        </p>
        <button
          onClick={() => router.push("/")}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Volver a la lista
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error || !dashboard) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <p className="text-sm text-red-800">
            {error || "Error al cargar el dashboard"}
          </p>
          <button
            onClick={fetchDashboard}
            className="mt-2 text-sm font-medium text-red-700 underline hover:text-red-900"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Dashboard view
  // -------------------------------------------------------------------------

  return (
    <div className={`transition-all ${chatOpen ? "mr-[350px]" : ""}`}>
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            aria-label="Volver"
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            &larr; Volver
          </button>

          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
                if (e.key === "Escape") {
                  setEditingName(false);
                  setNameValue(dashboard.name);
                }
              }}
              className="text-2xl font-bold text-gray-900 border-b-2 border-blue-500 bg-transparent outline-none"
            />
          ) : (
            <h1
              className="text-2xl font-bold text-gray-900 cursor-pointer hover:text-blue-600"
              onClick={() => setEditingName(true)}
              title="Haz clic para editar el nombre"
            >
              {dashboard.name}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-3">
          {saving && (
            <span className="text-xs text-gray-400">Guardando...</span>
          )}
          {saveError && (
            <span className="text-xs text-red-500">{saveError}</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Guardar
          </button>
          <button
            onClick={() => setChatOpen((prev) => !prev)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            {chatOpen ? "Cerrar chat" : "Modificar"}
          </button>
        </div>
      </div>

      {/* Dashboard renderer */}
      <DashboardRenderer spec={dashboard.spec} />

      {/* Chat sidebar */}
      <ChatSidebar
        spec={dashboard.spec}
        onSpecUpdate={handleSpecUpdate}
        isOpen={chatOpen}
        onToggle={() => setChatOpen((prev) => !prev)}
      />
    </div>
  );
}
