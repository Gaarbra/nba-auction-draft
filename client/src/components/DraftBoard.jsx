import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import RosterGrid from "./RosterGrid.jsx";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import PlayerNameLink from "./PlayerNameLink.jsx";
import ResultsScreen from "./ResultsScreen.jsx";
import PlayerStatusBadge from "./PlayerStatusBadge.jsx";
import StatRadarChart from "./StatRadarChart.jsx";
import StatHighlightRow from "./StatHighlightRow.jsx";
import VoteKickBanner from "./VoteKick.jsx";
import BidStepper from "./BidStepper.jsx";
import ChatPanel from "./ChatPanel.jsx";
import LocalBiddingRows from "./LocalBiddingRows.jsx";
import PlayerInsights from "./PlayerInsights.jsx";
import { isSoundMuted, setSoundMuted, playRollTick, playRollSelectChime } from "../rollSound.js";
import { getTeamColors } from "../teamColors.js";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const ROLL_INTERVAL_MS = 90;

const ERROR_MESSAGES = {
  NOT_DRAFTING: "The draft isn't active right now.",
  NOMINATION_IN_PROGRESS: "A nomination is already in progress.",
  NOT_YOUR_TURN: "It's not your turn to nominate.",
  PLAYER_ALREADY_DRAFTED: "That player has already been drafted in this room.",
  NO_PLAYERS_LEFT: "No players left in this era's pool.",
  BID_EXCEEDS_BUDGET: "That bid is more than your remaining budget.",
  NO_ACTIVE_NOMINATION: "There's no active nomination.",
  ALREADY_HIGH_BIDDER: "You're already the high bidder.",
  ALREADY_PASSED: "You already passed on this player.",
  ROSTER_FULL: "Your roster is already full.",
  BID_TOO_LOW: "Your bid must be higher than the current bid.",
  CANNOT_PASS_AS_HIGH_BIDDER: "You can't pass while you're the high bidder.",
  NOT_YOUR_BID_TURN: "It's not your turn to bid yet — this room is using orderly bidding.",
  NOT_ASSIGNING: "Not currently assigning a position.",
  NOT_YOUR_ASSIGNMENT: "It's not your pick to assign.",
  INVALID_POSITION: "That's not a valid position.",
  SLOT_TAKEN: "That slot is already filled.",
  PLAYER_NOT_FOUND: "That player couldn't be found.",
  RATE_LIMITED: "Slow down a bit — try again in a few seconds.",
};

function friendlyError(code) {
  return ERROR_MESSAGES[code] || "Something went wrong.";
}

function formatStat(value) {
  return value === null || value === undefined ? "N/A" : value;
}

const SLOT_GROUP = { PG: "G", SG: "G", SF: "F", PF: "F", C: "C" };

function positionMatchesSlot(playerPosition, slot) {
  if (!playerPosition) return true;
  return playerPosition.toUpperCase().includes(SLOT_GROUP[slot]);
}

