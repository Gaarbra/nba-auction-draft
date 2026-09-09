import { motion } from "motion/react";

/** The four-step explainer, designed in Paper as its own scrolling page
 * (not a modal -- see App.jsx's activeTab === "how-to-play" branch) so it
 * can afford real scroll-triggered motion. Each step rises into view once,
 * the first time it's scrolled to; nothing re-animates on a second look.
 * Explanation-tier content (see the animate skill) is exactly where that
 * kind of motion earns its keep -- it's rare (visited once, not per
 * render), and it's demonstrating a sequence, not decorating a dashboard
 * someone stares at all day. */

const STEPS = [
  {
    n: "01",
    title: "Create or join a room",
    body: "Start a public room anyone can find, a private one shared by code, a pass-and-play local game on one device, or go solo. The host picks a player pool (era), difficulty, and bidding style before the draft begins.",
  },
  {
    n: "02",
    title: "Nominate & bid",
    body: "On your turn, a random player from the pool is revealed. Starting bid is 1 coin, and everyone else can raise or pass until only the high bidder is left. Solo drafts skip bidding entirely: every pick lands at a flat 1 coin, with one reroll for the whole draft if you want a do-over.",
  },
  {
    n: "03",
    title: "Build your roster",
    body: "Whoever wins the bid slots that player into one of five roster spots: PG, SG, SF, PF, or C. Everyone starts with the same coin budget, so spend it wisely; a full roster needs at least 1 coin per remaining slot.",
  },
  {
    n: "04",
    title: "See who wins",
    body: "Once every roster is full, the app scores each team from real career stats (points, rebounds, assists, defense, and how well your five starters share the ball) and ranks the room.",
  },
];

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function HowToPlay() {
  return (
    <div className="how-to-play">
      <motion.section
        className="how-to-play-hero"
        initial={{ opacity: 0, transform: prefersReducedMotion ? "translateY(0px)" : "translateY(16px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="how-to-play-eyebrow">
          <span className="how-to-play-eyebrow-dot" />
          Four steps, one draft
        </div>
        <h1>How Hoop Bids works</h1>
        <p>
          A fantasy-style auction draft using real NBA players from any era. No fantasy stats, no made-up prices
          &mdash; scroll for the full rundown.
        </p>
      </motion.section>

      <div className="how-to-play-steps">
        {STEPS.map((step, i) => (
          <motion.div
            className="how-to-play-step"
            key={step.n}
            initial={{ opacity: 0, transform: prefersReducedMotion ? "translateY(0px)" : "translateY(28px)" }}
            whileInView={{ opacity: 1, transform: "translateY(0px)" }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1], delay: prefersReducedMotion ? 0 : Math.min(i, 2) * 0.05 }}
          >
            <span className="how-to-play-step-n">{step.n}</span>
            <div className="how-to-play-step-copy">
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.p
        className="how-to-play-footnote"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.5 }}
      >
        Every player and every stat comes from real NBA data. There's no third-party player database anywhere in the
        pipeline.
      </motion.p>
    </div>
  );
}
