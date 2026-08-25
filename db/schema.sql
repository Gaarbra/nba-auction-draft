-- Hoop Bids relational schema.
--
-- Two halves, owned by two different services (matching the app's existing
-- boundaries — stats-service already owns NBA player data, the Node server
-- already owns room/draft logic):
--
--   Reference data (written by stats-service, in Python):
--     players, player_stats, player_team_stints
--
--   Generated data (written by the Node server, once a draft completes):
--     drafts, draft_teams, draft_picks
--
-- The generated half is the more interesting one to query: every completed
-- draft records what each player was auctioned for (draft_picks.acquired_for)
-- next to how that player actually performed (draft_picks.op_score /
-- dir_score, or joined back to player_stats for their real career line) —
-- that's a real "did people over/underpay" analysis, not just a cache dump.

CREATE TABLE IF NOT EXISTS players (
    id              INTEGER PRIMARY KEY,        -- NBA person id (stats.nba.com), not a surrogate key
    full_name       TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT FALSE,
    from_year       INTEGER,
    to_year         INTEGER,
    draft_year      INTEGER,
    position        TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per player: their career-aggregate line, refreshed whenever
-- stats-service (re)fetches them (see fetch_stats_for_player in app.py).
-- Split out from `players` because it's a different rate of change — the
-- player's identity is essentially permanent, their stat line gets
-- re-derived every time the cache refreshes.
CREATE TABLE IF NOT EXISTS player_stats (
    player_id           INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    first_season        TEXT,
    last_season         TEXT,
    seasons_played      INTEGER,
    games_played        INTEGER,
    points_per_game     NUMERIC(5, 1),
    rebounds_per_game   NUMERIC(5, 1),
    assists_per_game    NUMERIC(5, 1),
    steals_per_game     NUMERIC(5, 1),
    blocks_per_game     NUMERIC(5, 1),
    fga_per_game        NUMERIC(5, 1),
    fta_per_game        NUMERIC(5, 1),
    tov_per_game        NUMERIC(5, 1),
    minutes_per_game    NUMERIC(5, 1),
    last_team           TEXT,                   -- last real team suited up for
    most_played_team    TEXT,                   -- career-high games-played team (used for branding on retired players)
    usage_pct           NUMERIC(5, 1),           -- real USG% for their last qualifying season, when available (see fetch_usage_pct)
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per team a player suited up for, with career games played on that
-- team — the normalized form of stats-service's teamHistory list. Lets you
-- do things like "career games played by team" or "which team did this
-- player play the most for" as a real query instead of app-side logic.
CREATE TABLE IF NOT EXISTS player_team_stints (
    id              SERIAL PRIMARY KEY,
    player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team            TEXT NOT NULL,
    games_played    INTEGER NOT NULL,
    UNIQUE (player_id, team)
);

CREATE INDEX IF NOT EXISTS idx_player_team_stints_player_id ON player_team_stints(player_id);

-- One row per completed draft (a room that reached status "complete").
CREATE TABLE IF NOT EXISTS drafts (
    id                      SERIAL PRIMARY KEY,
    room_code               TEXT NOT NULL,
    era                     TEXT NOT NULL,          -- e.g. "all", "1990s", "active"
    difficulty              TEXT,                    -- "easy" | "normal" | "hard"
    allow_position_swaps    BOOLEAN NOT NULL DEFAULT FALSE,
    is_local                BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per participant's finished team in a draft.
CREATE TABLE IF NOT EXISTS draft_teams (
    id                      SERIAL PRIMARY KEY,
    draft_id                INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    player_name             TEXT NOT NULL,           -- the app's players are anonymous (no accounts), so this is a display name, not a user id
    rank                    INTEGER NOT NULL,
    final_score             NUMERIC(8, 2) NOT NULL,
    sum_usage_pct           NUMERIC(6, 2) NOT NULL,
    synergy_multiplier      NUMERIC(4, 2) NOT NULL,
    forfeited               BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_draft_teams_draft_id ON draft_teams(draft_id);

-- One row per filled roster slot (5 per team). player_id is nullable — a
-- forfeited team can finish with empty slots, and very old/obscure players
-- occasionally aren't in the `players` table at all if their stats were
-- never fetched.
CREATE TABLE IF NOT EXISTS draft_picks (
    id                      SERIAL PRIMARY KEY,
    draft_team_id           INTEGER NOT NULL REFERENCES draft_teams(id) ON DELETE CASCADE,
    player_id               INTEGER REFERENCES players(id),
    slot                    TEXT NOT NULL,           -- PG | SG | SF | PF | C
    acquired_for            INTEGER,                 -- auction price paid, in coins
    op_score                NUMERIC(6, 2),
    dir_score                NUMERIC(6, 2),
    total_score             NUMERIC(6, 2),
    usage_pct_estimated     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_draft_picks_draft_team_id ON draft_picks(draft_team_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_player_id ON draft_picks(player_id);
