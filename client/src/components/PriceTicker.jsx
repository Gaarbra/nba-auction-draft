import { useEffect, useMemo, useState } from "react";
import PlayerHeadshot from "./PlayerHeadshot.jsx";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const LANES = 6; // columns of drifting cards, split across both sides of the lobby card
const CARDS_PER_LANE = 3;

// A little PRNG seeded per-mount so each card's timing/price is stable for
// the life of the page (no re-shuffling every re-render) without needing to
// stash random values in state.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The homepage background from the sketch: real player headshots drifting
 * slowly upward with a "$price" tag, looping endlessly, new ones entering
 * from the bottom as old ones exit the top — like a stock ticker for the
 * draft pool. Purely decorative (prices are randomized, not real
 * predictions — hitting the ML endpoint for a couple dozen background cards
 * on every homepage load isn't worth the extra server load for something
 * nobody's meant to read as accurate). Pure CSS animation, not a rAF loop —
 * much cheaper than the physics approach an earlier version of this
 * background used. */
export default function PriceTicker({ active }) {
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    if (!active) return;
    fetch(`${SERVER_URL}/api/players?era=active&limit=${LANES * CARDS_PER_LANE}`)
      .then((res) => res.json())
      .then((data) => setPlayers(data.players || []))
      .catch(() => setPlayers([]));
  }, [active]);

  const cards = useMemo(() => {
    if (players.length === 0) return [];
    const rand = mulberry32(20260901);
    const items = [];
    for (let lane = 0; lane < LANES; lane += 1) {
      for (let slot = 0; slot < CARDS_PER_LANE; slot += 1) {
        const player = players[(lane * CARDS_PER_LANE + slot) % players.length];
        if (!player) continue;
        items.push({
          key: `${lane}-${slot}`,
          lane,
          id: player.id,
          fullName: player.fullName,
          price: 1 + Math.floor(rand() * 19),
          duration: 22 + rand() * 14, // seconds for one full bottom-to-top loop
          delay: -rand() * 30, // negative delay = starts mid-cycle, not all synced at "bottom"
        });
      }
    }
    return items;
  }, [players]);

  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!active || prefersReducedMotion || cards.length === 0) return null;

  const half = LANES / 2;
  const renderLane = (lane) => (
    <div className="price-ticker-lane" key={lane}>
      {cards
        .filter((c) => c.lane === lane)
        .map((c) => (
          <div
            key={c.key}
            className="price-ticker-card"
            style={{ animationDuration: `${c.duration}s`, animationDelay: `${c.delay}s` }}
          >
            <PlayerHeadshot nbaPlayerId={c.id} alt={c.fullName} className="price-ticker-photo" allowRetry={false} />
            <span className="price-ticker-price">${c.price}</span>
          </div>
        ))}
    </div>
  );

  return (
    <div className="price-ticker" aria-hidden="true">
      {/* Two groups pushed to opposite edges (space-between), leaving the
          center clear for the lobby card — matches the sketch. */}
      <div className="price-ticker-side">{Array.from({ length: half }, (_, i) => renderLane(i))}</div>
      <div className="price-ticker-side">{Array.from({ length: half }, (_, i) => renderLane(half + i))}</div>
    </div>
  );
}
