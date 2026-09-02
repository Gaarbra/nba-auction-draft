import { useState } from "react";
import { motion } from "motion/react";
import BidStepper from "./BidStepper.jsx";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

/** Local pass-and-play's bidding UI: instead of requiring whoever's holding
 * the device to first "become" a player before they can act (the old
 * LocalPlayerSwitcher), every local player who could currently raise or
 * pass gets their own inline row, all visible at once. Whoever's turn it
 * actually is (in orderly mode) or whoever wants to act (in open mode) just
 * uses their own row directly — nothing to switch first. */
export default function LocalBiddingRows({ room, nomination, socket, friendlyError }) {
  const [amounts, setAmounts] = useState({});
  const [errors, setErrors] = useState({});

  const eligible = room.players.filter((p) => {
    if (p.id === nomination.currentBidder) return false;
    if (nomination.passed.includes(p.id)) return false;
    const roster = room.draft?.rosters?.[p.id] || {};
    const hasOpenSlot = POSITIONS.some((pos) => !roster[pos]);
    if (!hasOpenSlot) return false;
    if (room.biddingMode === "orderly" && nomination.currentBidTurnId !== p.id) return false;
    return true;
  });

  function currentAmount(playerId) {
    return amounts[playerId] ?? String(nomination.currentBid + 1);
  }

  function setAmount(playerId, next) {
    setAmounts((prev) => ({
      ...prev,
      [playerId]: typeof next === "function" ? next(prev[playerId] ?? String(nomination.currentBid + 1)) : next,
    }));
  }

  function bid(playerId) {
    setErrors((prev) => ({ ...prev, [playerId]: "" }));
    const amount = Number(currentAmount(playerId));
    socket.emit("draft:bid", { amount, playerId }, (res) => {
      if (res?.error) setErrors((prev) => ({ ...prev, [playerId]: friendlyError(res.error) }));
      else setAmounts((prev) => ({ ...prev, [playerId]: undefined }));
    });
  }

  function pass(playerId) {
    setErrors((prev) => ({ ...prev, [playerId]: "" }));
    socket.emit("draft:pass", { playerId }, (res) => {
      if (res?.error) setErrors((prev) => ({ ...prev, [playerId]: friendlyError(res.error) }));
    });
  }

  if (eligible.length === 0) {
    return <p className="hint-text">Waiting on a decision…</p>;
  }

  return (
    <div className="local-bid-rows">
      {eligible.map((p) => (
        <form
          key={p.id}
          className="local-bid-row"
          onSubmit={(e) => {
            e.preventDefault();
            bid(p.id);
          }}
        >
          <span className="local-bid-row-name">{p.name}</span>
          <BidStepper
            value={currentAmount(p.id)}
            min={nomination.currentBid + 1}
            max={p.budget}
            onChange={(next) => setAmount(p.id, next)}
          />
          <motion.button
            type="submit"
            className="primary-btn"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
          >
            Raise
          </motion.button>
          <motion.button
            type="button"
            className="secondary-btn"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => pass(p.id)}
          >
            Pass
          </motion.button>
          {errors[p.id] && <span className="error-text local-bid-row-error">{errors[p.id]}</span>}
        </form>
      ))}
    </div>
  );
}
