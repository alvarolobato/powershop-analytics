"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface FreshnessState {
  freshnessText: string;
  freshnessStale: boolean;
  freshnessTooltip: string | null;
  setFreshnessText: (text: string) => void;
  setFreshnessStale: (stale: boolean) => void;
  setFreshnessTooltip: (tooltip: string | null) => void;
}

const FreshnessContext = createContext<FreshnessState>({
  freshnessText: "Datos al día",
  freshnessStale: false,
  freshnessTooltip: null,
  setFreshnessText: () => {},
  setFreshnessStale: () => {},
  setFreshnessTooltip: () => {},
});

export function FreshnessProvider({ children }: { children: ReactNode }) {
  const [freshnessText, setFreshnessText] = useState("Datos al día");
  const [freshnessStale, setFreshnessStale] = useState(false);
  const [freshnessTooltip, setFreshnessTooltip] = useState<string | null>(null);

  return (
    <FreshnessContext.Provider
      value={{
        freshnessText,
        freshnessStale,
        freshnessTooltip,
        setFreshnessText,
        setFreshnessStale,
        setFreshnessTooltip,
      }}
    >
      {children}
    </FreshnessContext.Provider>
  );
}

export function useFreshness() {
  return useContext(FreshnessContext);
}
