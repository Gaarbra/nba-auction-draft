import { useEffect, useRef, useState } from "react";
import InfoModal from "./InfoModal.jsx";
import { PAGES } from "../siteContent.jsx";

/** The screen shown before anyone creates or joins a room -- a scrollable,
 * Stitch-inspired multi-section pitch, but every claim in it is checked
 * against the real server logic rather than invented:
 *   - STARTING_BUDGET (20) and MAX_PLAYERS (4): server/src/rooms/roomStore.js
 *   - no bid timer exists -- bidding stays open until everyone but the high
 *     bidder passes (server/src/sockets/roomHandlers.js)
 *   - the synergy multiplier thresholds (<=105% / <=125% / above) and their
 *     0.85x/1.0x/1.1x values: server/src/scoring/scoring.js
 * No stock/AI background photography either -- see the comment on
 * .landing-hero-glow in index.css for why. */

const SECTIONS = ["hero", "budget", "bidding", "roster", "scoring", "modes"];

function ScrollDots({ active, onJump }) {
  return (
    <div className="landing-dots" aria-hidden="true">
      {SECTIONS.map((id, i) => (
        <button
          key={id}
          type="button"
          className={`landing-dot ${i === active ? "active" : ""}`}
          onClick={() => onJump(i)}
          tabIndex={-1}
        />
      ))}
    </div>
  );
}

