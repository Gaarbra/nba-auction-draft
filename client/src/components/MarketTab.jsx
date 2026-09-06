import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import Dropdown from "./Dropdown.jsx";
import PlayerHeadshot from "./PlayerHeadshot.jsx";
import PlayerNameLink from "./PlayerNameLink.jsx";
import StatHighlightRow from "./StatHighlightRow.jsx";
import StatRadarChart from "./StatRadarChart.jsx";
import PlayerInsights from "./PlayerInsights.jsx";
import TeamBadge from "./TeamBadge.jsx";
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

// The real position field stats-service returns is coarse -- "G", "F", "C",
// plus a handful of hybrid tags ("F-C", "G-F", etc, ~6% of the pool) -- not
// the five-slot PG/SG/SF/PF/C breakdown the roster itself uses (a roster
// slot is a structural choice, not tied to a player's own listed position).
// Hot picks sticks to the three primary tags for that reason: crowning a
// "most proven" player for a position this data doesn't actually track
// would be a fabricated distinction, not a real one.
const POSITIONS = ["G", "F", "C"];
const LIVE_SALE_HISTORY_LIMIT = 60;

/** A small inline line chart of real suggested-value readings for the
 * player currently on screen — one point per time the price model actually
 * ran (a difficulty switch, or a fresh player load), never a fabricated
 * trend. Starts as a single flat point and grows during the session. */
function ValueHistoryChart({ points }) {
  if (points.length < 2) {
    return (
      <p className="hint-text market-chart-empty">
        {points.length === 1
          ? "Switch difficulty to see how the suggested value moves."
          : "No suggested-value reading yet."}
      </p>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 600;
  const H = 140;
  const pad = 12;

  const coords = points.map((p, i) => {
    const x = points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - pad * 2) + pad;
    const y = H - pad - ((p.value - min) / span) * (H - pad * 2);
    return [x, y];
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg className="market-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 5 : 3} fill={i === coords.length - 1 ? "var(--accent)" : "var(--bg-void)"} stroke="var(--accent)" strokeWidth="2" />
      ))}
      <text x={last[0]} y={Math.max(14, last[1] - 10)} textAnchor="end" className="market-chart-label">
        {points[points.length - 1].value.toFixed(1)}c
      </text>
    </svg>
  );
}

/** Browse the same real player pool the draft nominates from -- pick an
 * era, then a team, then a player -- and see the exact card a live draft
 * would show you (stats, radar, suggested value, similar players), without
 * needing an active room. Every list here comes from
 * GET /api/players/market-index, which is itself just stats-service's own
 * already-cached, already-warmed player data (see that endpoint's
 * docstring) -- nothing here does a fresh stats.nba.com lookup. */
