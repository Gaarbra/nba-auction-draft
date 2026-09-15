import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, useInView, animate } from "motion/react";

/** The four-step explainer, designed in Paper as its own scrolling page
 * (not a modal -- see App.jsx's activeTab === "how-to-play" branch) so it
 * can afford real scroll-triggered motion. Each step rises into view once,
 * the first time it's scrolled to; nothing re-animates on a second look.
 * Explanation-tier content (see the animate skill) is exactly where that
 * kind of motion earns its keep -- it's rare (visited once, not per
 * render), and it's demonstrating a sequence, not decorating a dashboard
 * someone stares at all day.
 *
 * Below the four steps: the real math. Two genuinely different systems,
 * kept visually distinct so they don't read as one thing -- "Suggested
 * value" (stats-service/ml.py) is a trained scikit-learn model scored
 * against real completed drafts; "Final team score" (server's scoring.js)
 * is a fixed hand-designed formula, no training involved. Every number and
 * formula here is copied from those two source files, not paraphrased or
 * invented for this page.
 *
 * At the bottom: a worked example using five real Hall of Famers' actual
 * career per-game numbers (pulled from this app's own live database, see
 * the curl calls this file's history was built from), run through the
 * exact same functions as server/src/scoring/scoring.js so the displayed
 * result can never drift from what the real app would compute. */

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

// Four genuinely different entrance treatments, one per step, instead of
// the same fade-and-rise repeated four times. Each still follows the
// animate skill's rules (transform/opacity or clip-path only, real easing
// tokens, springs reserved for the one that should feel alive) -- "diverse"
// doesn't mean "anything goes," it means four deliberate, distinct choices.
const EASE_OUT = [0.23, 1, 0.32, 1];

function stepVariant(i, reduced) {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      whileInView: { opacity: 1 },
      transition: { duration: 0.4 },
    };
  }
  switch (i) {
    case 0: // slides in from the left -- "the start of the journey"
      return {
        initial: { opacity: 0, transform: "translateX(-56px)" },
        whileInView: { opacity: 1, transform: "translateX(0px)" },
        transition: { duration: 0.55, ease: EASE_OUT },
      };
    case 1: // answers from the right -- alternating rhythm down the page
      return {
        initial: { opacity: 0, transform: "translateX(56px)" },
        whileInView: { opacity: 1, transform: "translateX(0px)" },
        transition: { duration: 0.55, ease: EASE_OUT },
      };
    case 2: // a small confident pop -- the one step that gets a spring
      return {
        initial: { opacity: 0, transform: "scale(0.92)" },
        whileInView: { opacity: 1, transform: "scale(1)" },
        transition: { type: "spring", stiffness: 220, damping: 18 },
      };
    default: // a bottom-up wipe -- clip-path, the animate skill's sanctioned
      // fourth property, doing the reveal instead of opacity
      return {
        initial: { clipPath: "inset(0% 0% 100% 0%)" },
        whileInView: { clipPath: "inset(0% 0% 0% 0%)" },
        transition: { duration: 0.6, ease: EASE_OUT },
      };
  }
}

// Short definitions for every variable that shows up in an equation line
// below, keyed by the exact substring as it's written in that line.
// tokenizeFormula splits a line on these keys (longest first, so "combined
// Usage%" style multi-word keys win over a shorter one nested inside them)
// and wraps each match in a hoverable EquationVar; everything else stays
// plain text.
const VAR_GLOSSARY = {
  "TS%": "True Shooting percentage: shooting efficiency that also counts free throws and the extra value of a 3-pointer.",
  PTS: "Points per game.",
  FGA: "Field goal attempts per game.",
  FTA: "Free throw attempts per game.",
  Op: "Offense score: this app's own rating for a player's offensive contribution.",
  AST: "Assists per game.",
  TOV: "Turnovers per game.",
  DIR: "Defensive Impact Rating: this app's own rating for a player's defensive contribution.",
  STL: "Steals per game.",
  BLK: "Blocks per game.",
  REB: "Rebounds per game.",
  "Defensive Win Shares": "A real stat estimating how many wins a player's defense was worth over a season.",
  "games played": "How many games that player actually appeared in that season.",
  "Usage%": "The share of team possessions a player used while on the floor.",
  Pen: "Position penalty: a flat deduction for playing someone away from their real listed position.",
  "Synergy multiplier": "A team-wide bonus or penalty based on how spread out the ball usage is across the 5 starters.",
  "Final Score": "The team's total score across all 5 starters, after the synergy multiplier is applied.",
};

