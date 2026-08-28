"use client";

import RouteError from "@/components/RouteError";

export default function SegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      scope="/review"
      title="Error al cargar la revisión"
      fallbackMessage="No se ha podido cargar la revisión."
    />
  );
}
