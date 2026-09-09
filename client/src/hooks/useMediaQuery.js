import { useState, useEffect } from "react";

/** A real, resize-reactive media query check -- unlike a one-off
 * `window.matchMedia(query).matches` read at render time (fine for
 * something like prefers-reduced-motion, which realistically never
 * changes mid-session), a viewport-width query genuinely can change while
 * a component stays mounted: a browser window resize, or a phone
 * rotating. Components that only branch their rendering once, at mount,
 * on a stale width get stuck in the wrong mode until they happen to
 * remount for an unrelated reason. Returns false during SSR/first paint
 * on the server (no window yet); the effect below corrects it
 * immediately on the client. */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    function handleChange(e) {
      setMatches(e.matches);
    }

    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
