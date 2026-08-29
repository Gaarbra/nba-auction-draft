import { useEffect, useRef } from "react";

/** Replaces the old static radial-gradient/SVG-court backdrop with something
 * that actually responds to the room: a soft spotlight that follows the
 * cursor, plus a few large blurred color orbs drifting slowly on their own
 * (pure CSS keyframes — no JS needed for that part). The mouse-follow layer
 * is skipped under prefers-reduced-motion and never runs on touch devices
 * (no mousemove there anyway), so it never fights a phone's own scrolling. */
export default function InteractiveBackground() {
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
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <div className="bg-orb bg-orb-c" />
      <div className="bg-spotlight" ref={spotlightRef} />
      <div className="bg-grain" />
    </div>
  );
}
