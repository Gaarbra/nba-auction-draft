"""Shared feature engineering + model I/O for the two ML features:
auction-price prediction and player-similarity search.

Centralized here on purpose — the offline training script
(scripts/train_price_model.py) and the live serving code in app.py both
import from this module rather than each defining their own feature
engineering. If those two ever drifted apart (say, the live code started
passing raw None instead of the trained-on 0-default, or a column got
renamed in one place but not the other), the model wouldn't error — it
would just silently predict garbage. One source of truth avoids that.
"""

import os

import joblib
import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
# Deliberately NOT under data/ (that whole directory is gitignored — it's
# just ephemeral caches, fine to lose). This is a real trained artifact
# that needs to survive a redeploy: Render's free web services have an
# ephemeral filesystem, so anything written to local disk at runtime is
# gone on the next restart. Committing the model file to git and shipping
# it with the code is what actually persists it there.
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
PRICE_MODEL_PATH = os.path.join(MODELS_DIR, "price_model.joblib")

# --- price model feature schema -------------------------------------------
#
# Numeric columns come straight from player_stats (training: a SQL alias per
# column; serving: extract_numeric_features below) plus a derived ts_pct.
# Missing values (pre-1974 steals/blocks, pre-1996-97 usage%) are left as
# None/NaN on purpose — the pipeline's SimpleImputer(strategy="median")
# handles them consistently at both train and serve time, rather than this
# module guessing a fill value in two different places.
NUMERIC_COLS = [
    "points_per_game",
    "rebounds_per_game",
    "assists_per_game",
    "steals_per_game",
    "blocks_per_game",
    "ts_pct",
    "usage_pct",
    "minutes_per_game",
    "games_played",
]
# Room/pick context — not derived from the player at all, but genuinely
# predictive: the same player can fetch a different price depending on how
# deep the era pool is (scarcity) and how the room's difficulty shaped who
# else was available that roll.
CATEGORICAL_COLS = ["era", "slot", "difficulty"]
FEATURE_COLS = NUMERIC_COLS + CATEGORICAL_COLS

# Prices above this are vanishingly rare in real data (see the training
# script's own printed distribution) and a raw regressor can occasionally
# extrapolate above what's actually possible (a 20-coin budget, minus at
# least 1 coin held back per remaining slot) — clip predictions into a
# sane range rather than showing someone "predicted price: 27 coins".
PRICE_CLIP_MIN = 0
PRICE_CLIP_MAX = 20


def true_shooting_pct(pts, fga, fta):
    denom = 2 * ((fga or 0) + 0.44 * (fta or 0))
    if not denom:
        return 0.0
    return (pts or 0) / denom


def extract_numeric_features(stats):
    """`stats` is the camelCase dict shape fetch_stats_for_player returns
    (or the cached equivalent) — this is what the live /predict-price
    endpoint has on hand. Returns a plain dict keyed by NUMERIC_COLS."""
    pts = stats.get("pointsPerGame") or 0
    fga = stats.get("fgaPerGame") or 0
    fta = stats.get("ftaPerGame") or 0
    return {
        "points_per_game": pts,
        "rebounds_per_game": stats.get("reboundsPerGame") or 0,
        "assists_per_game": stats.get("assistsPerGame") or 0,
        "steals_per_game": stats.get("stealsPerGame"),
        "blocks_per_game": stats.get("blocksPerGame"),
        "ts_pct": true_shooting_pct(pts, fga, fta),
        "usage_pct": stats.get("usagePct"),
        "minutes_per_game": stats.get("minutesPerGame") or 0,
        "games_played": stats.get("gamesPlayed") or 0,
    }


def build_feature_row(stats, era=None, slot=None, difficulty=None):
    """One full feature row (dict matching FEATURE_COLS) for a single live
    prediction — numeric features from the player's stats, plus this
    nomination's room context."""
    row = extract_numeric_features(stats)
    row["era"] = era or "all"
    row["slot"] = slot or "PG"
    row["difficulty"] = difficulty or "normal"
    return row


