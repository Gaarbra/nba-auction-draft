import RoomLobby from "./RoomLobby.jsx";
import MarketTicker from "./MarketTicker.jsx";

/** The front door: hero + the actual room-creation console on one screen,
 * replacing the old multi-section scrolling pitch (LandingPage.jsx) that
 * used to sit in front of RoomLobby as a separate step. That page's
 * explainer content (how bidding works, how scoring works, and so on)
 * already lives in the How to Play modal (see siteContent.jsx) -- this
 * isn't losing that content, just not repeating it as a second, longer
 * version before the part someone's actually here to do. RoomLobby itself
 * is untouched functionally; it just picks up the "lobby-console" class
 * here so its styling can live scoped under .landing-lobby without
 * touching how it looks in the one other place a bare .lobby-card still
 * renders (App.jsx's reconnecting screen). */
export default function Landing({ onCreateRoom, onJoinRoom, onCreateLocalRoom, onListPublicRooms, connected, error, isSubmitting }) {
  return (
    <div className="landing-lobby">
      <div className="landing-lobby-main">
        <div className="landing-lobby-hero">
          <div className="landing-lobby-eyebrow">
            <span className="landing-lobby-eyebrow-dot" />
            Live bidding, real NBA stats
          </div>
          <h1 className="landing-lobby-title">Draft the greatest team basketball has ever seen.</h1>
          <p className="landing-lobby-subtitle">
            Bid on real NBA players from any era with friends, live. Every gauge on this dashboard reads the truth,
            no fantasy stats, no made-up prices.
          </p>

          <div className="landing-lobby-stats">
            <div className="landing-lobby-stat">
              <span className="landing-lobby-stat-value">5,200+</span>
              <span className="landing-lobby-stat-label">players, every era</span>
            </div>
            <div className="landing-lobby-stat">
              <span className="landing-lobby-stat-value">20c</span>
              <span className="landing-lobby-stat-label">starting budget</span>
            </div>
            <div className="landing-lobby-stat">
              <span className="landing-lobby-stat-value">1-4</span>
              <span className="landing-lobby-stat-label">players per room</span>
            </div>
          </div>
        </div>

        <RoomLobby
          onCreateRoom={onCreateRoom}
          onJoinRoom={onJoinRoom}
          onCreateLocalRoom={onCreateLocalRoom}
          onListPublicRooms={onListPublicRooms}
          connected={connected}
          error={error}
          isSubmitting={isSubmitting}
        />
      </div>

      <MarketTicker />
    </div>
  );
}
