// Light / dark theme. A per-person choice: saved in the person's account (GET/PATCH /api/preferences) and mirrored in
// this browser so the page can paint in the right theme immediately, before anything has loaded (no flash).
// Light is the default for everyone until they choose.

export type Theme = "LIGHT" | "DARK";
export const THEME_KEY = "hrms-theme";

export function readLocalTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "DARK" || t === "LIGHT" ? t : null;
  } catch {
    return null;
  }
}

/** Switch the page to this theme and remember it in this browser. */
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "DARK");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the account copy still works */
  }
}

/** Back to the default (used when somebody signs out, so the next person on this computer starts in light). */
export function resetTheme() {
  document.documentElement.classList.remove("dark");
  try {
    localStorage.removeItem(THEME_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Runs in <head> before the first paint. Only ever adds the "dark" class. */
export const themeBootScript = `(function(){try{if(localStorage.getItem("${THEME_KEY}")==="DARK"){document.documentElement.classList.add("dark")}}catch(e){}})();`;
