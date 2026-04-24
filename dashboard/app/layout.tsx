import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import ThemeProvider from "@/components/ThemeProvider";
import { TweaksPanelProvider } from "@/components/TweaksPanel";
import { TopBarWithTweaks } from "@/components/TopBarWithTweaks";
import "./globals.css";

export const metadata: Metadata = {
  title: "PowerShop Dashboard",
  description: "Cuadros de mando generados con inteligencia artificial para PowerShop Analytics",
};

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Pre-paint script: reads ps.tweaks.v1 (and falls back to legacy "theme" key)
// and applies data-theme, data-accent, data-density to <html> before first paint.
const preloadScript = `(function(){
  try {
    var el = document.documentElement;
    // Try new key first
    var raw = localStorage.getItem('ps.tweaks.v1');
    if (raw) {
      try {
        var t = JSON.parse(raw);
        if (t.theme === 'light' || t.theme === 'dark') {
          el.setAttribute('data-theme', t.theme);
          if (t.theme === 'light') { el.classList.remove('dark'); } else { el.classList.add('dark'); }
        }
        if (t.accent) { el.setAttribute('data-accent', t.accent); }
        if (t.density) { el.setAttribute('data-density', t.density); }
      } catch(e) {}
    } else {
      // Fallback: legacy "theme" key
      var legacy = localStorage.getItem('theme');
      if (legacy === 'light') {
        el.setAttribute('data-theme', 'light');
        el.classList.remove('dark');
      } else {
        el.setAttribute('data-theme', 'dark');
        el.classList.add('dark');
      }
    }
  } catch(e) {}
})();`;

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="es"
      data-theme="dark"
      data-accent="electric"
      className="dark"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: preloadScript }} />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "var(--bg)",
          color: "var(--fg)",
          fontFamily: "var(--font-inter), sans-serif",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"tnum"',
        }}
      >
        <ThemeProvider>
          <TweaksPanelProvider>
            <TopBarWithTweaks />
            <main style={{ flex: 1, overflow: "auto", padding: "0" }}>{children}</main>
          </TweaksPanelProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