def load_price_model():
    """Returns the fitted sklearn Pipeline, or None if it hasn't been
    trained yet (run scripts/train_price_model.py) — callers must treat
    that as "no prediction available", not an error."""
    if not os.path.exists(PRICE_MODEL_PATH):
        return None
    try:
        return joblib.load(PRICE_MODEL_PATH)
    except Exception as e:
        print(f"[ml] failed to load price model: {e.__class__.__name__}: {e}")
        return None


def predict_price(model, stats, era=None, slot=None, difficulty=None):
    """Single-row prediction, clipped to a sane coin range. `model` is
    whatever load_price_model() returned — callers should skip calling this
    at all if that was None."""
    row = build_feature_row(stats, era, slot, difficulty)
    df = pd.DataFrame([row], columns=FEATURE_COLS)
    raw = float(model.predict(df)[0])
    return max(PRICE_CLIP_MIN, min(PRICE_CLIP_MAX, raw))


# --- price model explanation ------------------------------------------------
#
# What the "Suggested value" hover in the UI shows. Not a true per-prediction
# attribution — that's what a library like SHAP is for, and pulling in a
# whole extra dependency (plus its own per-request compute cost) is more
# than a hover tooltip is worth here. Instead: the model's own global
# feature_importances_ (how much each feature typically moves ITS
# predictions, learned across every training example) tells us what this
# model leans on most in general, and pairing that with this specific
# player's actual values for those features gives an honest, useful "here's
# mainly what this is based on" without overclaiming precision it doesn't
# have.
_FEATURE_DISPLAY = {
    "points_per_game": ("PPG", "{:.1f}"),
    "rebounds_per_game": ("RPG", "{:.1f}"),
    "assists_per_game": ("APG", "{:.1f}"),
    "steals_per_game": ("SPG", "{:.1f}"),
    "blocks_per_game": ("BPG", "{:.1f}"),
    "ts_pct": ("TS%", "{:.0%}"),
    "usage_pct": ("USG%", "{:.0%}"),
    "minutes_per_game": ("MPG", "{:.1f}"),
    "games_played": ("career games", "{:.0f}"),
    "era": ("era", None),
    "slot": ("slot", None),
    "difficulty": ("difficulty", None),
}


def _model_feature_importance(model):
    """Best-effort global importance per original FEATURE_COLS entry (a
    one-hot categorical like "era" gets several encoded columns inside the
    pipeline — e.g. era_2020s, era_1990s — whose weights get summed back
    into a single "era" entry here). Returns {} if the model's regressor
    doesn't expose feature_importances_/coef_, or if the pipeline's
    internals don't match what train_price_model.py builds (display-only —
    never worth this failing serving over)."""
    try:
        pipeline = model.regressor_  # TransformedTargetRegressor -> fitted inner Pipeline
        preprocessor = pipeline.named_steps["preprocess"]
        regressor = pipeline.named_steps["regress"]

        raw = getattr(regressor, "feature_importances_", None)
        if raw is None:
            coef = getattr(regressor, "coef_", None)
            if coef is None:
                return {}
            raw = np.abs(np.ravel(coef))  # a linear model's |coefficient| stands in for "importance"

        totals = {}
        for name, weight in zip(preprocessor.get_feature_names_out(), raw):
            base = name.split("__", 1)[-1]  # "num__points_per_game" -> "points_per_game"
            for col in FEATURE_COLS:
                if base == col or base.startswith(col + "_"):  # one-hot: "era_2020s" -> "era"
                    totals[col] = totals.get(col, 0.0) + float(weight)
                    break

        total = sum(totals.values())
        return {k: v / total for k, v in totals.items()} if total else {}
    except Exception:
        return {}


