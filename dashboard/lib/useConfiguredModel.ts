"use client";

import { useState, useEffect } from "react";

let _cachedModel: string | null = null;

/**
 * Fetches the configured LLM model name from the server once and caches it.
 * Returns null while loading or on error.
 */
export function useConfiguredModel(): string | null {
  const [model, setModel] = useState<string | null>(_cachedModel);
  useEffect(() => {
    if (_cachedModel) return;
    void (async () => {
      try {
        const r = await fetch("/api/config/model");
        const data = (await r.json()) as { model?: string };
        if (data?.model) {
          _cachedModel = data.model;
          setModel(data.model);
        }
      } catch {
        // network or parse error — model display stays null
      }
    })();
  }, []);
  return model;
}
