"use client";

import { useState, useEffect } from "react";

let _cachedModel: string | null = null;
// Shared in-flight promise so concurrent mounts don't fire duplicate requests.
let _modelPromise: Promise<void> | null = null;

/**
 * Fetches the configured LLM model name from the server once and caches it.
 * Returns null while loading or on error.
 */
export function useConfiguredModel(): string | null {
  const [model, setModel] = useState<string | null>(_cachedModel);
  useEffect(() => {
    let mounted = true;
    if (_cachedModel) {
      // Another component already populated the cache before this effect ran.
      setModel(_cachedModel);
      return;
    }
    if (!_modelPromise) {
      _modelPromise = (async () => {
        try {
          const r = await fetch("/api/config/model");
          const data = (await r.json()) as { model?: string };
          if (data?.model) {
            _cachedModel = data.model;
          }
        } catch {
          // network or parse error — model display stays null
        }
      })();
    }
    void _modelPromise.then(() => {
      if (mounted && _cachedModel) setModel(_cachedModel);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return model;
}
