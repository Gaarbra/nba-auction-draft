import { useState } from "react";
import InfoModal from "./InfoModal.jsx";
import LogoMark from "./LogoMark.jsx";
import { PAGES } from "../siteContent.jsx";
import { isSoundMuted, setSoundMuted } from "../rollSound.js";

/* The persistent app-shell header. Two variants:
   - "lobby": wordmark + section tabs (Market/Roster/Stats are visual-only
     stubs — the app is a single-sitting draft, there are no such pages) +
     notification/wallet glyphs.
   - "room": wordmark + room code/difficulty + live turn/coins status +
     sound, help, leave, and a connection dot. */

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SoundIcon({ muted }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {muted ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" strokeLinecap="round" />
          <line x1="17" y1="9" x2="23" y2="15" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" strokeLinecap="round" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" />
    </svg>
  );
}

const LOBBY_TABS = ["Lobby", "Market", "Roster", "Stats"];

export default function TopNav({
  variant = "lobby",
  connected = false,
  roomLabel,
  roomCode,
  difficulty,
  biddingMode,
  isLocal = false,
  onClockName = null,
  coins = null,
  onLeaveRoom,
}) {
  const [showHelp, setShowHelp] = useState(false);
  const [soundMuted, setSoundMutedState] = useState(() => isSoundMuted());

  function toggleSound() {
    const next = !soundMuted;
    setSoundMutedState(next);
    setSoundMuted(next);
  }

  return (
    <header className={`topnav topnav-${variant}`}>
      <div className="topnav-inner">
        <div className="topnav-left">
          <span className="topnav-brand">
            <LogoMark className="topnav-logo" />
            <span className="topnav-wordmark">Hoop Bids</span>
          </span>

          {variant === "room" && (
            <div className="topnav-roommeta">
              <span className="topnav-roommeta-label">{isLocal ? "" : "Room"}</span>
              <span className="topnav-roommeta-code">{isLocal ? roomLabel || "Local Game" : roomCode}</span>
              {difficulty && <span className="topnav-pill">{difficulty}</span>}
              {biddingMode === "orderly" && <span className="topnav-pill">Orderly</span>}
            </div>
          )}
        </div>

        {variant === "lobby" && (
          <nav className="topnav-tabs">
            {LOBBY_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                className={`topnav-tab ${tab === "Lobby" ? "active" : ""}`}
                aria-current={tab === "Lobby" ? "page" : undefined}
                disabled={tab !== "Lobby"}
              >
                {tab}
              </button>
            ))}
          </nav>
        )}

        <div className="topnav-right">
          {variant === "lobby" && (
            <>
              <button type="button" className="topnav-icon-btn" aria-label="Notifications" disabled>
                <BellIcon />
              </button>
              <button type="button" className="topnav-icon-btn" aria-label="Wallet" disabled>
                <WalletIcon />
              </button>
            </>
          )}

          {variant === "room" && (
            <>
              {onClockName && (
                <div className="topnav-clock">
                  <span className="topnav-clock-dot" aria-hidden="true" />
                  <span className="topnav-clock-label">On the clock:</span>
                  <span className="topnav-clock-name">{onClockName}</span>
                </div>
              )}

              {coins != null && (
                <div className="topnav-coins" title="Coins remaining">
                  <span className="topnav-coins-icon" aria-hidden="true">
                    ¢
                  </span>
                  <span className="topnav-coins-value">{coins}</span>
                  <span className="topnav-coins-unit">coins</span>
                </div>
              )}

              <button
                type="button"
                onClick={toggleSound}
                className="topnav-icon-btn"
                title={soundMuted ? "Unmute roll sound" : "Mute roll sound"}
                aria-label={soundMuted ? "Unmute roll sound" : "Mute roll sound"}
              >
                <SoundIcon muted={soundMuted} />
              </button>
              <button
                type="button"
                onClick={() => setShowHelp(true)}
                className="topnav-icon-btn"
                title="How to play"
                aria-label="How to play"
              >
                <HelpIcon />
              </button>

              <button type="button" onClick={onLeaveRoom} className="topnav-leave-btn">
                Leave room
              </button>
            </>
          )}

          <span className={`topnav-conn ${connected ? "online" : "offline"}`}>
            <span className="topnav-conn-dot" aria-hidden="true" />
            <span className="topnav-conn-label">{connected ? "Connected" : "Connecting…"}</span>
          </span>
        </div>
      </div>

      {showHelp && (
        <InfoModal title={PAGES.howToPlay.title} body={PAGES.howToPlay.body} onClose={() => setShowHelp(false)} />
      )}
    </header>
  );
}
