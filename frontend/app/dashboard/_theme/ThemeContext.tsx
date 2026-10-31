"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import { applyTheme, readLocalTheme, type Theme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// THEME for the signed-in person.
// On load the person's saved choice (their account) decides: dark only if they chose it, light otherwise. If the
// account store is not available yet (the preferences table has not been created), this browser's copy is used so
// the toggle still works. Pressing the toggle applies at once, remembers it here, and saves it to the account.
// ---------------------------------------------------------------------------

type Value = { theme: Theme; toggle: () => void; saved: boolean };
const Ctx = createContext<Value | null>(null);

export function useTheme(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used inside ThemeProvider");
  return v;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "DARK" : "LIGHT"));
  const [saved, setSaved] = useState(true); // false = the account store is unavailable, so the choice lives in this browser only

  useEffect(() => {
    let live = true;
    apiGet<{ ready: boolean; theme: Theme | null }>("/preferences")
      .then((p) => {
        if (!live) return;
        if (p.ready) {
          const next: Theme = p.theme ?? "LIGHT"; // nothing saved = light, whatever a previous person left in this browser
          applyTheme(next);
          setTheme(next);
          setSaved(true);
        } else {
          setSaved(false);
          const local = readLocalTheme();
          if (local) {
            applyTheme(local);
            setTheme(local);
          }
        }
      })
      .catch(() => {
        // the server could not be reached: keep whatever is on screen
      });
    return () => {
      live = false;
    };
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === "DARK" ? "LIGHT" : "DARK";
    applyTheme(next);
    setTheme(next);
    apiPatch("/preferences", { theme: next })
      .then(() => setSaved(true))
      .catch(() => setSaved(false)); // not saved to the account; it still applies here
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle, saved }), [theme, toggle, saved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