const VAR_KEYS_BY_LENGTH = Object.keys(VAR_GLOSSARY).sort((a, b) => b.length - a.length);
const VAR_SPLIT_PATTERN = new RegExp(
  `(${VAR_KEYS_BY_LENGTH.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  "g",
);

function tokenizeFormula(text) {
  return text.split(VAR_SPLIT_PATTERN).filter((part) => part !== "");
}

/** One variable inside an equation line, hoverable (and focusable, for
 * keyboard/touch) to show a short plain-language definition. */
function EquationVar({ token }) {
  const [open, setOpen] = useState(false);
  const definition = VAR_GLOSSARY[token];
  if (!definition) return <span>{token}</span>;
  return (
    <span
      className="how-to-play-var"
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {token}
      {open && (
        <motion.span
          className="how-to-play-var-tooltip"
          role="tooltip"
          initial={{ opacity: 0, transform: "translate(-50%, 4px)" }}
          animate={{ opacity: 1, transform: "translate(-50%, 0px)" }}
          transition={{ duration: 0.15, ease: EASE_OUT }}
        >
          {definition}
        </motion.span>
      )}
    </span>
  );
}

const TS_FORMULA = "TS% = PTS ÷ (2 × (FGA + 0.44 × FTA))";

const PRICE_FEATURES = [
  "PPG, RPG, APG, SPG, BPG",
  "True Shooting %, Usage %, minutes/game",
  "career games played, turnovers/game",
  "+ this room's era, slot, and difficulty",
];

function EquationCard({ index, label, lines, note }) {
  return (
    <motion.div
      className="how-to-play-eq-card"
      initial={{ opacity: 0, transform: "translateY(18px)", filter: "blur(6px)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay: index * 0.06 }}
    >
      <span className="how-to-play-eq-label">{label}</span>
      {lines.map((line, i) => (
        <code key={i} className="how-to-play-eq-line">
          {tokenizeFormula(line).map((part, j) =>
            VAR_GLOSSARY[part] ? <EquationVar key={j} token={part} /> : <span key={j}>{part}</span>,
          )}
        </code>
      ))}
      {note && <p className="how-to-play-eq-note">{note}</p>}
    </motion.div>
  );
}

// --- Worked example: a real starting five --------------------------------
//
// Real career per-game numbers, pulled live from this app's own
// /api/players/:id/stats and /api/players/:id/usage-pct while writing this
// page (Curry, Jordan, LeBron, Duncan, Olajuwon -- the exact ids this app
// uses are 201939, 893, 2544, 1495, 165). Not invented, not rounded from
// memory. The math below runs the real formulas from
// server/src/scoring/scoring.js against these numbers, so the result on
// screen is always internally consistent with what's typed in here.
const SHOWCASE_TEAM = [
  { slot: "PG", position: "G", name: "Stephen Curry", pts: 24.8, reb: 4.7, ast: 6.3, stl: 1.5, blk: 0.3, fga: 17.9, fta: 4.3, tov: 3.1, usg: 30.8 },
  { slot: "SG", position: "G", name: "Michael Jordan", pts: 30.1, reb: 6.2, ast: 5.3, stl: 2.3, blk: 0.8, fga: 22.9, fta: 8.2, tov: 2.7, usg: 28.4 },
  { slot: "SF", position: "F", name: "LeBron James", pts: 26.8, reb: 7.5, ast: 7.4, stl: 1.5, blk: 0.7, fga: 19.4, fta: 7.4, tov: 3.5, usg: 26.2 },
  { slot: "PF", position: "C-F", name: "Tim Duncan", pts: 19.0, reb: 10.8, ast: 3.0, stl: 0.7, blk: 2.2, fga: 14.6, fta: 6.1, tov: 2.4, usg: 17.1 },
  { slot: "C", position: "C", name: "Hakeem Olajuwon", pts: 21.8, reb: 11.1, ast: 2.5, stl: 1.7, blk: 3.1, fga: 17.0, fta: 6.2, tov: 3.0, usg: 18.2 },
];

// The exact same math as trueShootingPercentage/offenseScore/
// defensiveImpactRating/synergyMultiplier/positionMismatchPenalty in
// server/src/scoring/scoring.js.
function trueShootingPct(pts, fga, fta) {
  const denom = 2 * (fga + 0.44 * fta);
  return denom === 0 ? 0 : pts / denom;
}
function offenseScore(p) {
  return p.pts * trueShootingPct(p.pts, p.fga, p.fta) + p.ast * 1.5 - p.tov * 2.0;
}
function defensiveImpact(p) {
  return p.stl * 2.5 + p.blk * 2.0 + p.reb * 0.3;
}
function synergyMultiplier(sumUsage) {
  if (sumUsage <= 105) return 1.1;
  if (sumUsage <= 125) return 1.0;
  return 0.85;
}
const SLOT_GROUP = { PG: "G", SG: "G", SF: "F", PF: "F", C: "C" };
const POSITION_PENALTY = 3.0;
function positionPenalty(position, slot) {
  if (!position || !slot) return 0;
  const group = SLOT_GROUP[slot];
  if (!group) return 0;
  return position.toUpperCase().includes(group) ? 0 : POSITION_PENALTY;
}
// A hypothetical, not part of the real roster below: what Olajuwon's real
// numbers would score if he'd been slotted at PG instead of C, purely to
// show the penalty landing on a real player instead of only in the
// abstract. Same real stats, same offenseScore/defensiveImpact functions.
const OLAJUWON_AT_PG_PENALTY = positionPenalty("C", "PG");

const SHOWCASE_SCORED = SHOWCASE_TEAM.map((p) => {
  const op = offenseScore(p);
  const dir = defensiveImpact(p);
  const penalty = positionPenalty(p.position, p.slot);
  return { ...p, ts: trueShootingPct(p.pts, p.fga, p.fta), op, dir, penalty, total: op + dir - penalty };
});
const SHOWCASE_SUM_TOTAL = SHOWCASE_SCORED.reduce((sum, p) => sum + p.total, 0);
const SHOWCASE_SUM_PENALTY = SHOWCASE_SCORED.reduce((sum, p) => sum + p.penalty, 0);
const SHOWCASE_SUM_USAGE = SHOWCASE_SCORED.reduce((sum, p) => sum + p.usg, 0);
const SHOWCASE_MS = synergyMultiplier(SHOWCASE_SUM_USAGE);
const SHOWCASE_FINAL = SHOWCASE_SUM_TOTAL * SHOWCASE_MS;

/** Counts up from 0 to `value` once its element scrolls into view -- a
 * different reveal mechanic again from the steps' whileInView and the
 * equation cards' blur-in, and the one that actually fits a page about
 * stats: the numbers arrive the way a scoreboard fills in, not just fade
 * into place. */
function CountUpStat({ value, decimals = 1, prefix = "", suffix = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (prefersReducedMotion) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value]);

  return (
    <span ref={ref} className="how-to-play-countup">
      {prefix}
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

function ShowcasePlayerCard({ player, index }) {
  return (
    <motion.div
      className="how-to-play-showcase-card"
      initial={{ opacity: 0, transform: "translateY(24px) scale(0.94) rotateX(8deg)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px) scale(1) rotateX(0deg)" }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay: index * 0.08 }}
      style={{ transformPerspective: 600 }}
    >
      <span className="how-to-play-showcase-slot">{player.slot}</span>
      <span className="how-to-play-showcase-name">{player.name}</span>
      <div className="how-to-play-showcase-line">
        <span>
          <CountUpStat value={player.pts} /> <b>PTS</b>
        </span>
        <span>
          <CountUpStat value={player.reb} /> <b>REB</b>
        </span>
        <span>
          <CountUpStat value={player.ast} /> <b>AST</b>
        </span>
        <span>
          <CountUpStat value={player.stl} /> <b>STL</b>
        </span>
        <span>
          <CountUpStat value={player.blk} /> <b>BLK</b>
        </span>
      </div>
      <div className="how-to-play-showcase-computed">
        <span>
          Op <CountUpStat value={player.op} />
        </span>
        <span>
          DIR <CountUpStat value={player.dir} />
        </span>
        <span className="total">
          Total <CountUpStat value={player.total} />
        </span>
      </div>
    </motion.div>
  );
}

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function HowToPlay() {
  const stepsRef = useRef(null);
  // A continuous, scroll-linked fill (not triggered once like the steps
  // themselves) -- the closest thing on this page to the sticky/parallax
  // scrubbing modern product pages use, sized to what a 4-item list
  // actually warrants rather than a full pinned-scroll sequence.
  const { scrollYProgress } = useScroll({
    target: stepsRef,
    offset: ["start 0.8", "end 0.6"],
  });
  const railScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <div className="how-to-play">
      <motion.section
        className="how-to-play-hero"
        initial={{ opacity: 0, transform: prefersReducedMotion ? "translateY(0px)" : "translateY(16px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        <div className="how-to-play-eyebrow">
          <span className="how-to-play-eyebrow-dot" />
          Four steps, one draft
        </div>
        <h1>How Hoop Bids works</h1>
        <p>
          A fantasy-style auction draft using real NBA players from any era. No fantasy stats, no made-up prices.
          Scroll for the full rundown.
        </p>
      </motion.section>

      <div className="how-to-play-steps" ref={stepsRef}>
        {!prefersReducedMotion && (
          <span className="how-to-play-rail" aria-hidden="true">
            <motion.span className="how-to-play-rail-fill" style={{ scaleY: railScale }} />
          </span>
        )}
        {STEPS.map((step, i) => {
          const variant = stepVariant(i, prefersReducedMotion);
          return (
            <motion.div
              className="how-to-play-step"
              key={step.n}
              initial={variant.initial}
              whileInView={variant.whileInView}
              viewport={{ once: true, margin: "-80px" }}
              transition={variant.transition}
            >
              <span className="how-to-play-step-n">{step.n}</span>
              <div className="how-to-play-step-copy">
                <h2>{step.title}</h2>
                <p>{step.body}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      <section className="how-to-play-math">
        <motion.div
          className="how-to-play-math-intro"
          initial={{ opacity: 0, transform: prefersReducedMotion ? "translateY(0px)" : "translateY(16px)" }}
          whileInView={{ opacity: 1, transform: "translateY(0px)" }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        >
          <div className="how-to-play-eyebrow">
            <span className="how-to-play-eyebrow-dot" />
            The actual math
          </div>
          <h2 className="how-to-play-math-h2">How the numbers work</h2>
          <p>
            Two separate systems, not one. Here's exactly what each does, no hand-waving. Hover (or tap) any bolded
            variable in a formula for what it means.
          </p>
        </motion.div>

        <div className="how-to-play-math-group">
          <h3>Suggested value, live</h3>
          <p>
            The chip that appears while a player's up for bid comes from a real scikit-learn model, not a hand-tuned
            guess. It's trained on actual winning bids from completed multiplayer drafts (solo drafts are excluded,
            since every solo pick lands at a flat 1 coin, which isn't a real market price to learn from).
          </p>
          <EquationCard index={0} label="Inputs it looks at" lines={PRICE_FEATURES} />
          <EquationCard index={1} label="True Shooting %, one of those inputs" lines={[TS_FORMULA]} />
          <p className="how-to-play-math-detail">
            Most nominations sell for the 1-coin minimum with a long tail of stars going for much more, so the model
            trains on <code>log(price)</code> and converts back, which is standard practice for a skewed target like
            this. Three candidate models (a linear model, a random forest, gradient boosting) get cross-validated
            against each other, and whichever predicts held-out picks best is the one that actually ships.
            Predictions are clamped to 0&ndash;20 coins, since nothing can cost more than the budget allows.
          </p>
          <p className="how-to-play-math-detail">
            The "mainly based on" breakdown under the chip isn't a per-player explanation. That's a heavier technique
            called SHAP this app doesn't run. It's the model's overall feature rankings paired with this player's
            real numbers: an honest summary, not false precision. And it's still trained on a relatively small,
            mostly self-generated sample of real drafts, so it sharpens as more real drafts get played.
          </p>
        </div>

        <div className="how-to-play-math-group">
          <h3>Final team score, after the draft</h3>
          <p>
            Once every roster is full, each of your five starters is scored from their real career per-game stats.
            No model here, just a fixed formula, the same for every player and every draft.
          </p>
          <EquationCard index={2} label="Offense" lines={["Op = (PTS × TS%) + (AST × 1.5) − (TOV × 2.0)"]} />
          <EquationCard
            index={3}
            label="Defensive impact"
            lines={[
              "DIR = (STL × 2.5) + (BLK × 2.0) + (REB × 0.3)",
              "  or, pre-1973-74 (steals/blocks untracked):",
              "DIR = (season Defensive Win Shares ÷ games played) × 100",
            ]}
          />
          <EquationCard
            index={4}
            label="Position penalty (per player)"
            lines={["Pen = 3.0  if the player's real position doesn't match their roster slot", "Pen = 0    if it does, or if either is unknown"]}
            note={`Flat, not scaled to the player's stats: playing a real Center at PG costs the same 3.0 as playing a Guard at C. For context, that's the same ${OLAJUWON_AT_PG_PENALTY.toFixed(1)} points Hakeem Olajuwon (a real Center) would lose if he'd been slotted at PG instead of C below.`}
          />
          <EquationCard
            index={5}
            label="Synergy multiplier (team-wide)"
            lines={["×1.10  if the 5 starters' combined Usage% ≤ 105", "×1.00  if 105 < combined Usage% ≤ 125", "×0.85  if combined Usage% > 125"]}
            note="Rewards a roster that shares the ball; penalizes five players who all need it."
          />
          <EquationCard
            index={6}
            label="Final team score"
            lines={["Final Score = Σ(Op + DIR − Pen across all 5 starters) × Synergy multiplier"]}
          />
          <p className="how-to-play-math-detail">
            Head-to-head odds on the results screen run the score gap through a logistic curve, not a coin flip. A
            bigger gap means more lopsided odds, and a close gap stays close to 50/50.
          </p>
        </div>

        <div className="how-to-play-math-group how-to-play-showcase">
          <h3>See it with a real team</h3>
          <p>
            Five real Hall of Famers, one at every slot, with their actual career per-game numbers. Same formulas as
            above, run for real instead of with letters. Each one is shown in their real position here, so the
            position penalty comes out to 0 for all five below (see the Olajuwon-at-PG example above for what it
            looks like when it doesn't).
          </p>
          <div className="how-to-play-showcase-grid">
            {SHOWCASE_SCORED.map((player, i) => (
              <ShowcasePlayerCard key={player.name} player={player} index={i} />
            ))}
          </div>
          <motion.div
            className="how-to-play-showcase-summary"
            initial={{ opacity: 0, transform: "translateY(20px)" }}
            whileInView={{ opacity: 1, transform: "translateY(0px)" }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.3 }}
          >
            <div className="how-to-play-showcase-summary-row">
              <span>Position penalties</span>
              <CountUpStat value={SHOWCASE_SUM_PENALTY} />
            </div>
            <div className="how-to-play-showcase-summary-row">
              <span>Sum(Op + DIR &minus; Pen)</span>
              <CountUpStat value={SHOWCASE_SUM_TOTAL} />
            </div>
            <div className="how-to-play-showcase-summary-row">
              <span>Combined Usage%</span>
              <CountUpStat value={SHOWCASE_SUM_USAGE} suffix="%" />
            </div>
            <div className="how-to-play-showcase-summary-row">
              <span>Synergy multiplier</span>
              <span>&times;{SHOWCASE_MS.toFixed(2)}</span>
            </div>
            <div className="how-to-play-showcase-summary-row final">
              <span>Final Score</span>
              <CountUpStat value={SHOWCASE_FINAL} />
            </div>
          </motion.div>
        </div>
      </section>

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
