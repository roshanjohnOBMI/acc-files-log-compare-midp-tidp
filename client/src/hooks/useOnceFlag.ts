import { useCallback, useState } from "react";

/** Tracks a one-time "has this been seen/dismissed before" flag in localStorage - backs the
 * first-visit onboarding hints (the help panel auto-opening once, the Workspace "start here"
 * callout) so each shows exactly once per browser, ever, instead of nagging on every visit. */
export function useOnceFlag(key: string): [boolean, () => void] {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      // Storage blocked (private window, locked-down policy) - treat as "already seen" so a
      // first-time hint doesn't just re-appear forever instead of failing quietly.
      return true;
    }
  });

  const markSeen = useCallback(() => {
    setSeen(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Best-effort - the hint just won't be remembered as dismissed next session.
    }
  }, [key]);

  return [seen, markSeen];
}
