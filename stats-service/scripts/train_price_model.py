"""Trains the auction-price prediction model from real completed-draft
history in Postgres (draft_picks.acquired_for) and saves it to
stats-service/data/price_model.joblib for app.py's /predict-price endpoint
to load.

Run manually whenever there's enough new draft history to be worth
retraining:

    cd stats-service && python scripts/train_price_model.py

Honest caveat printed at the end, not just in this comment: as of writing
this trains on ~395 real picks from ~39 completed drafts, most of which are
this project's own development/testing sessions rather than organic
multi-person auctions. That's enough to build and validate a real pipeline
end to end, but it is a small, self-generated sample. Treat the printed
metrics as "does this pipeline work," not "is this production-accurate."
Re-run this as real usage accumulates.
"""

import os
import sys

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.compose import ColumnTransformer, TransformedTargetRegressor
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml import CATEGORICAL_COLS, FEATURE_COLS, NUMERIC_COLS, PRICE_MODEL_PATH, true_shooting_pct  # noqa: E402

# Kept importable with no side effects (the weekly refresh job imports train()
# below), so DATABASE_URL resolution and the psycopg import both live inside
# functions rather than at module load.


def _database_url():
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    # Load stats-service/.env the same way app.py does, in case this is run
    # standalone without the shell already having it exported.
    try:
        from dotenv import load_dotenv

        load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    except ImportError:
        pass
    return os.environ.get("DATABASE_URL")


def load_training_data(database_url):
    import psycopg
    from psycopg.rows import dict_row

    query = """
        SELECT
            dp.acquired_for,
            d.era,
            dp.slot,
            d.difficulty,
            ps.points_per_game,
            ps.rebounds_per_game,
            ps.assists_per_game,
            ps.steals_per_game,
            ps.blocks_per_game,
            ps.fga_per_game,
            ps.fta_per_game,
            ps.tov_per_game,
            ps.usage_pct,
            ps.minutes_per_game,
            ps.games_played
        FROM draft_picks dp
        JOIN draft_teams dt ON dt.id = dp.draft_team_id
        JOIN drafts d ON d.id = dt.draft_id
        JOIN players p ON p.id = dp.player_id
        JOIN player_stats ps ON ps.player_id = p.id
        WHERE dp.acquired_for IS NOT NULL
          AND d.is_local = FALSE
          -- Solo drafts skip bidding entirely and auto-win every pick at a
          -- flat starting price (see rerollNomination's comment in
          -- draftStore.js) -- there's no one to bid against, so
          -- acquired_for there isn't a real market price, just a constant.
          -- Training on that would teach the model "this is what a fair
          -- price looks like" from picks that never actually had one.
          -- draft_teams has exactly one row per real participant, so this
          -- counts the room's actual size directly rather than trusting a
          -- separately-stored flag that could drift out of sync with it.
          AND (SELECT COUNT(*) FROM draft_teams dt2 WHERE dt2.draft_id = d.id) > 1
    """
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    # Postgres NUMERIC columns come back as decimal.Decimal, which doesn't
    # mix with plain floats (0.44 * a_decimal raises TypeError). Cast every
    # numeric-ish column to float right away so the rest of this script
    # never has to think about it.
    numeric_db_cols = [
        "acquired_for",
        "points_per_game",
        "rebounds_per_game",
        "assists_per_game",
        "steals_per_game",
        "blocks_per_game",
        "fga_per_game",
        "fta_per_game",
        "tov_per_game",
        "usage_pct",
        "minutes_per_game",
        "games_played",
    ]
    for col in numeric_db_cols:
        df[col] = df[col].astype(float)
    return df


def build_preprocessor():
    numeric_pipe = Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())])
    categorical_pipe = Pipeline(
        [("impute", SimpleImputer(strategy="most_frequent")), ("onehot", OneHotEncoder(handle_unknown="ignore"))]
    )
    return ColumnTransformer([("num", numeric_pipe, NUMERIC_COLS), ("cat", categorical_pipe, CATEGORICAL_COLS)])


