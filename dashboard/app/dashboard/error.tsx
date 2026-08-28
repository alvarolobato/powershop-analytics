"use client";

import RouteError from "@/components/RouteError";

export default function SegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      scope="/dashboard"
      title="Error al cargar el panel"
      fallbackMessage="No se ha podido cargar el panel."
    />
  );
}
