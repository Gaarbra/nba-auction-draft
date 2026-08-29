import { useEffect, useState } from "react";
import { motion } from "motion/react";
import PlayerNameLink from "./PlayerNameLink.jsx";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

/** Two ML-backed hints shown alongside a fresh nomination: a predicted
 * auction price (server/src/services/statsClient.js -> stats-service's
 * /predict-price, trained on real completed-draft history) and a handful of
 * statistically similar players (/similar-players, a k-NN over standardized
 * per-game stats). Both are best-effort — either can come back empty (model
 * not trained yet, player has no cached stats, stats-service unreachable)
 * and this just renders nothing for that half rather than an error state,
 * matching how every other stats-dependent panel in this app degrades. */
export default function PlayerInsights({ nbaPlayerId, era, difficulty }) {
  const [predictedPrice, setPredictedPrice] = useState(null);
  const [similar, setSimilar] = useState([]);

  useEffect(() => {
    setPredictedPrice(null);
    setSimilar([]);
    if (!nbaPlayerId) return undefined;

    let cancelled = false;
    const params = new URLSearchParams();
    if (era) params.set("era", era);
    if (difficulty) params.set("difficulty", difficulty);

    fetch(`${SERVER_URL}/api/players/${nbaPlayerId}/predicted-price?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data.predictedPrice === "number") setPredictedPrice(data.predictedPrice);
      })
      .catch(() => {});

    fetch(`${SERVER_URL}/api/players/${nbaPlayerId}/similar?k=5`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.similar)) setSimilar(data.similar);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [nbaPlayerId, era, difficulty]);

  if (predictedPrice === null && similar.length === 0) return null;

  return (
    <motion.div
      className="player-insights"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {predictedPrice !== null && (
        <p className="predicted-price" title="Predicted from real past-draft prices — a rough guide, not a rule.">
          <span className="predicted-price-label">Suggested value</span>
          <span className="predicted-price-value">~{predictedPrice.toFixed(1)} coins</span>
        </p>
      )}
      {similar.length > 0 && (
        <div className="similar-players">
          <span className="similar-players-label">Similar players</span>
          <div className="similar-players-list">
            {similar.map((p, i) => (
              <span key={p.id} className="similar-player-chip">
                <PlayerNameLink nbaPlayerId={p.id} name={p.fullName} />
                {i < similar.length - 1 && <span className="similar-player-sep">·</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
