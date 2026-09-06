import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import Dropdown from "./Dropdown.jsx";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import PlayerNameLink from "./PlayerNameLink.jsx";
import StatHighlightRow from "./StatHighlightRow.jsx";
import StatRadarChart from "./StatRadarChart.jsx";
import PlayerInsights from "./PlayerInsights.jsx";
import { getTeamColors } from "../teamColors.js";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// Same decade buckets the real draft-era picker uses (server/src/services/
// era.js) -- kept as a small local copy since that file is server-only and
// this only needs the bucket boundaries, not the whole module.
const ERA_BUCKETS = [
  { id: "1950s", label: "1950s", start: 1950, end: 1959 },
  { id: "1960s", label: "1960s", start: 1960, end: 1969 },
  { id: "1970s", label: "1970s", start: 1970, end: 1979 },
  { id: "1980s", label: "1980s", start: 1980, end: 1989 },
  { id: "1990s", label: "1990s", start: 1990, end: 1999 },
  { id: "2000s", label: "2000s", start: 2000, end: 2009 },
  { id: "2010s", label: "2010s", start: 2010, end: 2019 },
  { id: "2020s", label: "2020s", start: 2020, end: 2029 },
];

function eraIdFor(draftYear) {
  if (draftYear == null) return null;
  const bucket = ERA_BUCKETS.find((b) => draftYear >= b.start && draftYear <= b.end);
  return bucket ? bucket.id : null;
}

const ERA_OPTIONS = [{ value: "all", label: "All eras" }, ...ERA_BUCKETS.map((b) => ({ value: b.id, label: b.label }))];

// The suggested-value model takes difficulty as a real input (it's the same
// parameter the live draft's own bidding uses) and, unlike era, switching it
// never changes who's in the team/player pickers -- era does double duty as
// a browse filter, so it's often not the same player on both sides of an
// era switch to compare against. Difficulty is what makes "how did the
// suggested value change" reliably answerable for whichever player is on
// screen right now.
const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
];

/** Browse the same real player pool the draft nominates from -- pick an
 * era, then a team, then a player -- and see the exact card a live draft
 * would show you (stats, radar, suggested value, similar players), without
 * needing an active room. Every list here comes from
 * GET /api/players/market-index, which is itself just stats-service's own
 * already-cached, already-warmed player data (see that endpoint's
 * docstring) -- nothing here does a fresh stats.nba.com lookup. */