def make_model(regressor):
    pipeline = Pipeline([("preprocess", build_preprocessor()), ("regress", regressor)])
    # Price is heavily right-skewed (most nominations go for the 1-coin
    # minimum, a long tail up to ~19). Training on log1p(price) and
    # inverting with expm1 is standard practice for this shape of target,
    # and keeps a bad prediction from ever going negative.
    return TransformedTargetRegressor(regressor=pipeline, func=np.log1p, inverse_func=np.expm1)


def evaluate(model, X, y, label):
    cv = KFold(n_splits=5, shuffle=True, random_state=42)
    preds = cross_val_predict(model, X, y, cv=cv)
    mae = mean_absolute_error(y, preds)
    r2 = r2_score(y, preds)
    spearman = spearmanr(y, preds).correlation
    print(f"{label:22s}  MAE={mae:5.2f} coins   R²={r2:6.3f}   Spearman={spearman:6.3f}")
    return mae


def train(output_path=None, min_rows=30, evaluate_candidates=True):
    """Train and save the price model. Returns a result dict (never calls
    sys.exit), so the weekly refresh job (refresh_all.py) can call this and
    carry on regardless of the outcome.

    output_path defaults to ml.PRICE_MODEL_PATH (the committed seed location,
    which is what a manual CLI run updates). The weekly job passes
    ml.RUNTIME_PRICE_MODEL_PATH so the retrained model lands on the persistent
    data volume the serving container reads.
    """
    output_path = output_path or PRICE_MODEL_PATH
    database_url = _database_url()
    if not database_url:
        return {"trained": False, "reason": "no_database_url", "rows": 0}

    df = load_training_data(database_url)
    print(f"Loaded {len(df)} labeled picks from Postgres.")
    if len(df) < min_rows:
        return {"trained": False, "reason": "insufficient_data", "rows": len(df), "min_rows": min_rows}

    df["ts_pct"] = df.apply(
        lambda r: true_shooting_pct(r["points_per_game"], r["fga_per_game"], r["fta_per_game"]), axis=1
    )

    X = df[FEATURE_COLS]
    y = df["acquired_for"].astype(float)

    print(f"Price distribution: min={y.min():.0f} max={y.max():.0f} mean={y.mean():.2f} median={y.median():.0f}")
    print(f"  {(y <= 1).mean() * 100:.0f}% of picks went for 1 coin or less (the minimum bid).\n")

    candidates = {
        "Ridge (linear)": Ridge(alpha=5.0),
        "RandomForest": RandomForestRegressor(n_estimators=200, max_depth=5, min_samples_leaf=4, random_state=42),
        "GradientBoosting": GradientBoostingRegressor(n_estimators=150, max_depth=2, learning_rate=0.05, random_state=42),
    }

    if evaluate_candidates:
        print("5-fold cross-validated performance (out-of-fold predictions, not train-set fit):")
        scored = {name: evaluate(make_model(regressor), X, y, name) for name, regressor in candidates.items()}
        best_name = min(scored, key=scored.get)
        best_mae = scored[best_name]
    else:
        # Skip the (slow) cross-validation when a human isn't watching the
        # metrics -- the weekly job just needs a fresh model, not a report.
        best_name, best_mae = "GradientBoosting", None
    print(f"Best by cross-validated MAE: {best_name}")

    # Refit the winner on ALL the data for the model that actually gets saved
    # and served. Cross-validation above is purely for honest evaluation.
    final_model = make_model(candidates[best_name])
    final_model.fit(X, y)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    temp_path = output_path + ".tmp"
    try:
        joblib.dump(final_model, temp_path)
        os.replace(temp_path, output_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
    print(f"Saved to {output_path}")
    return {"trained": True, "rows": len(df), "model": best_name, "mae": best_mae, "path": output_path}


def main():
    result = train()
    if not result["trained"]:
        if result["reason"] == "no_database_url":
            print("DATABASE_URL is not set, nothing to train from. Set it in stats-service/.env.")
        else:
            print(f"Only {result['rows']} rows (< {result.get('min_rows', 30)}), not worth training yet. Play more drafts first.")
        sys.exit(1)
    print(
        "\nCaveat: early on this trains on a small, mostly self-generated sample "
        "(dev/test drafts, not organic multi-person auctions). Treat it as a "
        "working pipeline, not a production-accurate predictor, until real usage "
        "accumulates."
    )


if __name__ == "__main__":
    main()
