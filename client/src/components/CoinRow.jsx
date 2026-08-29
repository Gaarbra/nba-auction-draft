import { motion } from "motion/react";

/** A single animated budget meter instead of literally rendering one dot per
 * coin — with a 20-coin starting budget, 20 individual dots read as clutter
 * rather than information. The fill bar communicates "how much is left"
 * just as clearly, animates smoothly when it changes (a bid landing), and
 * the exact number is still right there for anyone who wants precision. */
export default function CoinRow({ budget, max = 20 }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (budget / max) * 100)) : 0;
  const low = pct <= 20;

  return (
    <div className="coin-meter" role="img" aria-label={`${budget} of ${max} coins remaining`}>
      <span className="coin-meter-icon" aria-hidden="true">
        🪙
      </span>
      <div className="coin-meter-track">
        <motion.div
          className={`coin-meter-fill ${low ? "low" : ""}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 220, damping: 28 }}
        />
      </div>
      <span className="coin-meter-count">{budget}</span>
    </div>
  );
}
