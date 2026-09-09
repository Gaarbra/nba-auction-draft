import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import RosterGrid from "./RosterGrid.jsx";
import AssignBoard from "./AssignBoard.jsx";
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
import PlayerAccolades from "./PlayerAccolades.jsx";
import TeamBadge from "./TeamBadge.jsx";
import { playRollTick, playRollSelectChime } from "../rollSound.js";
import { getTeamColors } from "../teamColors.js";
import { getTeamLogoUrl } from "../teamLogos.js";
import { countryFlag } from "../countryFlags.js";
import useMediaQuery from "../hooks/useMediaQuery.js";

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
  NOT_YOUR_BID_TURN: "It's not your turn to bid yet. This room is using orderly bidding.",
  NOT_ASSIGNING: "Not currently assigning a position.",
  NOT_YOUR_ASSIGNMENT: "It's not your pick to assign.",
  INVALID_POSITION: "That's not a valid position.",
  SLOT_TAKEN: "That slot is already filled.",
  PLAYER_NOT_FOUND: "That player couldn't be found.",
  RATE_LIMITED: "Slow down a bit. Try again in a few seconds.",
  REROLL_SOLO_ONLY: "Rerolling is only available in solo drafts.",
  REROLL_ALREADY_USED: "You've already used your reroll for this draft.",
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
  const [rerollError, setRerollError] = useState("");
  const [isRolling, setIsRolling] = useState(false);
  const [rollDisplayName, setRollDisplayName] = useState("");

  const rollSampleRef = useRef([]);
  const rollIntervalRef = useRef(null);
  const autoNominatedForRef = useRef(null);

  // A reroll keeps `nomination` populated the whole time (it swaps who's in
  // it, never goes back to null the way a fresh nominate does), so the
  // belt-and-suspenders effect below can't just check "nomination is
  // truthy" to know a roll finished -- for a reroll that's true from the
  // very first frame, before the new player has even been drawn. This ref
  // snapshots which player was showing when a roll started, so that effect
  // can tell "still the old player" apart from "the new one actually
  // landed" in both cases. (currentNominationIdRef is kept in sync with
  // `nomination` further down, once that's actually in scope.)
  const rollingAwayFromIdRef = useRef(null);
  const currentNominationIdRef = useRef(null);

  // Chat/reactions are ephemeral (see roomHandlers.js). chatMessages is just
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
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Matches the .room-drafting mobile breakpoint in index.css. A real,
  // resize-reactive check (see useMediaQuery) rather than a one-off read
  // like prefersReducedMotion above -- this gates an actual interaction
  // change (see the simplified mobile bid controls below), not just
  // styling, so a stale value from before a window resize or phone
  // rotation would leave the wrong bid UI wired up rather than just
  // looking briefly outdated.
  const isMobileViewport = useMediaQuery("(max-width: 640px)");

  const isComplete = room.status === "complete";
  const nomination = draft?.nomination || null;
  currentNominationIdRef.current = nomination?.player?.nbaPlayerId ?? nomination?.player?.fullName ?? null;
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
  // events rather than the local button click. That's what makes it play
  // in sync for every player in the room, not just whoever clicked reveal.
  useEffect(() => {
    function startRolling() {
      setNominateError("");
      setRerollError("");
      rollingAwayFromIdRef.current = currentNominationIdRef.current;
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
  // fired (it only fires on error paths, not on success). Checks the
  // player's identity actually changed, not just that `nomination` is
  // truthy -- a reroll never sets it back to null in between (it swaps who's
  // in an already-populated nomination), so "truthy" alone would fire this
  // the instant a reroll starts, before the new player's even been drawn.
  useEffect(() => {
    if (nomination && isRolling && currentNominationIdRef.current !== rollingAwayFromIdRef.current) {
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
  // draft (solo replay, a rematch, anyone nominating a second time) still
  // triggers again instead of being silently skipped as "already handled".
  useEffect(() => {
    if (!isMyTurn || nomination || isRolling || !draft?.currentNominatorId) return;
    const turnKey = `${draft.currentNominatorId}:${draft.draftedPlayerIds?.length ?? 0}`;
    if (autoNominatedForRef.current === turnKey) return;
    autoNominatedForRef.current = turnKey;
    handleNominate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, nomination, isRolling, draft?.currentNominatorId, draft?.draftedPlayerIds?.length]);

  // The stepper's starting point is always "one more than the current bid."
  // Reset it every time that changes (a fresh nomination, or someone else
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

  function handleReroll() {
    setRerollError("");
    socket.emit("draft:reroll", { playerId: currentPlayerId }, (res) => {
      if (res?.error) setRerollError(friendlyError(res.error));
    });
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

  const isAssigningAsWinner =
    nomination?.phase === "assigning" && currentPlayerId === nomination.currentBidder;
  // Solo never bids -- every pick lands at the same flat starting price, so
  // there's no real "worth" to show per player (see AssignBoard/RosterGrid's
  // own use of this: they hide the per-pick coin readouts rather than
  // repeat a number that's identical for every single pick).
  const isSolo = draft?.turnOrder?.length === 1;

  return (
    <div className="draft-layout">
      <div className="draft-board">
      {(room.draftEra && room.draftEra !== "all") || room.biddingMode === "orderly" ? (
        <div className="draft-meta">
          {room.draftEra && room.draftEra !== "all" && <span className="meta-chip">Pool: {room.draftEra}</span>}
          {room.biddingMode === "orderly" && <span className="meta-chip">Orderly bidding</span>}
        </div>
      ) : null}

      {!room.isLocal && <VoteKickBanner room={room} currentPlayerId={currentPlayerId} socket={socket} />}

      {!isRolling && !nomination && (
        <p className="turn-banner">{isMyTurn ? "It's your turn, rolling a player…" : `Waiting for ${nominator?.name || "…"} to nominate…`}</p>
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

      {/* !isRolling matters here specifically for a reroll: it keeps
          nomination.phase === "assigning" (and isAssigningAsWinner true)
          the whole time a new player's being drawn, since it's swapping who
          this same nomination points at rather than clearing it. Without
          this guard the old player's assign screen would render right on
          top of the rolling panel instead of stepping aside for it. */}
      {isAssigningAsWinner && !isRolling && (
        <AssignBoard
          ownerName={currentPlayer?.name || "Your"}
          roster={myRoster}
          budget={currentPlayer?.budget ?? 0}
          nomination={nomination}
          nominatedByName={playerName(nomination.nominatedBy)}
          isSolo={isSolo}
          rerollAvailable={isSolo && !draft?.soloRerollUsed}
          onReroll={handleReroll}
          rerollError={rerollError}
          pendingAssignment={pendingAssignment}
          assignError={assignError}
          onPickPosition={handlePickPosition}
          onConfirmPending={submitAssign}
          onCancelPending={() => setPendingAssignment(null)}
        />
      )}

      {!isRolling && nomination && !isAssigningAsWinner && (
        // No AnimatePresence/exit animation here on purpose. This panel is
        // load-bearing (it's how you assign a won player to a slot), and an
        // exit transition that never resolves would leave it stuck showing
        // stale content forever with mode="wait" queued behind it. A keyed
        // motion.div gets the same "new nomination pops in" effect just by
        // remounting on key change, with no exit-timing failure mode.
        <motion.div
          className="active-nomination active-nomination-cinematic"
          key={`${nomination.player.nbaPlayerId ?? nomination.player.fullName}-${nomination.nominatedBy}`}
          style={(() => {
            const colors = getTeamColors(nomination.player.team?.abbreviation);
            return { "--team-primary": colors.primary, "--team-secondary": colors.secondary };
          })()}
          // The card itself just fades in now -- the slide lives solely on
          // the photo and logo below, not the whole panel (see
          // .nomination-photo-wrap). Remounting on key change (rather than
          // an exit animation) for the usual reason in this component: an
          // exit transition that never resolves would leave this
          // load-bearing panel stuck.
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          {(() => {
            const logoUrl = getTeamLogoUrl(nomination.player.team?.abbreviation);
            // The official NBA CDN headshot is a transparent cutout -- the
            // team logo can sit directly behind the player and show
            // through around them, big and confident, like a real
            // broadcast graphic. stats.photoUrl only gets set when that
            // CDN image doesn't exist for this player (see PlayerHeadshot's
            // own doc comment) and a Wikipedia/fallback photo is standing
            // in instead -- a flat rectangular photo, not a cutout, so a
            // giant logo behind it would just be hidden. Badge it small in
            // the corner there instead.
            const isOfficialPhoto = Boolean(nomination.player.nbaPlayerId) && !nomination.player.stats?.photoUrl;
            const slideFrom = prefersReducedMotion ? "translateX(0px)" : "translateX(-36px)";
            // A premium, slightly overshooting ease-out -- deliberately
            // distinct from the rest of the app's standard entrance curve
            // (see the animate skill's --ease-out token) for this one
            // specific "big logo slides into place" moment.
            const logoEase = [0.25, 1, 0.5, 1];
            // Same slide as the headshot's own -- bottom-anchored via CSS
            // (see .nomination-big-logo), so unlike the earlier vertically-
            // centered version this doesn't need a translateY baked into
            // every animated frame, just the horizontal slide.
            const bigLogoFrom = prefersReducedMotion ? "translateX(0px)" : "translateX(-40px)";

            return (
              <>
                <div className="nominated-player-card">
                  {/* The background half of the reveal: a wash of the
                      player's own current team color sweeping in behind the
                      card content. */}
                  <motion.div
                    className="nomination-team-wash"
                    aria-hidden="true"
                    style={{ transformOrigin: "left center" }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ type: "spring", stiffness: 220, damping: 30, delay: 0.08 }}
                  />
                  {/* Back inside .nominated-player-card (not a sibling of it)
                      so its position is anchored to THIS box's own edges --
                      specifically bottom:0, matching the photo's own anchor --
                      rather than the outer card's, which also includes the
                      separate bidding/assign panel below and let the logo
                      drift down behind that too. .nominated-player-card
                      itself now allows overflow (see that rule) so the logo
                      can still bleed out past ITS edges; only the true outer
                      card (.active-nomination-cinematic) clips it for real. */}
                  {logoUrl && isOfficialPhoto && (
                    <motion.img
                      src={logoUrl}
                      alt=""
                      aria-hidden="true"
                      className="nomination-big-logo"
                      initial={{ opacity: 0, transform: bigLogoFrom }}
                      animate={{ opacity: 1, transform: "translateX(0px)" }}
                      transition={{ duration: 0.6, ease: logoEase }}
                    />
                  )}
                  <div className="nominated-player-header">
                    <div className="nomination-photo-wrap">
                      <motion.div
                        // Masked only when there's the big logo actually
                        // sitting behind it (see .nomination-photo-slide.masked)
                        // -- softening a photo's edges toward transparent
                        // with nothing behind it would just look like an
                        // unexplained vignette against the card.
                        className={`nomination-photo-slide ${logoUrl && isOfficialPhoto ? "masked" : ""}`}
                        initial={{ opacity: 0, transform: slideFrom }}
                        animate={{ opacity: 1, transform: "translateX(0px)" }}
                        transition={{ duration: 0.6, ease: logoEase, delay: 0.05 }}
                      >
                        <PlayerHeadshot
                          nbaPlayerId={nomination.player.nbaPlayerId}
                          photoUrl={nomination.player.stats?.photoUrl}
                          alt={nomination.player.fullName}
                          className="player-headshot player-headshot-cinematic"
                        />
                      </motion.div>
                      {logoUrl && !isOfficialPhoto && (
                        <motion.img
                          src={logoUrl}
                          alt=""
                          aria-hidden="true"
                          className="nomination-photo-logo badge"
                          initial={{ opacity: 0, transform: slideFrom }}
                          animate={{ opacity: 1, transform: "translateX(0px)" }}
                          transition={{ duration: 0.5, ease: logoEase, delay: 0.2 }}
                        />
                      )}
                    </div>
                    {/* Everything that isn't the photo/logo rises into place
                        together instead of sliding with the card -- a
                        separate, gentler beat from the photo's slide. */}
                    <motion.div
                      className="nomination-content-fade"
                      initial={{ opacity: 0, transform: prefersReducedMotion ? "translateY(0px)" : "translateY(16px)" }}
                      animate={{ opacity: 1, transform: "translateY(0px)" }}
                      transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1], delay: 0.2 }}
                    >
                      <div className="nominated-player-info">
                        <h3>
                          <TeamBadge abbreviation={nomination.player.team?.abbreviation} size={22} />
                          <PlayerNameLink
                            nbaPlayerId={nomination.player.nbaPlayerId}
                            name={nomination.player.fullName}
                          />
                        </h3>
                        <p className="player-meta">
                          {countryFlag(nomination.player.stats?.country) && (
                            <span className="player-meta-flag" title={nomination.player.stats.country}>
                              {countryFlag(nomination.player.stats.country)}
                            </span>
                          )}
                          {nomination.player.position || "N/A"} ·{" "}
                          {nomination.player.isActive ? "Currently" : "Played for"}{" "}
                          {nomination.player.team?.abbreviation || "Free Agent"} ·{" "}
                          {nomination.player.draftYear ? `Drafted ${nomination.player.draftYear}` : "Undrafted"}
                        </p>
                        <PlayerAccolades nbaPlayerId={nomination.player.nbaPlayerId} />
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
                        {/* Similar Players dropped from this card specifically (still
                            shown in the Market tab's own use of this component) --
                            a nice-to-have next to the reveal, not worth the room it
                            takes. Suggested Value also skips mobile entirely: with
                            the room a phone screen has, one predicted number isn't
                            worth crowding out the essentials (photo, name, real
                            stats, bid controls). */}
                        {!isSolo && !isMobileViewport && (
                          <PlayerInsights
                            nbaPlayerId={nomination.player.nbaPlayerId}
                            era={room.draftEra}
                            difficulty={room.difficulty}
                            showSimilar={false}
                          />
                        )}
                        <p className="nominated-by">
                          Nominated by {playerName(nomination.nominatedBy)}
                          {(() => {
                            const p = room.players.find((pl) => pl.id === nomination.nominatedBy);
                            return p ? (
                              <PlayerStatusBadge player={p} reconnectGraceMs={room.reconnectGraceMs} />
                            ) : null;
                          })()}
                        </p>
                      </div>
                      {nomination.player.stats && !nomination.player.stats.unavailable && (
                        <StatRadarChart
                          stats={nomination.player.stats}
                          color={getTeamColors(nomination.player.team?.abbreviation).primary}
                        />
                      )}
                    </motion.div>
                  </div>
                </div>
              </>
            );
          })()}

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
                    myOpenSlots.length === 0 && <p className="hint-text">Your roster is full. Spectating.</p>}

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
                      <form
                        className="bid-controls"
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleBid();
                        }}
                      >
                        <BidStepper
                          value={bidInput}
                          min={nomination.currentBid + 1}
                          max={currentPlayer?.budget ?? nomination.currentBid + 1}
                          onChange={setBidInput}
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
                          onClick={handlePass}
                          className="secondary-btn"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          Pass
                        </motion.button>
                      </form>
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
                    You won {nomination.player.fullName} for {nomination.currentBid} coins. Tap an open slot in
                    your roster below to add them.
                  </p>

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
                          {myOpenSlots.length - 1} remaining slot(s). That's tight, you'll need at least 1 coin per slot.
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

      {!isAssigningAsWinner && (
        <RosterGrid
          room={room}
          currentPlayerId={currentPlayerId}
          socket={socket}
          nominatingId={draft?.currentNominatorId}
          floatingByPlayer={floatingByPlayer}
          assigningSlot={false}
          onAssignSlot={handlePickPosition}
          hideCost={isSolo}
        />
      )}
      </div>

      <ChatPanel socket={socket} room={room} currentPlayerId={currentPlayerId} messages={chatMessages} />
    </div>
  );
}