def explain_prediction(model, stats, era=None, slot=None, difficulty=None, top_n=4):
    """The `top_n` features this model leans on most, each paired with this
    player's actual value — what the "Suggested value" hover shows. []
    (never an error) if importance introspection isn't available."""
    importances = _model_feature_importance(model)
    if not importances:
        return []

    row = build_feature_row(stats, era, slot, difficulty)
    ranked = sorted(importances.items(), key=lambda kv: kv[1], reverse=True)[:top_n]

    explanation = []
    for col, weight in ranked:
        label, fmt = _FEATURE_DISPLAY.get(col, (col, "{}"))
        value = row.get(col)
        if value is None:
            detail = "—"
        elif fmt is None:
            detail = str(value)
        else:
            try:
                detail = fmt.format(value)
            except (ValueError, TypeError):
                detail = str(value)
        explanation.append({"label": label, "value": detail, "weight": round(weight, 3)})
    return explanation


# --- player similarity ------------------------------------------------------
#
# Deliberately a smaller, different feature set than the price model: this
# is about playing style/production, not context that affects what a room
# happened to pay. No persisted model file — it's cheap enough (a couple
# thousand players, 6 features) to rebuild from Postgres each time the
# process starts, so there's nothing to keep in sync across a retrain like
# the price model has.
SIMILARITY_COLS = [
    "points_per_game",
    "rebounds_per_game",
    "assists_per_game",
    "steals_per_game",
    "blocks_per_game",
    "ts_pct",
]


class SimilarityIndex:
    """Wraps a fitted NearestNeighbors index over standardized per-game stat
    vectors for every player with a stats row. `build` takes a list of dicts
    (player_id, full_name, points_per_game, ... — the SIMILARITY_COLS names)
    from a DB query; missing values are median-imputed same as the price
    model, so an old player missing steals/blocks doesn't just get excluded.
    """

    def __init__(self):
        self.frame = None
        self.model = None
        self.medians = None

    def build(self, rows):
        """`rows` needs player_id, full_name, and the raw per-game counting
        stats (points/rebounds/assists/steals/blocks_per_game, fga_per_game,
        fta_per_game) — see db.fetch_all_player_stats_for_similarity for the
        exact shape. ts_pct is derived here, not expected pre-computed, so
        there's exactly one place (true_shooting_pct) that formula lives."""
        if not rows:
            self.frame = None
            self.model = None
            return

        df = pd.DataFrame(rows)
        df["ts_pct"] = df.apply(
            lambda r: true_shooting_pct(r.get("points_per_game"), r.get("fga_per_game"), r.get("fta_per_game")),
            axis=1,
        )
        for col in SIMILARITY_COLS:
            if col not in df.columns:
                df[col] = np.nan

        self.medians = df[SIMILARITY_COLS].median(numeric_only=True)
        filled = df[SIMILARITY_COLS].fillna(self.medians)

        # z-score standardize so e.g. points_per_game (0-35ish) doesn't
        # dominate distance purely by having a bigger numeric range than
        # steals_per_game (0-3ish).
        means = filled.mean()
        stds = filled.std().replace(0, 1)
        standardized = (filled - means) / stds

        self.frame = df.reset_index(drop=True)
        self.model = NearestNeighbors(metric="euclidean")
        self.model.fit(standardized.values)
        self._means = means
        self._stds = stds

    def query(self, player_id, k=6):
        if self.frame is None or self.model is None:
            return []
        matches = self.frame.index[self.frame["player_id"] == player_id]
        if len(matches) == 0:
            return []
        idx = matches[0]

        row = self.frame.loc[idx, SIMILARITY_COLS].fillna(self.medians)
        standardized = ((row - self._means) / self._stds).values.reshape(1, -1)

        n_neighbors = min(k + 1, len(self.frame))
        distances, indices = self.model.kneighbors(standardized, n_neighbors=n_neighbors)

        results = []
        for dist, i in zip(distances[0], indices[0]):
            if i == idx:
                continue
            r = self.frame.loc[i]
            results.append(
                {
                    "id": int(r["player_id"]),
                    "fullName": r["full_name"],
                    "distance": float(dist),
                }
            )
        return results[:k]
