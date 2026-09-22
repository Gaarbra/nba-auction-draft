import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

/** Real career accolades (MVP, All-Star, championships, ...), grouped and
 * tier-sorted server-side (see stats-service/app.py's _fetch_and_cache_awards
 * and its AWARD_TIERS map -- that's the single source of truth for both the
 * sort order and which tier each award belongs to, so this component only
 * has to turn a tier string into a color). Best-effort like PlayerInsights:
 * an empty or failed lookup just renders nothing, not an error state. */
export default function PlayerAccolades({ nbaPlayerId }) {
  const [awards, setAwards] = useState([]);
  const dialogRef = useRef(null);

  useEffect(() => {
    setAwards([]);
    if (!nbaPlayerId) return undefined;

    let cancelled = false;
    fetch(`${SERVER_URL}/api/players/${nbaPlayerId}/awards`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.awards)) setAwards(data.awards);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [nbaPlayerId]);

  if (awards.length === 0) return null;

  return (
    <>
      <div className="player-accolades">
        {awards.map((award, i) => (
          <motion.span
            key={award.label}
            className={`accolade-chip accolade-${award.tier}`}
            initial={{ opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.3, delay: Math.min(i, 6) * 0.04 }}
          >
            {award.count > 1 ? `${award.count}× ${award.label}` : award.label}
          </motion.span>
        ))}
      </div>

      <button type="button" className="accolade-mobile-trigger" onClick={() => dialogRef.current?.showModal()}>
        View awards <span>{awards.length}</span>
      </button>
      <dialog
        ref={dialogRef}
        className="accolade-dialog"
        aria-labelledby="accolade-dialog-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="accolade-dialog-panel">
          <div className="accolade-dialog-header">
            <h2 id="accolade-dialog-title">Career awards</h2>
            <button type="button" className="accolade-dialog-close" onClick={() => dialogRef.current?.close()} aria-label="Close awards">
              Close
            </button>
          </div>
          <div className="accolade-dialog-list">
            {awards.map((award) => (
              <div className={`accolade-dialog-row accolade-${award.tier}`} key={award.label}>
                <span>{award.label}</span>
                <strong>{award.count}×</strong>
              </div>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