export default function LandingPage({ onEnter }) {
  const [showHelp, setShowHelp] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const sectionRefs = useRef([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(Number(entry.target.dataset.index));
          }
        }
      },
      { threshold: 0.5 }
    );
    sectionRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  function jumpTo(index) {
    sectionRefs.current[index]?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="landing">
      <ScrollDots active={activeSection} onJump={jumpTo} />

      <section
        ref={(el) => (sectionRefs.current[0] = el)}
        data-index="0"
        className="landing-section landing-hero"
      >
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

        <button type="button" className="landing-scroll-hint" onClick={() => jumpTo(1)}>
          <span>See how it works</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </section>

      <section
        ref={(el) => (sectionRefs.current[1] = el)}
        data-index="1"
        className="landing-section landing-feature"
      >
        <div className="landing-feature-copy">
          <span className="landing-kicker">01 · Core mechanic</span>
          <h2 className="landing-h2">20 coins. Countless ways to spend them.</h2>
          <p className="landing-body">
            Every manager gets the same 20-coin budget. Strict roster rules mean every coin spent on one slot is a
            coin you can't spend on the next — load up on one star, or build balanced depth across all five.
          </p>
          <ul className="landing-list">
            <li>
              <strong>Nominate at 1 coin.</strong> Every player enters the auction with a 1-coin opening bid.
            </li>
            <li>
              <strong>Hard cap protection.</strong> The app warns you before a pick would leave less than 1 coin per
              remaining open slot.
            </li>
          </ul>
        </div>
        <div className="landing-preview">
          <div className="landing-preview-card">
            <span className="landing-preview-label">Example roster budget</span>
            <div className="landing-preview-meter">
              <span className="coin-meter-icon" aria-hidden="true">
                🪙
              </span>
              <div className="coin-meter-track">
                <div className="coin-meter-fill" style={{ width: "35%" }} />
              </div>
              <span className="landing-preview-count">7</span>
            </div>
            <span className="landing-preview-hint">7 of 20 coins left, 2 open slots</span>
          </div>
        </div>
      </section>

      <section
        ref={(el) => (sectionRefs.current[2] = el)}
        data-index="2"
        className="landing-section landing-feature landing-feature-reverse"
      >
        <div className="landing-feature-copy">
          <span className="landing-kicker">02 · Real-time tension</span>
          <h2 className="landing-h2">Live, open bidding.</h2>
          <p className="landing-body">
            There's no countdown to beat — bidding on a player stays open until everyone but the high bidder passes.
            Raise by any amount above the current bid, or use the quick-bid buttons when you don't want to type.
          </p>
          <ul className="landing-list">
            <li>
              <strong>Instant sync.</strong> Every bid appears live for the whole room over a real-time connection.
            </li>
            <li>
              <strong>+5 and Max buttons</strong> for fast decisions under pressure.
            </li>
            <li>
              <strong>No fixed timer.</strong> The auction ends when the room decides it's over, not the clock.
            </li>
          </ul>
        </div>
        <div className="landing-preview">
          <div className="landing-preview-card">
            <span className="landing-preview-label">Example nomination</span>
            <p className="landing-preview-bid">
              Current bid: <strong>6 coins</strong> by Alice
            </p>
            <div className="bid-stepper-group landing-preview-stepper">
              <div className="bid-stepper">
                <span className="bid-stepper-btn">−</span>
                <span className="bid-stepper-input">7</span>
                <span className="bid-stepper-btn">+</span>
              </div>
              <div className="bid-quick-jumps">
                <span className="bid-quick-jump-btn">+5</span>
                <span className="bid-quick-jump-btn">Max</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        ref={(el) => (sectionRefs.current[3] = el)}
        data-index="3"
        className="landing-section landing-feature"
      >
        <div className="landing-feature-copy">
          <span className="landing-kicker">03 · Roster construction</span>
          <h2 className="landing-h2">Assign your five-man roster.</h2>
          <p className="landing-body">
            Winning a bid is only half the job. Every player has to land on an eligible court position —
            <strong> PG, SG, SF, PF, C</strong> — and once you win, you assign them by tapping the open slot in your
            own roster.
          </p>
        </div>
        <div className="landing-preview">
          <div className="landing-preview-card">
            <span className="landing-preview-label">Example roster</span>
            <div className="landing-preview-slots">
              {["PG", "SG", "SF", "PF", "C"].map((pos, i) => (
                <div key={pos} className={`landing-preview-slot ${i < 2 ? "filled" : ""} ${i === 2 ? "open" : ""}`}>
                  {pos}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        ref={(el) => (sectionRefs.current[4] = el)}
        data-index="4"
        className="landing-section landing-feature landing-feature-reverse"
      >
        <div className="landing-feature-copy">
          <span className="landing-kicker">04 · Advanced scoring</span>
          <h2 className="landing-h2">Real stats decide the winner.</h2>
          <p className="landing-body">
            Once every roster is full, Hoop Bids scores each team from real career per-game stats — no arbitrary
            point totals. Roster balance matters as much as star power: your team's combined usage rate sets a
            synergy multiplier on your final score.
          </p>
        </div>
        <div className="landing-preview">
          <div className="landing-preview-card landing-preview-formula">
            <span className="landing-preview-label">Synergy multiplier</span>
            <div className="landing-formula-row">
              <span>Combined usage ≤ 105%</span>
              <span className="landing-formula-value good">1.1×</span>
            </div>
            <div className="landing-formula-row">
              <span>Combined usage ≤ 125%</span>
              <span className="landing-formula-value">1.0×</span>
            </div>
            <div className="landing-formula-row">
              <span>Combined usage &gt; 125%</span>
              <span className="landing-formula-value bad">0.85×</span>
            </div>
          </div>
        </div>
      </section>

      <section
        ref={(el) => (sectionRefs.current[5] = el)}
        data-index="5"
        className="landing-section landing-finale"
      >
        <div className="landing-hero-glow" aria-hidden="true" />
        <span className="landing-badge">Online or on the couch</span>
        <h2 className="landing-title landing-title-sm">Play your way.</h2>
        <div className="landing-modes">
          <div className="landing-mode-card">
            <h3>Online rooms</h3>
            <p>Share a room code with friends and draft together live, from anywhere.</p>
          </div>
          <div className="landing-mode-card">
            <h3>Local pass-and-play</h3>
            <p>No accounts, no downloads — pass one device around the room and draft together on the couch.</p>
          </div>
        </div>
        <div className="landing-ctas">
          <button type="button" className="primary-btn landing-cta-primary" onClick={onEnter}>
            Start a Draft
          </button>
        </div>
      </section>

      {showHelp && (
        <InfoModal title={PAGES.howToPlay.title} body={PAGES.howToPlay.body} onClose={() => setShowHelp(false)} />
      )}
    </div>
  );
}