export default function MarketTab({ socket }) {
  const [index, setIndex] = useState([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const [era, setEra] = useState("all");
  const [team, setTeam] = useState("");
  const [playerId, setPlayerId] = useState(null);
  const [difficulty, setDifficulty] = useState("normal");

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [usage, setUsage] = useState({ usagePct: null, season: null });

  // playerId -> { era, difficulty, value } for the last suggested value seen
  // for that player -- lets the "how it changed" line compare against a
  // genuinely different context (era and/or difficulty, both real inputs to
  // the price model) rather than fabricating a trend with nothing behind it.
  const lastValueByPlayer = useRef(new Map());
  const [valueChange, setValueChange] = useState(null);
  const [valueHistory, setValueHistory] = useState([]);

  // Real completed sales, broadcast globally (not room-scoped) the instant
  // any room anywhere assigns a won player to a slot — see
  // server/src/sockets/roomHandlers.js's "market:sale" emit. A rolling
  // buffer, not per-player storage: this only ever reflects what actually
  // happened while this tab was open this session, nothing back-filled.
  const [liveSales, setLiveSales] = useState([]);

  useEffect(() => {
    if (!socket) return undefined;
    function handleSale(sale) {
      setLiveSales((prev) => [sale, ...prev].slice(0, LIVE_SALE_HISTORY_LIMIT));
    }
    socket.on("market:sale", handleSale);
    return () => socket.off("market:sale", handleSale);
  }, [socket]);

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

  // Real career-games-played leaders per position -- a "hot picks" panel
  // shown before anyone's picked a filter, using a defensible real proxy
  // for "a stable player to get" (career longevity) instead of an invented
  // trend/popularity score this app has no data to actually back.
  const hotPicksByPosition = useMemo(() => {
    const byPos = new Map(POSITIONS.map((p) => [p, null]));
    for (const p of index) {
      if (!p.position || !byPos.has(p.position)) continue;
      const current = byPos.get(p.position);
      if (!current || (p.gamesPlayed ?? 0) > (current.gamesPlayed ?? 0)) byPos.set(p.position, p);
    }
    return POSITIONS.map((pos) => byPos.get(pos)).filter(Boolean);
  }, [index]);

  // Fetch this player's real per-game stats + usage rate whenever the
  // selection changes.
  useEffect(() => {
    setStats(null);
    setUsage({ usagePct: null, season: null });
    setValueChange(null);
    setValueHistory([]);
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

    fetch(`${SERVER_URL}/api/players/${playerId}/usage-pct`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setUsage({ usagePct: data.usagePct ?? null, season: data.season ?? null });
      })
      .catch(() => {});

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
    setValueHistory((prevHistory) => [...prevHistory, { value, at: Date.now() }].slice(-20));
  }

  // Jumping from a "similar players" chip (or a hot pick, or an
  // alternative) can land on a player from a different era/team than
  // what's currently picked -- sync the pickers to match so the pickers
  // stay honest about who's showing.
  function jumpToPlayer(id) {
    const entry = index.find((p) => String(p.id) === String(id));
    if (entry) {
      setEra(eraIdFor(entry.draftYear) || "all");
      setTeam(entry.team);
    }
    setPlayerId(String(id));
  }

  const teamColors = selectedMeta ? getTeamColors(selectedMeta.team) : null;
  const salesForPlayer = playerId ? liveSales.filter((s) => String(s.nbaPlayerId) === String(playerId)) : [];
  const highestLiveBid = salesForPlayer.length ? Math.max(...salesForPlayer.map((s) => s.price)) : null;

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
        <div className="market-hotpicks">
          <span className="market-filter-label">
            {indexLoading ? "Loading the player pool…" : "Hot picks — most proven player at each position"}
          </span>
          {!indexLoading && (
            <div className="market-hotpicks-grid">
              {hotPicksByPosition.map((p) => (
                <button key={p.id} type="button" className="market-hotpick-card" onClick={() => jumpToPlayer(p.id)}>
                  <TeamBadge abbreviation={p.team} size={32} />
                  <span className="market-hotpick-pos">{p.position}</span>
                  <span className="market-hotpick-name">{p.fullName}</span>
                  <span className="market-hotpick-meta">
                    {p.gamesPlayed ? `${p.gamesPlayed.toLocaleString()} GP` : "—"}
                    {p.pointsPerGame ? ` · ${p.pointsPerGame.toFixed(1)} PPG` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {playerId && selectedMeta && (
        <motion.div
          key={playerId}
          className="market-player-wrap"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="nominated-player-card market-player-card"
            style={teamColors ? { "--team-primary": teamColors.primary, "--team-secondary": teamColors.secondary } : undefined}
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
                  <TeamBadge abbreviation={selectedMeta.team} size={20} />{" "}
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
              </div>

              {stats && !stats.unavailable && !statsLoading && (
                <StatRadarChart stats={stats} color={teamColors?.primary} />
              )}
            </div>
          </div>

          <div className="market-metrics">
            <div className="market-metric-tile">
              <span className="market-metric-label">Suggested value</span>
              <span className="market-metric-value accent">
                {valueHistory.length ? `~${valueHistory[valueHistory.length - 1].value.toFixed(1)}c` : "—"}
              </span>
              {valueChange && Math.abs(valueChange.delta) >= 0.05 && (
                <span className={`market-value-change ${valueChange.delta > 0 ? "up" : "down"}`}>
                  {valueChange.delta > 0 ? "▲" : "▼"} {valueChange.delta > 0 ? "+" : ""}
                  {valueChange.delta.toFixed(1)} vs. {valueChange.fromLabel}
                </span>
              )}
            </div>
            <div className="market-metric-tile">
              <span className="market-metric-label">Highest real bid</span>
              <span className="market-metric-value">{highestLiveBid != null ? `${highestLiveBid}c` : "—"}</span>
              <span className="market-metric-sub">
                {salesForPlayer.length ? `${salesForPlayer.length} sale${salesForPlayer.length === 1 ? "" : "s"} this session` : "No sales yet this session"}
              </span>
            </div>
            <div className="market-metric-tile">
              <span className="market-metric-label">Usage rate</span>
              <span className="market-metric-value">{usage.usagePct != null ? `${usage.usagePct.toFixed(1)}%` : "—"}</span>
              <span className="market-metric-sub">{usage.season ? `${usage.season} season` : "Not cached yet"}</span>
            </div>
          </div>

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

          {/* Mounted for its real fetch + explanation tooltip; onPredictedPrice
              feeds the metric tile and chart above, onSimilarPlayerClick
              makes its player chips real in-app navigation. */}
          <PlayerInsights
            key={playerId}
            nbaPlayerId={selectedMeta.id}
            era={era === "all" ? undefined : era}
            difficulty={difficulty}
            onPredictedPrice={handlePredictedPrice}
            onSimilarPlayerClick={jumpToPlayer}
          />

          <div className="market-panel">
            <h4 className="market-panel-title">Suggested value over time</h4>
            <ValueHistoryChart points={valueHistory} />
          </div>

          <div className="market-columns">
            <div className="market-panel">
              <h4 className="market-panel-title">
                {selectedMeta.position ? `${selectedMeta.position} market alternatives` : "Market alternatives"}
              </h4>
              <AlternativesPanel playerId={playerId} onJump={jumpToPlayer} />
            </div>

            <div className="market-panel">
              <h4 className="market-panel-title">Live bids on this player</h4>
              {salesForPlayer.length === 0 ? (
                <p className="hint-text">
                  No completed bids on {selectedMeta.fullName} yet this session — this fills in live as any room,
                  anywhere, wins them.
                </p>
              ) : (
                <ul className="market-sale-list">
                  {salesForPlayer.map((s, i) => (
                    <li key={`${s.roomCode}-${s.at}-${i}`} className="market-sale-row">
                      <span className="market-sale-price">{s.price}c</span>
                      <span className="market-sale-meta">Room {s.roomCode}</span>
                      <span className="market-sale-time">{new Date(s.at).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** The richer, "market alternatives" version of PlayerInsights' own
 * similar-players list -- same real k-NN endpoint, but fetched separately
 * so each alternative can show its own real suggested value alongside a
 * photo and team badge, not just a name. */
function AlternativesPanel({ playerId, onJump }) {
  const [alternatives, setAlternatives] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAlternatives([]);
    if (!playerId) return undefined;
    let cancelled = false;
    setLoading(true);

    fetch(`${SERVER_URL}/api/players/${playerId}/similar?k=5`)
      .then((res) => res.json())
      .then(async (data) => {
        if (cancelled || !Array.isArray(data.similar)) return;
        const withValues = await Promise.all(
          data.similar.map(async (p) => {
            try {
              const res = await fetch(`${SERVER_URL}/api/players/${p.id}/predicted-price`);
              const priceData = await res.json();
              return { ...p, predictedPrice: typeof priceData.predictedPrice === "number" ? priceData.predictedPrice : null };
            } catch {
              return { ...p, predictedPrice: null };
            }
          })
        );
        if (!cancelled) setAlternatives(withValues);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (loading) return <p className="hint-text">Loading alternatives…</p>;
  if (alternatives.length === 0) return <p className="hint-text">No close statistical matches found.</p>;

  return (
    <ul className="market-alt-list">
      {alternatives.map((p) => (
        <li key={p.id}>
          <button type="button" className="market-alt-row" onClick={() => onJump(p.id)}>
            <PlayerHeadshot nbaPlayerId={p.id} alt={p.fullName} className="market-alt-photo" allowRetry={false} />
            <span className="market-alt-name">{p.fullName}</span>
            <span className="market-alt-value">{p.predictedPrice != null ? `~${p.predictedPrice.toFixed(1)}c` : "—"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