export default function MarketTab() {
  const [index, setIndex] = useState([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const [era, setEra] = useState("all");
  const [team, setTeam] = useState("");
  const [playerId, setPlayerId] = useState(null);
  const [difficulty, setDifficulty] = useState("normal");

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // playerId -> { era, difficulty, value } for the last suggested value seen
  // for that player -- lets the "how it changed" line compare against a
  // genuinely different context (era and/or difficulty, both real inputs to
  // the price model) rather than fabricating a trend with nothing behind it.
  const lastValueByPlayer = useRef(new Map());
  const [valueChange, setValueChange] = useState(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/players/market-index`)
      .then((res) => res.json())
      .then((data) => setIndex(Array.isArray(data.players) ? data.players : []))
      .catch(() => setIndex([]))
      .finally(() => setIndexLoading(false));
  }, []);

  const eraFiltered = useMemo(() => {
    if (era === "all") return index;
    return index.filter((p) => eraIdFor(p.draftYear) === era);
  }, [index, era]);

  const teamOptions = useMemo(() => {
    const counts = new Map();
    for (const p of eraFiltered) counts.set(p.team, (counts.get(p.team) || 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([abbr, count]) => ({ value: abbr, label: `${abbr} · ${count} player${count === 1 ? "" : "s"}` }));
  }, [eraFiltered]);

  // A team that no longer has any players in the newly-selected era gets
  // cleared rather than silently showing a stale, now-empty player list.
  useEffect(() => {
    if (team && !teamOptions.some((t) => t.value === team)) setTeam("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamOptions]);

  const teamPlayers = useMemo(() => {
    if (!team) return [];
    return eraFiltered.filter((p) => p.team === team).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [eraFiltered, team]);

  const playerOptions = teamPlayers.map((p) => ({
    value: String(p.id),
    label: p.position ? `${p.fullName} · ${p.position}` : p.fullName,
  }));

  useEffect(() => {
    if (playerId && !teamPlayers.some((p) => String(p.id) === String(playerId))) setPlayerId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamPlayers]);

  const selectedMeta = index.find((p) => String(p.id) === String(playerId));

  // Fetch this player's real per-game stats whenever the selection changes.
  useEffect(() => {
    setStats(null);
    setValueChange(null);
    if (!playerId) return undefined;

    let cancelled = false;
    setStatsLoading(true);
    fetch(`${SERVER_URL}/api/players/${playerId}/stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setStats(data?.stats ?? { unavailable: true });
      })
      .catch(() => {
        if (!cancelled) setStats({ unavailable: true });
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  function handlePredictedPrice(value) {
    const prev = lastValueByPlayer.current.get(playerId);
    if (prev && (prev.era !== era || prev.difficulty !== difficulty)) {
      setValueChange({ delta: value - prev.value, fromLabel: `${prev.eraLabel} · ${prev.difficultyLabel}` });
    } else if (!prev) {
      setValueChange(null);
    }
    const eraLabel = ERA_OPTIONS.find((o) => o.value === era)?.label || era;
    const difficultyLabel = DIFFICULTY_OPTIONS.find((o) => o.value === difficulty)?.label || difficulty;
    lastValueByPlayer.current.set(playerId, { era, difficulty, eraLabel, difficultyLabel, value });
  }

  // Jumping from a "similar players" chip can land on a player from a
  // different era/team than what's currently picked -- sync the pickers to
  // match so the breadcrumb stays honest about who's showing.
  function jumpToPlayer(id) {
    const entry = index.find((p) => String(p.id) === String(id));
    if (entry) {
      setEra(eraIdFor(entry.draftYear) || "all");
      setTeam(entry.team);
    }
    setPlayerId(String(id));
  }

  const teamColors = selectedMeta ? getTeamColors(selectedMeta.team) : null;

  return (
    <div className="market-tab">
      <div className="market-filters">
        <div className="market-filter">
          <span className="market-filter-label">Era</span>
          <Dropdown options={ERA_OPTIONS} value={era} onChange={setEra} />
        </div>
        <div className="market-filter">
          <span className="market-filter-label">Team</span>
          <Dropdown
            options={teamOptions}
            value={team}
            onChange={setTeam}
            placeholder={indexLoading ? "Loading…" : "Choose a team"}
          />
        </div>
        <div className="market-filter">
          <span className="market-filter-label">Player</span>
          <Dropdown
            options={playerOptions}
            value={playerId ?? ""}
            onChange={setPlayerId}
            placeholder={team ? "Choose a player" : "Pick a team first"}
          />
        </div>
      </div>

      {!playerId && (
        <p className="hint-text market-empty-hint">
          {indexLoading
            ? "Loading the player pool…"
            : "Pick an era, a team, and a player to see their stats and suggested value."}
        </p>
      )}

      {playerId && selectedMeta && (
        <motion.div
          key={playerId}
          className="nominated-player-card market-player-card"
          style={teamColors ? { "--team-primary": teamColors.primary, "--team-secondary": teamColors.secondary } : undefined}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="nominated-player-header">
            <PlayerHeadshot
              nbaPlayerId={selectedMeta.id}
              photoUrl={stats?.photoUrl}
              alt={selectedMeta.fullName}
              className="player-headshot"
            />
            <div className="nominated-player-info">
              <h3>
                <PlayerNameLink nbaPlayerId={selectedMeta.id} name={selectedMeta.fullName} />
              </h3>
              <p className="player-meta">
                {selectedMeta.position || "—"} · {selectedMeta.team} ·{" "}
                {selectedMeta.draftYear ? `Drafted ${selectedMeta.draftYear}` : "Undrafted"}
              </p>
              {stats?.teamHistory?.length > 1 && (
                <p className="player-meta player-team-history">
                  Career teams: {stats.teamHistory.map((t) => t.abbreviation).join(", ")}
                </p>
              )}

              {statsLoading && <p className="player-stats loading">Loading stats…</p>}
              {stats?.unavailable && !statsLoading && (
                <p className="player-stats loading">Stats unavailable for this player.</p>
              )}
              {stats && !stats.unavailable && !statsLoading && (
                <>
                  <p className="stats-season">
                    Career avg, {stats.seasonsPlayed} season{stats.seasonsPlayed === 1 ? "" : "s"}:{" "}
                    {stats.firstSeason === stats.lastSeason ? stats.firstSeason : `${stats.firstSeason}–${stats.lastSeason}`}
                  </p>
                  <StatHighlightRow stats={stats} />
                </>
              )}

              <div className="market-difficulty-row">
                <span className="market-filter-label">Suggested value under</span>
                <div className="difficulty-picker market-difficulty-picker">
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`difficulty-option ${difficulty === opt.value ? "active" : ""}`}
                      onClick={() => setDifficulty(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <PlayerInsights
                key={playerId}
                nbaPlayerId={selectedMeta.id}
                era={era === "all" ? undefined : era}
                difficulty={difficulty}
                onPredictedPrice={handlePredictedPrice}
                onSimilarPlayerClick={jumpToPlayer}
              />

              {valueChange && Math.abs(valueChange.delta) >= 0.05 && (
                <p className={`market-value-change ${valueChange.delta > 0 ? "up" : "down"}`}>
                  {valueChange.delta > 0 ? "▲" : "▼"} {valueChange.delta > 0 ? "+" : ""}
                  {valueChange.delta.toFixed(1)} coins vs. {valueChange.fromLabel}
                </p>
              )}
            </div>

            {stats && !stats.unavailable && !statsLoading && (
              <StatRadarChart stats={stats} color={teamColors?.primary} />
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
