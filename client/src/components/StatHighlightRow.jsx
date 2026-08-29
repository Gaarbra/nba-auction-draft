import { useEffect, useRef, useState } from "react";

// Same five per-game stats as StatRadarChart, but rendered as bklit.com-style
// big numbers with a small uppercase label underneath — the radar chart is
// great for shape-at-a-glance, but the actual figures were previously only
// legible in 9px SVG text. This is the "read it from across the room" view.
const STATS = [
  { key: "pointsPerGame", label: "PPG" },
  { key: "reboundsPerGame", label: "RPG" },
  { key: "assistsPerGame", label: "APG" },
  { key: "stealsPerGame", label: "SPG" },
  { key: "blocksPerGame", label: "BPG" },
];

const COUNT_UP_MS = 650;

/** A single stat's number, animated with a quick count-up from 0 on mount
 * (and again whenever the target value changes, i.e. a new player). Plain
 * rAF rather than Motion here — this never unmounts mid-animation, so there's
 * none of the exit-animation risk that ruled out AnimatePresence elsewhere
 * in this app; it's just simpler for a one-shot numeric tween. */
function CountUpStat({ value, decimals }) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef(null);

  useEffect(() => {
    if (value === null || value === undefined) return undefined;

    // Respect reduced-motion the same way the lobby title shimmer does —
    // and skip straight to the final value rather than leaving it stuck at 0.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return undefined;
    }

    const start = performance.now();
    const from = 0;
    const to = value;

    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / COUNT_UP_MS);
      // ease-out-cubic, so it settles rather than stopping abruptly
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value]);

  if (value === null || value === undefined) return <>—</>;
  return <>{display.toFixed(decimals)}</>;
}

export default function StatHighlightRow({ stats }) {
  if (!stats || stats.unavailable) return null;

  return (
    <div className="stat-highlight-row">
      {STATS.map((s) => (
        <div className="stat-highlight" key={s.key}>
          <span className="stat-highlight-value">
            <CountUpStat value={stats[s.key]} decimals={1} />
          </span>
          <span className="stat-highlight-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
