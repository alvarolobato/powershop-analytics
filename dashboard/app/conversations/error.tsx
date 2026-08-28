"use client";

import RouteError from "@/components/RouteError";

export default function SegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      scope="/conversations"
      title="Error al cargar las conversaciones"
      fallbackMessage="No se han podido cargar las conversaciones."
    />
  );
}
