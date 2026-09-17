import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/** Site-wide inertial smooth scroll. Mounted once at the app root.
 *
 * Lenis defaults to smoothing the REAL window/document scroll position
 * (wrapper: window, content: document.documentElement) rather than faking
 * scroll with a transformed wrapper div -- the latter is an opt-in mode
 * this deliberately avoids, since a `transform` on an ancestor creates a
 * new containing block and breaks `position: sticky` per the CSS spec.
 *
 * GSAP's ticker drives both Lenis and ScrollTrigger off one
 * requestAnimationFrame loop, Lenis's own documented integration, instead
 * of two libraries each running their own separate loop.
 *
 * Even in that native mode, Lenis's own scroll interception measurably
 * broke this app's `position: sticky` pinned frames in testing (How to
 * Play's step/team sequences) -- confirmed with a direct
 * getBoundingClientRect() check, not a screenshot glitch. `lenis.stop()`
 * isn't the fix: it still calls preventDefault() on every wheel/touch
 * event, which would freeze scrolling there entirely instead of
 * restoring native behavior. The actual fix lives in markup: any element
 * with a `data-lenis-prevent` attribute makes Lenis skip that subtree's
 * events completely (see HowToPlay.jsx's root div), so that one screen
 * keeps the exact native scroll it was built and verified against while
 * everything else gets the smooth feel.
 *
 * Skipped entirely under prefers-reduced-motion: inertial "smooth scroll"
 * is exactly the kind of motion that setting exists to opt out of. */
export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const lenis = new Lenis({ autoRaf: false });
    lenis.on("scroll", ScrollTrigger.update);

    function raf(time) {
      lenis.raf(time * 1000);
    }
    gsap.ticker.add(raf);
    // Lenis already smooths scroll velocity; GSAP's own lag-smoothing on
    // top of that would fight it during a slow frame instead of helping.
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);
}