export default function DraftBoard({ room, currentPlayerId, socket, onLeaveRoom }) {
  const [nominateError, setNominateError] = useState("");
  const [bidInput, setBidInput] = useState("");
  const [bidError, setBidError] = useState("");
  const [pendingAssignment, setPendingAssignment] = useState(null);
  const [assignError, setAssignError] = useState("");
  const [isRolling, setIsRolling] = useState(false);
  const [rollDisplayName, setRollDisplayName] = useState("");
  const [soundMuted, setSoundMutedState] = useState(() => isSoundMuted());

  function toggleSound() {
    const next = !soundMuted;
    setSoundMutedState(next);
    setSoundMuted(next);
  }

  const rollSampleRef = useRef([]);
  const rollIntervalRef = useRef(null);
  const autoNominatedForRef = useRef(null);

  // Chat/reactions are ephemeral (see roomHandlers.js) — chatMessages is just
  // a session-local scrollback for the panel, and floatingByPlayer tracks at
  // most one pop-up per player at a time, auto-clearing itself via a timer
  // per player rather than one global sweep.
  const [chatMessages, setChatMessages] = useState([]);
  const [floatingByPlayer, setFloatingByPlayer] = useState({});
  const floatingTimersRef = useRef({});

  function showFloating(playerId, item) {
    clearTimeout(floatingTimersRef.current[playerId]);
    setFloatingByPlayer((prev) => ({ ...prev, [playerId]: item }));
    const duration = item.kind === "reaction" ? 2200 : 3400;
    floatingTimersRef.current[playerId] = setTimeout(() => {
      setFloatingByPlayer((prev) => {
        if (prev[playerId]?.id !== item.id) return prev;
        const next = { ...prev };
        delete next[playerId];
        return next;
      });
    }, duration);
  }

  useEffect(() => {
    function handleChatMessage(msg) {
      setChatMessages((prev) => [...prev.slice(-49), msg]);
      showFloating(msg.playerId, { id: msg.id, kind: "message", content: msg.text });
    }
    function handleChatReaction(r) {
      showFloating(r.playerId, { id: r.id, kind: "reaction", content: r.emoji });
    }
    socket.on("chat:message", handleChatMessage);
    socket.on("chat:reaction", handleChatReaction);
    return () => {
      socket.off("chat:message", handleChatMessage);
      socket.off("chat:reaction", handleChatReaction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  useEffect(
    () => () => {
      Object.values(floatingTimersRef.current).forEach(clearTimeout);
    },
    []
  );

  const draft = room.draft;
  const isComplete = room.status === "complete";
  const nomination = draft?.nomination || null;
  const currentPlayer = room.players.find((p) => p.id === currentPlayerId);
  const myRoster = draft?.rosters?.[currentPlayerId] || {};
  const myOpenSlots = POSITIONS.filter((pos) => !myRoster[pos]);
  const isMyTurn = draft?.currentNominatorId === currentPlayerId;
  const nominator = room.players.find((p) => p.id === draft?.currentNominatorId);

  function playerName(id) {
    return room.players.find((p) => p.id === id)?.name || "Someone";
  }

  async function ensureRollSample() {
    if (rollSampleRef.current.length > 0) return;
    try {
      const params = new URLSearchParams({ era: room.draftEra || "all", limit: "40" });
      const res = await fetch(`${SERVER_URL}/api/players?${params}`);
      const data = await res.json();
      rollSampleRef.current = (data.players || []).map((p) => p.fullName);
    } catch {
      rollSampleRef.current = [];
    }
  }

  // The reveal is server-authoritative and broadcast to everyone at once
  // (see roomHandlers.js), so the rolling animation is driven by socket
  // events rather than the local button click — that's what makes it play
  // in sync for every player in the room, not just whoever clicked reveal.
  useEffect(() => {
    function startRolling() {
      setNominateError("");
      setIsRolling(true);
      setRollDisplayName("");
      ensureRollSample().then(() => {
        const sample = rollSampleRef.current;
        if (sample.length > 0) {
          setRollDisplayName(sample[Math.floor(Math.random() * sample.length)]);
        }
        clearInterval(rollIntervalRef.current);
        rollIntervalRef.current = setInterval(() => {
          if (sample.length > 0) {
            setRollDisplayName(sample[Math.floor(Math.random() * sample.length)]);
            playRollTick();
          }
        }, ROLL_INTERVAL_MS);
      });
    }

    function stopRolling() {
      clearInterval(rollIntervalRef.current);
      setIsRolling(false);
    }

    socket.on("draft:rolling", startRolling);
    socket.on("draft:rolling-cancelled", stopRolling);
    return () => {
      socket.off("draft:rolling", startRolling);
      socket.off("draft:rolling-cancelled", stopRolling);
      clearInterval(rollIntervalRef.current);
    };
  }, [socket]);

  // Belt-and-suspenders: once a real nomination shows up in room state, the
  // roll is definitely over, regardless of whether draft:rolling-cancelled
  // fired (it only fires on error paths, not on success).
  useEffect(() => {
    if (nomination && isRolling) {
      clearInterval(rollIntervalRef.current);
      setIsRolling(false);
      playRollSelectChime();
    }
  }, [nomination, isRolling]);

  function handleNominate() {
    setNominateError("");
    socket.emit("draft:nominate", { playerId: currentPlayerId }, (res) => {
      if (res?.error) setNominateError(friendlyError(res.error));
    });
  }

  // Nominating used to be a manual "Reveal Random Player" click; now it
  // fires on its own the moment it becomes your turn. The dedupe key mixes
  // in draftedPlayerIds.length (not just currentNominatorId) so a fresh
  // draft — solo replay, a rematch, anyone nominating a second time — still
  // triggers again instead of being silently skipped as "already handled".
  useEffect(() => {
    if (!isMyTurn || nomination || isRolling || !draft?.currentNominatorId) return;
    const turnKey = `${draft.currentNominatorId}:${draft.draftedPlayerIds?.length ?? 0}`;
    if (autoNominatedForRef.current === turnKey) return;
    autoNominatedForRef.current = turnKey;
    handleNominate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, nomination, isRolling, draft?.currentNominatorId, draft?.draftedPlayerIds?.length]);

  // The stepper's starting point is always "one more than the current bid" —
  // reset it every time that changes (a fresh nomination, or someone else
  // raising) so a stale typed amount from the previous bid never lingers
  // as an invalid (too-low) value.
  useEffect(() => {
    if (nomination?.phase === "bidding") {
      setBidInput(String(nomination.currentBid + 1));
    }
  }, [nomination?.currentBid, nomination?.phase, nomination?.player?.nbaPlayerId]);

  function handleBid() {
    setBidError("");
    const amount = Number(bidInput);
    socket.emit("draft:bid", { amount, playerId: currentPlayerId }, (res) => {
      if (res?.error) setBidError(friendlyError(res.error));
      else setBidInput("");
    });
  }

  function handlePass() {
    setBidError("");
    socket.emit("draft:pass", { playerId: currentPlayerId }, (res) => {
      if (res?.error) setBidError(friendlyError(res.error));
    });
  }

  function submitAssign(position) {
    setAssignError("");
    socket.emit("draft:assign", { position, playerId: currentPlayerId }, (res) => {
      if (res?.error) setAssignError(friendlyError(res.error));
    });
    setPendingAssignment(null);
  }

  function handlePickPosition(position) {
    if (!nomination || !currentPlayer) return;
    const remainingAfterBid = currentPlayer.budget - nomination.currentBid;
    const openSlotsAfterPick = myOpenSlots.length - 1;
    const budgetTight = remainingAfterBid < openSlotsAfterPick;
    const positionMismatch = !positionMatchesSlot(nomination.player.position, position);

    if (budgetTight || positionMismatch) {
      setPendingAssignment({ position, budgetTight, positionMismatch });
    } else {
      submitAssign(position);
    }
  }

  if (isComplete) {
    return <ResultsScreen room={room} currentPlayerId={currentPlayerId} socket={socket} onLeaveRoom={onLeaveRoom} />;
  }

  return (
    <div className="draft-layout">
      <div className="draft-board">
      <div className="draft-header">
        <div>
          <h2>{room.isLocal ? "Local Game" : `Room ${room.code}`}</h2>
          <div className="draft-meta">
            {room.draftEra && room.draftEra !== "all" && <span className="meta-chip">Pool: {room.draftEra}</span>}
            {room.difficulty && <span className={`meta-chip difficulty-${room.difficulty}`}>{room.difficulty}</span>}
            {room.biddingMode === "orderly" && <span className="meta-chip">Orderly bidding</span>}
          </div>
        </div>
        <div className="draft-header-right">
          {nominator && (
            <div className="on-the-clock">
              <span className="on-the-clock-label">On the clock</span>
              <span className="on-the-clock-name">{isMyTurn ? "You" : nominator.name}</span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSound}
            className="icon-btn"
            title={soundMuted ? "Unmute roll sound" : "Mute roll sound"}
            aria-label={soundMuted ? "Unmute roll sound" : "Mute roll sound"}
          >
            {soundMuted ? "🔇" : "🔊"}
          </button>
          <button type="button" onClick={onLeaveRoom} className="secondary-btn">
            Leave Room
          </button>
        </div>
      </div>

      {!room.isLocal && <VoteKickBanner room={room} currentPlayerId={currentPlayerId} socket={socket} />}

      {!isRolling && !nomination && (
        <p className="turn-banner">{isMyTurn ? "It's your turn — rolling a player…" : `Waiting for ${nominator?.name || "…"} to nominate…`}</p>
      )}

      {!isRolling && !nomination && nominateError && <p className="error-text">{nominateError}</p>}

      {isRolling && (
        <div className="rolling-panel">
          <p className="hint-text">Rolling the pool…</p>
          <div className="rolling-name" key={rollDisplayName}>
            {rollDisplayName || "…"}
          </div>
        </div>
      )}

      {!isRolling && nomination && (
        // No AnimatePresence/exit animation here on purpose — this panel is
        // load-bearing (it's how you assign a won player to a slot), and an
        // exit transition that never resolves would leave it stuck showing
        // stale content forever with mode="wait" queued behind it. A keyed
        // motion.div gets the same "new nomination pops in" effect just by
        // remounting on key change, with no exit-timing failure mode.
        <motion.div
          className="active-nomination"
          key={`${nomination.player.nbaPlayerId ?? nomination.player.fullName}-${nomination.nominatedBy}`}
          initial={{ opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          <div
            className="nominated-player-card"
            style={(() => {
              const colors = getTeamColors(nomination.player.team?.abbreviation);
              return { "--team-primary": colors.primary, "--team-secondary": colors.secondary };
            })()}
          >
            <div className="nominated-player-header">
              <PlayerHeadshot
                nbaPlayerId={nomination.player.nbaPlayerId}
                photoUrl={nomination.player.stats?.photoUrl}
                alt={nomination.player.fullName}
                className="player-headshot"
              />
              <div className="nominated-player-info">
                <h3>
                  <PlayerNameLink nbaPlayerId={nomination.player.nbaPlayerId} name={nomination.player.fullName} />
                </h3>
                <p className="player-meta">
                  {nomination.player.position || "—"} ·{" "}
                  {nomination.player.isActive ? "Currently" : "Played for"}{" "}
                  {nomination.player.team?.abbreviation || "Free Agent"} ·{" "}
                  {nomination.player.draftYear ? `Drafted ${nomination.player.draftYear}` : "Undrafted"}
                </p>
                {nomination.player.teamHistory?.length > 1 && (
                  <p className="player-meta player-team-history">
                    Career teams: {nomination.player.teamHistory.map((t) => t.abbreviation).join(", ")}
                  </p>
                )}
                {nomination.player.stats?.unavailable && (
                  <p className="player-stats loading">Stats unavailable for this player.</p>
                )}
                {nomination.player.stats && !nomination.player.stats.unavailable && (
                  <>
                    <p className="stats-season">
                      Career avg, {nomination.player.stats.seasonsPlayed} season
                      {nomination.player.stats.seasonsPlayed === 1 ? "" : "s"}:{" "}
                      {nomination.player.stats.firstSeason === nomination.player.stats.lastSeason
                        ? nomination.player.stats.firstSeason
                        : `${nomination.player.stats.firstSeason}–${nomination.player.stats.lastSeason}`}
                    </p>
                    <StatHighlightRow stats={nomination.player.stats} />
                  </>
                )}
                <PlayerInsights
                  nbaPlayerId={nomination.player.nbaPlayerId}
                  era={room.draftEra}
                  difficulty={room.difficulty}
                />
                <p className="nominated-by">
                  Nominated by {playerName(nomination.nominatedBy)}
                  {(() => {
                    const p = room.players.find((pl) => pl.id === nomination.nominatedBy);
                    return p ? <PlayerStatusBadge player={p} reconnectGraceMs={room.reconnectGraceMs} /> : null;
                  })()}
                </p>
              </div>
              {nomination.player.stats && !nomination.player.stats.unavailable && (
                <StatRadarChart
                  stats={nomination.player.stats}
                  color={getTeamColors(nomination.player.team?.abbreviation).primary}
                />
              )}
            </div>
          </div>

          {nomination.phase === "bidding" && (
            <div className="bidding-panel">
              <p className="current-bid">
                Current bid: <strong>{nomination.currentBid} coins</strong> by {playerName(nomination.currentBidder)}
              </p>
              {nomination.passed.length > 0 && (
                <p className="hint-text">Passed: {nomination.passed.map(playerName).join(", ")}</p>
              )}

              {room.isLocal ? (
                <LocalBiddingRows room={room} nomination={nomination} socket={socket} friendlyError={friendlyError} />
              ) : (
                <>
                  {currentPlayerId === nomination.currentBidder && (
                    <p className="hint-text">You're the high bidder!</p>
                  )}

                  {currentPlayerId !== nomination.currentBidder && nomination.passed.includes(currentPlayerId) && (
                    <p className="hint-text">You passed on this player.</p>
                  )}

                  {currentPlayerId !== nomination.currentBidder &&
                    !nomination.passed.includes(currentPlayerId) &&
                    myOpenSlots.length === 0 && <p className="hint-text">Your roster is full — spectating.</p>}

                  {room.biddingMode === "orderly" &&
                    currentPlayerId !== nomination.currentBidder &&
                    !nomination.passed.includes(currentPlayerId) &&
                    myOpenSlots.length > 0 &&
                    nomination.currentBidTurnId !== currentPlayerId && (
                      <p className="hint-text">Waiting for {playerName(nomination.currentBidTurnId)} to bid or pass…</p>
                    )}

                  {(room.biddingMode !== "orderly" || nomination.currentBidTurnId === currentPlayerId) &&
                    currentPlayerId !== nomination.currentBidder &&
                    !nomination.passed.includes(currentPlayerId) &&
                    myOpenSlots.length > 0 && (
                      <div className="bid-controls">
                        <BidStepper
                          value={bidInput}
                          min={nomination.currentBid + 1}
                          max={currentPlayer?.budget ?? nomination.currentBid + 1}
                          onChange={setBidInput}
                        />
                        <motion.button
                          type="button"
                          onClick={handleBid}
                          className="primary-btn"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          Raise
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={handlePass}
                          className="secondary-btn"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          Pass
                        </motion.button>
                      </div>
                    )}

                  {bidError && <p className="error-text">{bidError}</p>}
                </>
              )}
            </div>
          )}

          {nomination.phase === "assigning" && (
            <div className="assign-panel">
              {currentPlayerId === nomination.currentBidder ? (
                <>
                  <p>
                    You won {nomination.player.fullName} for {nomination.currentBid} coins. Choose a slot:
                  </p>
                  <div className="position-picker">
                    {myOpenSlots.map((pos) => (
                      <motion.button
                        key={pos}
                        type="button"
                        onClick={() => handlePickPosition(pos)}
                        className="secondary-btn"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.94 }}
                      >
                        {pos}
                      </motion.button>
                    ))}
                  </div>

                  {pendingAssignment && (
                    <div className="budget-warning">
                      {pendingAssignment.positionMismatch && (
                        <p>
                          Are you sure you want to put <strong>{nomination.player.fullName}</strong> in{" "}
                          <strong>{pendingAssignment.position}</strong>? Their listed position is{" "}
                          {nomination.player.position || "unknown"}.
                        </p>
                      )}
                      {pendingAssignment.budgetTight && (
                        <p>
                          Locking this in leaves you {currentPlayer.budget - nomination.currentBid} coins for{" "}
                          {myOpenSlots.length - 1} remaining slot(s). That's tight — you'll need at least 1 coin per slot.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => submitAssign(pendingAssignment.position)}
                        className="primary-btn"
                      >
                        Lock In {pendingAssignment.position} Anyway
                      </button>
                      <button type="button" onClick={() => setPendingAssignment(null)} className="secondary-btn">
                        Cancel
                      </button>
                    </div>
                  )}

                  {assignError && <p className="error-text">{assignError}</p>}
                </>
              ) : (
                <p className="hint-text">Waiting for {playerName(nomination.currentBidder)} to choose a roster slot…</p>
              )}
            </div>
          )}
        </motion.div>
      )}

      <RosterGrid
        room={room}
        currentPlayerId={currentPlayerId}
        socket={socket}
        nominatingId={draft?.currentNominatorId}
        floatingByPlayer={floatingByPlayer}
      />
      </div>

      <ChatPanel socket={socket} room={room} currentPlayerId={currentPlayerId} messages={chatMessages} />
    </div>
  );
}
