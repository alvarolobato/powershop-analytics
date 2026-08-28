"use client";

import RouteError from "@/components/RouteError";

export default function SegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      scope="/paneles"
      title="Error al cargar los paneles"
      fallbackMessage="No se han podido cargar los paneles."
    />
  );
}
