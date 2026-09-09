import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import TeamDropdown from "./TeamDropdown.jsx";
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

// Ranks a team roster or a name search's matches by real career
// points-per-game -- "top players" by the numbers, not alphabetically --
// so a strong scorer surfaces above a bench player who just happens to
// come first in the alphabet. A player with no cached pointsPerGame sorts
// to the bottom rather than breaking the comparison.
function byPointsPerGame(a, b) {
  return (b.pointsPerGame ?? -1) - (a.pointsPerGame ?? -1);
}

function timeAgo(at) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
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
// These "quick filter" tags stick to the three primary ones for that
// reason -- Stitch's mock has tags like "Superstars" and "All-Star Tier"
// this app has no real data to back, so they became real position filters
// instead of invented tiers.
const QUICK_TAGS = [
  { value: "G", label: "Guards" },
  { value: "F", label: "Forwards" },
  { value: "C", label: "Centers" },
];

const LIVE_SALE_HISTORY_LIMIT = 60;
// A name search across every era can match a lot of players (e.g. common
// surnames) -- capped so the results list stays a quick scan, not a second
// dropdown's worth of scrolling in disguise.
const SEARCH_RESULTS_LIMIT = 50;

/** A small inline line chart of real suggested-value readings for the
 * player currently on screen: one point per time the price model actually
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

/** The Market tab: a "luxury exchange" browse of the same real player pool
 * the draft nominates from, adapted from a Stitch mock. Every number on
 * screen is real or clearly session-derived -- the mock's own fabricated
 * flourishes (a "24H volume" ticker, tier/rating badges, per-user bid
 * handles, a cross-room ceilings panel) were dropped or replaced with the
 * closest honest equivalent this app can back. Backed entirely by
 * GET /api/players/market-index, itself stats-service's own already-cached
 * data -- nothing here does a fresh stats.nba.com lookup. */
