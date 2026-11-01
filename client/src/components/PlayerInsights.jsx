import { useEffect, useState } from "react";
import { motion } from "motion/react";
import PlayerNameLink from "./PlayerNameLink.jsx";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

/** Two ML-backed hints shown alongside a fresh nomination: a predicted
 * auction price (server/src/services/statsClient.js -> stats-service's
 * /predict-price, trained on real completed-draft history) and a handful of
 * statistically similar players (/similar-players, a k-NN over standardized
 * per-game stats). Both are best-effort: either can come back empty (model
 * not trained yet, player has no cached stats, stats-service unreachable)
 * and this just renders nothing for that half rather than an error state,
 * matching how every other stats-dependent panel in this app degrades. */
export default function PlayerInsights({
  nbaPlayerId,
  era,
  difficulty,
  onPredictedPrice,
  onSimilarPlayerClick,
  showSimilar = true,
  showStatus = false,
  showBreakdown = false,
  seasonPlayer = null,
}) {
  const [predictedPrice, setPredictedPrice] = useState(null);
  const [explanation, setExplanation] = useState([]);
  const [similar, setSimilar] = useState([]);
  const [priceStatus, setPriceStatus] = useState("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setPredictedPrice(null);
    setExplanation([]);
    setSimilar([]);
    setPriceStatus("loading");
    if (seasonPlayer) return undefined;
    if (!nbaPlayerId) return undefined;

    let cancelled = false;
    const params = new URLSearchParams();
    if (era) params.set("era", era);
    if (difficulty) params.set("difficulty", difficulty);

    fetch(`${SERVER_URL}/api/players/${nbaPlayerId}/predicted-price?${params}`)
      .then((res) => { if (!res.ok) throw new Error("Prediction unavailable"); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        if (Number.isFinite(data.predictedPrice)) {
          setPredictedPrice(data.predictedPrice);
          setPriceStatus("ready");
          // Only for callers that want to track a value across context
          // changes (the Market tab's era switcher) -- most callers (the
          // live nomination card) have no use for it.
          onPredictedPrice?.(data.predictedPrice);
        } else setPriceStatus("unavailable");
        if (Array.isArray(data.explanation)) setExplanation(data.explanation);
      })
      .catch(() => { if (!cancelled) setPriceStatus("unavailable"); });

    // Skipped entirely (not just hidden) when the caller doesn't want it
    // rendered -- one fewer request for a card that's never going to show
    // the result anyway (see DraftBoard.jsx's showSimilar={false}).
    if (showSimilar) {
      fetch(`${SERVER_URL}/api/players/${nbaPlayerId}/similar?k=5`)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled && Array.isArray(data.similar)) setSimilar(data.similar);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [nbaPlayerId, era, difficulty, showSimilar, seasonPlayer, retry]);

  if (seasonPlayer) return <div className="player-insights">
    <p className="predicted-price"><span className="predicted-price-label">{seasonPlayer.stats.season} suggested value</span><span className="predicted-price-value">~{seasonPlayer.suggestedPrice.toFixed(1)} coins</span></p>
    <p className="hint-text">Based only on this season’s stats and scoring. You set the bid.</p>
  </div>;
  if (!showStatus && predictedPrice === null && similar.length === 0) return null;

  return (
    <motion.div
      className="player-insights"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {showStatus && predictedPrice === null && <div className="prediction-status" role="status">
        <p className="hint-text">{priceStatus === "loading" ? "Calculating suggested value…" : "Suggested value is unavailable right now."}</p>
        {priceStatus === "unavailable" && <button type="button" className="secondary-btn" onClick={() => setRetry((count) => count + 1)}>Retry prediction</button>}
      </div>}
      {predictedPrice !== null && (
        // tabIndex makes the hover breakdown reachable by keyboard too
        // (:focus-within in CSS). cursor:help alone only signals mouse
        // users that there's more here.
        <p className="predicted-price" tabIndex={0}>
          <span className="predicted-price-label">Suggested value</span>
          <span className="predicted-price-value">~{predictedPrice.toFixed(1)} coins</span>
          {explanation.length > 0 && !showBreakdown && (
            <span className="predicted-price-tooltip" role="tooltip">
              <span className="predicted-price-tooltip-title">Mainly based on</span>
              {explanation.map((item) => (
                <span className="predicted-price-tooltip-row" key={item.label}>
                  <span className="predicted-price-tooltip-label">{item.label}</span>
                  <span className="predicted-price-tooltip-value">{item.value}</span>
                </span>
              ))}
              <span className="predicted-price-tooltip-footer">
                From real past-draft prices. A rough guide, not a rule.
              </span>
            </span>
          )}
        </p>
      )}
      {showBreakdown && predictedPrice !== null && <div className="market-model-breakdown">
        <h3>How the model estimates value</h3>
        {explanation.length ? <dl>{explanation.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : <p className="hint-text">A breakdown is not available for this estimate.</p>}
        <p className="hint-text">Estimated from completed draft prices and career stats. Your bid decides the sale.</p>
      </div>}
      {similar.length > 0 && (
        <div className="similar-players">
          <span className="similar-players-label">Similar players</span>
          <div className="similar-players-list">
            {similar.map((p, i) => (
              <span key={p.id} className="similar-player-chip">
                {onSimilarPlayerClick ? (
                  // In-app navigation takes priority over the NBA.com link
                  // in contexts that offer it (the Market tab). Jumping to
                  // that player's own card is more useful there than
                  // leaving the app.
                  <button type="button" className="similar-player-link" onClick={() => onSimilarPlayerClick(p.id)}>
                    {p.fullName}
                  </button>
                ) : (
                  <PlayerNameLink nbaPlayerId={p.id} name={p.fullName} />
                )}
                {i < similar.length - 1 && <span className="similar-player-sep">·</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
