import { useEffect, useRef } from "react";
import PriceTicker from "./PriceTicker.jsx";

/** A soft spotlight that follows the cursor, plus (homepage only, via
 * `ticker`) real player photos and prices drifting upward, looping
 * endlessly — that's the background doing something specific to this app,
 * rather than generic decoration. Deliberately no drifting color-blob
 * layer here anymore: it was pure atmosphere with nothing to do with an
 * NBA auction draft, competing with the ticker for the same "ambient
 * movement" job. The mouse-follow spotlight is skipped under
 * prefers-reduced-motion and never runs on touch devices (no mousemove
 * there anyway), so it never fights a phone's own scrolling. */
export default function InteractiveBackground({ ticker = false }) {
  const spotlightRef = useRef(null);
  const frameRef = useRef(null);
  const targetRef = useRef({ x: 0.5, y: 0.35 });

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return undefined;

    function handlePointerMove(e) {
      targetRef.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const el = spotlightRef.current;
        if (!el) return;
        el.style.setProperty("--spot-x", `${targetRef.current.x * 100}%`);
        el.style.setProperty("--spot-y", `${targetRef.current.y * 100}%`);
      });
    }

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div className="interactive-bg" aria-hidden="true">
      <div className="bg-spotlight" ref={spotlightRef} />
      <div className="bg-grain" />
      <PriceTicker active={ticker} />
    </div>
  );
}
