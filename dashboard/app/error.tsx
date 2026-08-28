"use client";

import RouteError from "@/components/RouteError";

export default function SegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      scope="app"
      title="Error al cargar la página"
      fallbackMessage="Se ha producido un error inesperado."
    />
  );
}
