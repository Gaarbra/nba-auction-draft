import { useEffect, useRef, useState } from "react";
import NominationForm from "./NominationForm.jsx";
import RosterGrid from "./RosterGrid.jsx";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import ResultsScreen from "./ResultsScreen.jsx";

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
  NOT_ASSIGNING: "Not currently assigning a position.",
  NOT_YOUR_ASSIGNMENT: "It's not your pick to assign.",
  INVALID_POSITION: "That's not a valid position.",
  SLOT_TAKEN: "That slot is already filled.",
  PLAYER_NOT_FOUND: "That player couldn't be found.",
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

  const rollSampleRef = useRef([]);
  const rollIntervalRef = useRef(null);

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
    }
  }, [nomination, isRolling]);

  function handleNominate() {
    setNominateError("");
    socket.emit("draft:nominate", {}, (res) => {
      if (res?.error) setNominateError(friendlyError(res.error));
    });
  }

  function handleBid() {
    setBidError("");
    const amount = Number(bidInput);
    socket.emit("draft:bid", { amount }, (res) => {
      if (res?.error) setBidError(friendlyError(res.error));
      else setBidInput("");
    });
  }

  function handlePass() {
    setBidError("");
    socket.emit("draft:pass", {}, (res) => {
      if (res?.error) setBidError(friendlyError(res.error));
    });
  }

  function submitAssign(position) {
    setAssignError("");
    socket.emit("draft:assign", { position }, (res) => {
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
    return <ResultsScreen room={room} currentPlayerId={currentPlayerId} onLeaveRoom={onLeaveRoom} />;
  }

  return (
    <div className="draft-board">
      <div className="draft-header">
        <div>
          <h2>Room {room.code}</h2>
          {room.draftEra && room.draftEra !== "all" && <p className="hint-text">Pool: {room.draftEra}</p>}
        </div>
        <button type="button" onClick={onLeaveRoom} className="secondary-btn">
          Leave Room
        </button>
      </div>

      {!isRolling && !nomination && (
        <p className="turn-banner">{isMyTurn ? "It's your turn to nominate!" : `Waiting for ${nominator?.name || "…"} to nominate…`}</p>
      )}

      {!isRolling && !nomination && isMyTurn && <NominationForm onNominate={handleNominate} error={nominateError} />}

      {isRolling && (
        <div className="rolling-panel">
          <p className="hint-text">Rolling the pool…</p>
          <div className="rolling-name" key={rollDisplayName}>
            {rollDisplayName || "…"}
          </div>
        </div>
      )}

      {!isRolling && nomination && (
        <div className="active-nomination">
          <div className="nominated-player-card">
            <div className="nominated-player-header">
              <PlayerHeadshot
                nbaPlayerId={nomination.player.nbaPlayerId}
                alt={nomination.player.fullName}
                className="player-headshot"
              />
              <div className="nominated-player-info">
                <h3>{nomination.player.fullName}</h3>
                <p className="player-meta">
                  {nomination.player.position || "—"} · {nomination.player.team?.abbreviation || "Free Agent"} ·{" "}
                  {nomination.player.draftYear ? `Drafted ${nomination.player.draftYear}` : "Undrafted"}
                </p>
                {nomination.player.stats?.unavailable && (
                  <p className="player-stats loading">Stats unavailable for this player.</p>
                )}
                {nomination.player.stats && !nomination.player.stats.unavailable && (
                  <p className="player-stats">
                    {formatStat(nomination.player.stats.pointsPerGame)} PTS ·{" "}
                    {formatStat(nomination.player.stats.reboundsPerGame)} REB ·{" "}
                    {formatStat(nomination.player.stats.assistsPerGame)} AST ·{" "}
                    {formatStat(nomination.player.stats.stealsPerGame)} STL ·{" "}
                    {formatStat(nomination.player.stats.blocksPerGame)} BLK
                    <span className="stats-season">
                      {" "}
                      (career avg, {nomination.player.stats.seasonsPlayed} season
                      {nomination.player.stats.seasonsPlayed === 1 ? "" : "s"}:{" "}
                      {nomination.player.stats.firstSeason === nomination.player.stats.lastSeason
                        ? nomination.player.stats.firstSeason
                        : `${nomination.player.stats.firstSeason}–${nomination.player.stats.lastSeason}`}
                      )
                    </span>
                  </p>
                )}
                <p className="nominated-by">Nominated by {playerName(nomination.nominatedBy)}</p>
              </div>
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

              {currentPlayerId === nomination.currentBidder && (
                <p className="hint-text">You're the high bidder!</p>
              )}

              {currentPlayerId !== nomination.currentBidder && nomination.passed.includes(currentPlayerId) && (
                <p className="hint-text">You passed on this player.</p>
              )}

              {currentPlayerId !== nomination.currentBidder &&
                !nomination.passed.includes(currentPlayerId) &&
                myOpenSlots.length === 0 && <p className="hint-text">Your roster is full — spectating.</p>}

              {currentPlayerId !== nomination.currentBidder &&
                !nomination.passed.includes(currentPlayerId) &&
                myOpenSlots.length > 0 && (
                  <div className="bid-controls">
                    <input
                      type="number"
                      min={nomination.currentBid + 1}
                      max={currentPlayer?.budget}
                      value={bidInput}
                      onChange={(e) => setBidInput(e.target.value)}
                      placeholder={`> ${nomination.currentBid}`}
                    />
                    <button type="button" onClick={handleBid} className="primary-btn">
                      Raise
                    </button>
                    <button type="button" onClick={handlePass} className="secondary-btn">
                      Pass
                    </button>
                  </div>
                )}

              {bidError && <p className="error-text">{bidError}</p>}
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
                      <button key={pos} type="button" onClick={() => handlePickPosition(pos)} className="secondary-btn">
                        {pos}
                      </button>
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
        </div>
      )}

      <RosterGrid room={room} currentPlayerId={currentPlayerId} socket={socket} />
    </div>
  );
}
