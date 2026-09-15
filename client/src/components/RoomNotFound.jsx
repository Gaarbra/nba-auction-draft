import { motion } from "motion/react";
import LogoMark from "./LogoMark.jsx";

/** Shown in place of the lobby when someone arrives via a shared invite
 * link (?room=CODE) and that specific room turns out to be a dead end:
 * already started, already full, or just gone. This app has no
 * client-side router (every URL renders the same single-page app, see
 * render.yaml's SPA rewrite), so there's no "unknown route" to 404 on --
 * a broken invite link is the one real "you tried to go somewhere that
 * doesn't exist" moment it actually has, and this is the dedicated page
 * for it, instead of just the small inline error text a mistyped room
 * code gets in RoomLobby. */
export default function RoomNotFound({ code, reason, onBackToLobby }) {
  return (
    <motion.div
      className="lobby-card room-not-found"
      initial={{ opacity: 0, transform: "translateY(12px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="lobby-brand">
        <LogoMark className="lobby-brand-logo" />
        <span>Hoop Bids</span>
      </div>
      <div className="room-not-found-code" aria-hidden="true">
        {code || "?????"}
      </div>
      <h1>Room not found</h1>
      <p className="hint-text room-not-found-reason">{reason}</p>
      <button type="button" className="primary-btn" onClick={onBackToLobby}>
        Back to lobby
      </button>
    </motion.div>
  );
}
