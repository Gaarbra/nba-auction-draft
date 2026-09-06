import { useState } from "react";
import InfoModal from "./InfoModal.jsx";
import { PAGES } from "../siteContent.jsx";

/** The screen shown before anyone creates or joins a room — a short, honest
 * pitch for what Hoop Bids actually does, not a marketing page dressed up
 * with invented numbers. Every figure here is a real constant from the
 * server (server/src/rooms/roomStore.js): STARTING_BUDGET (20) and
 * MAX_PLAYERS (4). There's no bid timer in this game — bidding stays open
 * until everyone but the high bidder passes — so this page doesn't claim
 * one either. */

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Create or join a room",
    body: "Start a room and share the code, or play pass-and-play on one device with 2-4 people.",
  },
  {
    step: "02",
    title: "Nominate and bid",
    body: "Each turn, someone nominates a random player from any NBA era. Everyone else bids coins to win them.",
  },
  {
    step: "03",
    title: "Build a full roster",
    body: "Fill all 5 slots — PG, SG, SF, PF, C — then the room gets scored and ranked from real career stats.",
  },
];

export default function LandingPage({ onEnter }) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero-glow" aria-hidden="true" />
        <span className="landing-badge">Real-time NBA auction draft</span>
        <h1 className="landing-title">The Coin Draft.</h1>
        <p className="landing-subtitle">
          Everyone starts with 20 coins and 5 roster slots to fill. Nominate players, bid against your friends, and
          build the best team before the room runs out of picks.
        </p>

        <div className="landing-facts">
          <span className="landing-fact">20 coin budget</span>
          <span className="landing-fact">PG · SG · SF · PF · C</span>
          <span className="landing-fact">Any era, ~5,200 players</span>
        </div>

        <div className="landing-ctas">
          <button type="button" className="primary-btn landing-cta-primary" onClick={onEnter}>
            Start a Draft
          </button>
          <button type="button" className="secondary-btn landing-cta-secondary" onClick={() => setShowHelp(true)}>
            How to Play
          </button>
        </div>
      </section>

      <section className="landing-steps">
        {HOW_IT_WORKS.map((item) => (
          <div key={item.step} className="landing-step">
            <span className="landing-step-number">{item.step}</span>
            <h3 className="landing-step-title">{item.title}</h3>
            <p className="landing-step-body">{item.body}</p>
          </div>
        ))}
      </section>

      {showHelp && (
        <InfoModal title={PAGES.howToPlay.title} body={PAGES.howToPlay.body} onClose={() => setShowHelp(false)} />
      )}
    </div>
  );
}
