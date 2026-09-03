import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "acc-tidp-theme";

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Storage blocked (private window, locked-down policy) - just falls back to "system" for
    // this session; the toggle below still works, it simply won't be remembered on reload.
    return "system";
  }
}

/** "system" means "no explicit choice" - removing the attribute lets the stylesheet's
 * `prefers-color-scheme` media query take over instead of pinning one theme. */
function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

/** Persisted light/dark/system theme choice - the initial value mirrors the inline boot script
 * in index.html (which already set the DOM attribute before first paint), so applying it again
 * here on mount is a no-op rather than a flash. */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(readStored);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort - the choice still applies for this session even if it can't be remembered.
    }
  }, []);

  return { theme, setTheme };
}
