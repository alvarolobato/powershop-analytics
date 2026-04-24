"use client";

import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import TweaksPanel from "@/components/TweaksPanel";

/**
 * Wrapper that renders TopBar + TweaksPanel together, managing the open/close state.
 * This lives in layout.tsx so TweaksPanel is available on every page.
 */
export function TopBarWithTweaks() {
  const [tweaksOpen, setTweaksOpen] = useState(false);

  return (
    <>
      <TopBar
        onCogClick={() => setTweaksOpen((v) => !v)}
      />
      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
      />
    </>
  );
}
