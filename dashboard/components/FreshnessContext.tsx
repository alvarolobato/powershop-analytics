"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface FreshnessState {
  freshnessText: string;
  freshnessStale: boolean;
  setFreshnessText: (text: string) => void;
  setFreshnessStale: (stale: boolean) => void;
}

const FreshnessContext = createContext<FreshnessState>({
  freshnessText: "Datos al día",
  freshnessStale: false,
  setFreshnessText: () => {},
  setFreshnessStale: () => {},
});

export function FreshnessProvider({ children }: { children: ReactNode }) {
  const [freshnessText, setFreshnessText] = useState("Datos al día");
  const [freshnessStale, setFreshnessStale] = useState(false);

  return (
    <FreshnessContext.Provider value={{ freshnessText, freshnessStale, setFreshnessText, setFreshnessStale }}>
      {children}
    </FreshnessContext.Provider>
  );
}

export function useFreshness() {
  return useContext(FreshnessContext);
}
