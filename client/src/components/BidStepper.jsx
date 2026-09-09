import { useEffect } from "react";
import { motion } from "motion/react";
import useMediaQuery from "../hooks/useMediaQuery.js";

/** Up/down stepper for entering a bid, with the number field left directly
 * editable too. The arrows are a convenience for "one more coin", not a
 * replacement for typing a specific amount. Bounded to [min, max] on every
 * path (arrows, typing, and the clamp-on-blur below), so the same
 * currentBid+1..budget rule the server enforces is always visible in the UI
 * itself instead of only surfacing as a rejected bid after the fact.
 *
 * On a phone this collapses to just the −/+ arrows and the current number
 * between them -- no typed-in field, no +5, no Max. Still can't go below
 * the minimum legal raise (the − arrow disables there, same canDecrement
 * check as desktop); there's just no way to jump by 5 or straight to your
 * whole budget on a phone, only nudge it one coin at a time. The desktop
 * stepper stays exactly as it was; this isn't a redesign of it, just a
 * narrower one swapped in below a breakpoint. */
export default function BidStepper({ value, min, max, onChange }) {
  const isMobileViewport = useMediaQuery("(max-width: 640px)");
  const numValue = Number(value);
  const canDecrement = Number.isFinite(numValue) ? numValue > min : true;
  const canIncrement = Number.isFinite(numValue) ? numValue < max : true;

  // Mobile never shows a way to change the amount away from the minimum,
  // so it needs to actually BE the minimum, not just default to it once
  // and drift out of sync if `min` changes later (the bid war moving the
  // floor up while this player's row was already showing an old value).
  useEffect(() => {
    if (isMobileViewport && value !== String(min)) onChange(String(min));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileViewport, min]);

  // Passes a React functional updater through to onChange (which DraftBoard
  // wires directly to its useState setter) rather than a precomputed string
  // closed over this render's `value` prop. Several rapid clicks fired
  // faster than a re-render (e.g. quick repeated taps) would otherwise all
  // compute "one more than the same stale value" and collapse into a single
  // net +1 instead of stacking. The functional form always sees whatever
  // value is actually pending, however many updates are queued.
  function step(delta) {
    onChange((prev) => {
      const base = Number(prev);
      const from = Number.isFinite(base) ? base : min;
      return String(Math.min(max, Math.max(min, from + delta)));
    });
  }

  function handleBlur() {
    if (value === "") return;
    const clamped = Math.min(max, Math.max(min, Number(value) || min));
    onChange(String(clamped));
  }

  // Same clamp-to-[min,max] guarantee as step(), just to an absolute
  // target instead of a relative delta, for the quick-jump buttons below.
  // Bidding is the single most-repeated action across a whole draft, and
  // ±1-at-a-time was the only way to move the number: fine for a close
  // bid war, tedious for "I just want to go all-in" against a 15-coin gap.
  function jumpTo(target) {
    onChange(String(Math.min(max, Math.max(min, target))));
  }

  const canJumpBy5 = Number.isFinite(numValue) ? numValue + 5 <= max : max - min >= 5;
  const canJumpToMax = Number.isFinite(numValue) ? numValue < max : true;

  if (isMobileViewport) {
    return (
      <div className="bid-stepper bid-stepper-mobile">
        <motion.button
          type="button"
          className="bid-stepper-btn"
          onClick={() => step(-1)}
          disabled={!canDecrement}
          whileTap={canDecrement ? { scale: 0.88 } : undefined}
          aria-label="Decrease bid by 1"
        >
          −
        </motion.button>
        <span className="bid-stepper-mobile-value" aria-live="polite">
          {value}c
        </span>
        <motion.button
          type="button"
          className="bid-stepper-btn"
          onClick={() => step(1)}
          disabled={!canIncrement}
          whileTap={canIncrement ? { scale: 0.88 } : undefined}
          aria-label="Increase bid by 1"
        >
          +
        </motion.button>
      </div>
    );
  }

  return (
    <div className="bid-stepper-group">
      <div className="bid-stepper">
        <motion.button
          type="button"
          className="bid-stepper-btn"
          onClick={() => step(-1)}
          disabled={!canDecrement}
          whileTap={canDecrement ? { scale: 0.88 } : undefined}
          aria-label="Decrease bid by 1"
        >
          −
        </motion.button>
        <input
          type="number"
          className="bid-stepper-input"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={handleBlur}
          aria-label="Bid amount"
        />
        <motion.button
          type="button"
          className="bid-stepper-btn"
          onClick={() => step(1)}
          disabled={!canIncrement}
          whileTap={canIncrement ? { scale: 0.88 } : undefined}
          aria-label="Increase bid by 1"
        >
          +
        </motion.button>
      </div>
      <div className="bid-quick-jumps">
        <motion.button
          type="button"
          className="bid-quick-jump-btn"
          onClick={() => step(5)}
          disabled={!canJumpBy5}
          whileTap={canJumpBy5 ? { scale: 0.92 } : undefined}
        >
          +5
        </motion.button>
        <motion.button
          type="button"
          className="bid-quick-jump-btn"
          onClick={() => jumpTo(max)}
          disabled={!canJumpToMax}
          whileTap={canJumpToMax ? { scale: 0.92 } : undefined}
        >
          Max
        </motion.button>
      </div>
    </div>
  );
}