export default function MarketTab({ socket, onNavigateToLobby }) {
  const [index, setIndex] = useState([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const [era, setEra] = useState("all");
  const [team, setTeam] = useState("");
  const [search, setSearch] = useState("");
  const [positionTag, setPositionTag] = useState(null);
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
  const [valueHistory, setValueHistory] = useState([]);

  // Real completed sales, broadcast globally (not room-scoped) the instant
  // any room anywhere assigns a won player to a slot. See
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
    return eraFiltered.filter((p) => p.team === team).sort(byPointsPerGame);
  }, [eraFiltered, team]);

  useEffect(() => {
    if (playerId && team && !teamPlayers.some((p) => String(p.id) === String(playerId))) setPlayerId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamPlayers]);

  // The filter bar's three real inputs (team picked, a name typed, or a
  // quick position tag) all feed the same results list below it -- pick a
  // team and its roster appears, type a name to search the whole era, tap
  // a tag for a fast position-only cut, or combine them.
  const isBrowsing = Boolean(team) || search.trim().length > 0 || Boolean(positionTag);
  const searchResults = useMemo(() => {
    if (!isBrowsing) return [];
    const q = search.trim().toLowerCase();
    let pool = team ? teamPlayers : eraFiltered;
    if (positionTag) pool = pool.filter((p) => p.position === positionTag);
    if (q) pool = pool.filter((p) => p.fullName.toLowerCase().includes(q));
    return pool.slice().sort(byPointsPerGame);
  }, [isBrowsing, search, team, teamPlayers, eraFiltered, positionTag]);
  const shownResults = searchResults.slice(0, SEARCH_RESULTS_LIMIT);

  const selectedMeta = index.find((p) => String(p.id) === String(playerId));

  // Fetch this player's real per-game stats whenever the selection changes.
  useEffect(() => {
    setStats(null);
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

  // Jumping from a "similar players" chip (or a search result) can land on
  // a player from a different era/team than what's currently picked --
  // sync the pickers to match so the pickers stay honest about who's
  // showing.
  function jumpToPlayer(id) {
    const entry = index.find((p) => String(p.id) === String(id));
    if (entry) {
      setEra(eraIdFor(entry.draftYear) || "all");
      setTeam(entry.team);
    }
    // The search text did its job (finding this player); leaving it behind
    // would otherwise keep filtering the now-shown team roster down to just
    // this one name.
    setSearch("");
    setPlayerId(String(id));
  }

  // Stitch's own mock always shows a fully-loaded dossier, never an empty
  // "pick something first" state -- the real equivalent here is defaulting
  // to the single most career-games-played player in the whole pool the
  // instant it loads, rather than inventing a "featured" pick with no data
  // behind it.
  useEffect(() => {
    if (playerId || indexLoading || index.length === 0) return;
    let best = null;
    for (const p of index) {
      if (!best || (p.gamesPlayed ?? 0) > (best.gamesPlayed ?? 0)) best = p;
    }
    if (best) jumpToPlayer(best.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexLoading, index]);

  const teamColors = selectedMeta ? getTeamColors(selectedMeta.team) : null;
  const salesForPlayer = playerId ? liveSales.filter((s) => String(s.nbaPlayerId) === String(playerId)) : [];
  const highestLiveBid = salesForPlayer.length ? Math.max(...salesForPlayer.map((s) => s.price)) : null;
  const topSaleOverall = liveSales.length ? Math.max(...liveSales.map((s) => s.price)) : null;

  return (
    <div className="market-tab market-exchange">
      {/* Real numbers only -- the Stitch mock's own "24H volume"/"Market
          Index"/"Liquidity %" ticker was invented trend data this app has
          no basis for, so this version only ever shows things that are
          either static real facts (catalogue size) or genuinely
          session-derived (the live sales feed this tab has actually seen). */}
      <div className="market-ticker">
        <div className="market-ticker-item">
          <span className="market-ticker-dot" aria-hidden="true" />
          <span className="market-ticker-label">Catalogue</span>
          <span className="market-ticker-value">{eraFiltered.length.toLocaleString()} players</span>
        </div>
        <div className="market-ticker-sep" aria-hidden="true" />
        <div className="market-ticker-item">
          <span className="market-ticker-label">Live sales this session</span>
          <span className="market-ticker-value">{liveSales.length}</span>
        </div>
        <div className="market-ticker-sep" aria-hidden="true" />
        <div className="market-ticker-item">
          <span className="market-ticker-label">Top sale this session</span>
          <span className="market-ticker-value accent">{topSaleOverall != null ? `${topSaleOverall}c` : "—"}</span>
        </div>
      </div>

      <div className="market-filterbar">
        <div className="market-era-pills">
          {ERA_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`market-pill ${era === opt.value ? "active" : ""}`}
              onClick={() => setEra(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="market-franchise-chip">
          <TeamDropdown
            options={teamOptions}
            value={team}
            onChange={setTeam}
            placeholder={indexLoading ? "Loading…" : "Any franchise"}
          />
        </div>
        <input
          type="search"
          className="market-search-input market-search-input-wide"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players by name…"
        />
      </div>

      <div className="market-quicktags">
        <span className="market-quicktags-label">Quick filters</span>
        {QUICK_TAGS.map((tag) => (
          <button
            key={tag.value}
            type="button"
            className={`market-tag ${positionTag === tag.value ? "active" : ""}`}
            onClick={() => setPositionTag((cur) => (cur === tag.value ? null : tag.value))}
          >
            {tag.label}
          </button>
        ))}
      </div>

      {isBrowsing && (
        <div className="market-results">
          <span className="market-filter-label">
            {indexLoading
              ? "Loading the player pool…"
              : `${searchResults.length} player${searchResults.length === 1 ? "" : "s"}${team ? ` on ${team}` : " match"}`}
          </span>
          {!indexLoading && searchResults.length === 0 && (
            <p className="hint-text">No players match this filter.</p>
          )}
          {!indexLoading && shownResults.length > 0 && (
            <ul className="market-results-list">
              {shownResults.map((p) => (
                <li key={p.id}>
                  <button type="button" className="market-result-row" onClick={() => jumpToPlayer(p.id)}>
                    <TeamBadge abbreviation={p.team} size={24} />
                    <span className="market-result-name">{p.fullName}</span>
                    <span className="market-result-meta">
                      {p.position || "N/A"}
                      {p.pointsPerGame ? ` · ${p.pointsPerGame.toFixed(1)} PPG` : ""} ·{" "}
                      {p.draftYear ? `Drafted ${p.draftYear}` : "Undrafted"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchResults.length > SEARCH_RESULTS_LIMIT && (
            <p className="hint-text">
              Showing {SEARCH_RESULTS_LIMIT} of {searchResults.length}. Narrow your search to see more.
            </p>
          )}
        </div>
      )}

      {playerId && selectedMeta && (
        <motion.div key={playerId} className="market-grid" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          <div className="market-grid-main">
            <div
              className="market-dossier"
              style={teamColors ? { "--team-primary": teamColors.primary, "--team-secondary": teamColors.secondary } : undefined}
            >
              <div className="market-dossier-photo">
                <PlayerHeadshot
                  nbaPlayerId={selectedMeta.id}
                  photoUrl={stats?.photoUrl}
                  alt={selectedMeta.fullName}
                  className="market-dossier-img"
                />
                <span className="market-dossier-featured">
                  <span className="market-pulse-dot" aria-hidden="true" />
                  Featured
                </span>
                <div className="market-dossier-photo-footer">
                  <TeamBadge abbreviation={selectedMeta.team} size={22} />
                  <span>{selectedMeta.team}</span>
                </div>
              </div>

              <div className="market-dossier-info">
                <div className="market-dossier-badges">
                  <span className="market-badge">{selectedMeta.position || "N/A"}</span>
                  <span className="market-badge">
                    {selectedMeta.draftYear ? `Drafted ${selectedMeta.draftYear}` : "Undrafted"}
                  </span>
                  {selectedMeta.gamesPlayed != null && (
                    <span className="market-badge accent">{selectedMeta.gamesPlayed.toLocaleString()} career GP</span>
                  )}
                </div>

                <h1 className="market-dossier-name">
                  <TeamBadge abbreviation={selectedMeta.team} size={28} />
                  <PlayerNameLink nbaPlayerId={selectedMeta.id} name={selectedMeta.fullName} />
                </h1>
                <p className="market-dossier-meta">
                  {selectedMeta.position || "N/A"} · {selectedMeta.team} ·{" "}
                  {selectedMeta.draftYear ? `Drafted ${selectedMeta.draftYear}` : "Undrafted"}
                </p>
                {stats?.teamHistory?.length > 1 && (
                  <p className="market-dossier-meta player-team-history">
                    Career teams: {stats.teamHistory.map((t) => t.abbreviation).join(", ")}
                  </p>
                )}

                {statsLoading && <p className="player-stats loading">Loading stats…</p>}
                {stats?.unavailable && !statsLoading && (
                  <p className="player-stats loading">Stats unavailable for this player.</p>
                )}
                {stats && !stats.unavailable && !statsLoading && <StatHighlightRow stats={stats} />}

                <div className="market-dossier-archetype-row">
                  {stats && !stats.unavailable && !statsLoading && (
                    <StatRadarChart stats={stats} color={teamColors?.primary} />
                  )}
                  <div className="market-dossier-difficulty">
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
                </div>

                <div className="market-dossier-value-row">
                  <div className="market-dossier-value-block">
                    <span className="market-filter-label">Suggested market value</span>
                    <span className="market-dossier-value">
                      {valueHistory.length ? `~${valueHistory[valueHistory.length - 1].value.toFixed(1)}c` : "N/A"}
                    </span>
                    {valueChange && Math.abs(valueChange.delta) >= 0.05 && (
                      <span className={`market-value-change ${valueChange.delta > 0 ? "up" : "down"}`}>
                        {valueChange.delta > 0 ? "▲" : "▼"} {valueChange.delta > 0 ? "+" : ""}
                        {valueChange.delta.toFixed(1)} vs. {valueChange.fromLabel}
                      </span>
                    )}
                  </div>
                  {onNavigateToLobby && (
                    <button type="button" className="market-cta" onClick={onNavigateToLobby}>
                      Start a draft to bid
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Mounted for its real fetch + explanation tooltip; onPredictedPrice
                feeds the value block and chart above, onSimilarPlayerClick
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
              <div className="market-panel-header">
                <h4 className="market-panel-title">Suggested value over time</h4>
                <p className="market-panel-subtitle">
                  Real readings recorded this session, one per difficulty switch or player load.
                </p>
              </div>
              <ValueHistoryChart points={valueHistory} />
            </div>

            <div className="market-panel">
              <div className="market-panel-header">
                <h4 className="market-panel-title">Similar player assets</h4>
                <span className="market-panel-kicker">Market comparables</span>
              </div>
              <SimilarPlayersGrid playerId={playerId} index={index} onJump={jumpToPlayer} />
            </div>
          </div>

          <div className="market-grid-side">
            <div className="market-panel market-livebids-panel">
              <div className="market-panel-header">
                <h4 className="market-panel-title">Live bids on this player</h4>
                <span className="market-live-chip">
                  <span className="market-pulse-dot" aria-hidden="true" />
                  Streaming
                </span>
              </div>
              {salesForPlayer.length === 0 ? (
                <p className="hint-text">
                  No completed bids on {selectedMeta.fullName} yet this session. This fills in live as any room,
                  anywhere, wins them.
                </p>
              ) : (
                <ul className="market-sale-list">
                  {salesForPlayer.map((s, i) => (
                    <li key={`${s.roomCode}-${s.at}-${i}`} className="market-sale-row">
                      <span className="market-sale-time-chip">{timeAgo(s.at)}</span>
                      <span className="market-sale-meta">Room {s.roomCode}</span>
                      <span className="market-sale-right">
                        <span className="market-sale-price">{s.price}c</span>
                        <span className="market-sale-status">Sold</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {highestLiveBid != null && (
                <p className="hint-text market-sale-summary">
                  Highest real sale this session: <strong>{highestLiveBid}c</strong>
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** The Stitch mock's "Similar Player Assets" grid: same real k-NN endpoint
 * AlternativesPanel always used, styled as a card grid instead of a list,
 * enriched with each comparable's real team/position/PPG from the already-
 * loaded market index (the /similar endpoint itself only returns id/name/
 * distance) so each card can carry a team logo next to the name, matching
 * the rest of this tab. */
function SimilarPlayersGrid({ playerId, index, onJump }) {
  const [similar, setSimilar] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSimilar([]);
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
        if (!cancelled) setSimilar(withValues);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (loading) return <p className="hint-text">Loading comparables…</p>;
  if (similar.length === 0) return <p className="hint-text">No close statistical matches found.</p>;

  return (
    <div className="market-similar-grid">
      {similar.map((p) => {
        const meta = index.find((entry) => String(entry.id) === String(p.id));
        return (
          <button key={p.id} type="button" className="market-similar-card" onClick={() => onJump(p.id)}>
            <div className="market-similar-top">
              <span className="market-similar-pos">{meta?.position || "—"}</span>
              <span className="market-similar-value">{p.predictedPrice != null ? `~${p.predictedPrice.toFixed(1)}c` : "N/A"}</span>
            </div>
            <span className="market-similar-name">
              <TeamBadge abbreviation={meta?.team} size={18} />
              {p.fullName}
            </span>
            <span className="market-similar-meta">
              {meta?.team || "—"}
              {meta?.pointsPerGame ? ` · ${meta.pointsPerGame.toFixed(1)} PPG` : ""}
            </span>
            <span className="market-similar-btn">View player</span>
          </button>
        );
      })}
    </div>
  );
}
