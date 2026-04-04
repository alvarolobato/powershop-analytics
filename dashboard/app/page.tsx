"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, Title, Text } from "@tremor/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardSummary {
  id: number;
  name: string;
  description: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Home() {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchDashboards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboards");
      if (!res.ok) throw new Error("Error al cargar los dashboards");
      const data: DashboardSummary[] = await res.json();
      setDashboards(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al cargar los dashboards",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboards();
  }, [fetchDashboards]);

  const handleDelete = async (id: number) => {
    const confirmed = window.confirm(
      "¿Seguro que quieres eliminar este dashboard?",
    );
    if (!confirmed) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/dashboard/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error("Error al eliminar el dashboard");
      }
      setDashboards((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Error al eliminar el dashboard",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString("es-ES", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboards</h1>
          <p className="mt-1 text-sm text-gray-500">
            Crea y gestiona cuadros de mando con inteligencia artificial
          </p>
        </div>
        <Link
          href="/dashboard/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + Crear nuevo
        </Link>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"
            role="status"
            aria-label="Cargando"
          />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={fetchDashboards}
            className="mt-2 text-sm font-medium text-red-700 underline hover:text-red-900"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && dashboards.length === 0 && (
        <Card className="max-w-lg">
          <Title>No hay dashboards</Title>
          <Text className="mt-2">
            No hay dashboards. Crea el primero.
          </Text>
          <Link
            href="/dashboard/new"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Crear dashboard
          </Link>
        </Card>
      )}

      {/* Dashboard cards */}
      {!loading && !error && dashboards.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((dashboard) => (
            <Card
              key={dashboard.id}
              className="hover:shadow-md transition-shadow relative group"
            >
              <Link
                href={`/dashboard/${dashboard.id}`}
                className="block space-y-2"
                data-testid={`dashboard-card-${dashboard.id}`}
              >
                <Title>{dashboard.name}</Title>
                {dashboard.description && (
                  <Text className="line-clamp-2">{dashboard.description}</Text>
                )}
                <p className="text-xs text-gray-400">
                  {formatDate(dashboard.updated_at)}
                </p>
              </Link>
              <button
                onClick={() => handleDelete(dashboard.id)}
                disabled={deletingId === dashboard.id}
                aria-label={`Eliminar ${dashboard.name}`}
                className="absolute top-3 right-3 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              >
                {deletingId === dashboard.id ? "..." : "\u2715"}
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
