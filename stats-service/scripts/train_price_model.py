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
end to end, but it is a small, self-generated sample — treat the printed
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

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    # Load stats-service/.env the same way app.py does, in case this is run
    # standalone without the shell already having it exported.
    try:
        from dotenv import load_dotenv

        load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
        DATABASE_URL = os.environ.get("DATABASE_URL")
    except ImportError:
        pass

if not DATABASE_URL:
    print("DATABASE_URL is not set — nothing to train from. Set it in stats-service/.env.")
    sys.exit(1)

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402


def load_training_data():
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
            ps.usage_pct,
            ps.minutes_per_game,
            ps.games_played
        FROM draft_picks dp
        JOIN draft_teams dt ON dt.id = dp.draft_team_id
        JOIN drafts d ON d.id = dt.draft_id
        JOIN players p ON p.id = dp.player_id
        JOIN player_stats ps ON ps.player_id = p.id
        WHERE dp.acquired_for IS NOT NULL
    """
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()
    df = pd.DataFrame(rows)
    # Postgres NUMERIC columns come back as decimal.Decimal, which doesn't
    # mix with plain floats (0.44 * a_decimal raises TypeError) — cast every
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
    # minimum, a long tail up to ~19) — training on log1p(price) and
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


def main():
    df = load_training_data()
    print(f"Loaded {len(df)} labeled picks from Postgres.\n")
    if len(df) < 30:
        print("Fewer than 30 rows — not worth training on yet. Play more drafts first.")
        sys.exit(1)

    df["ts_pct"] = df.apply(
        lambda r: true_shooting_pct(r["points_per_game"], r["fga_per_game"], r["fta_per_game"]), axis=1
    )

    X = df[FEATURE_COLS]
    y = df["acquired_for"].astype(float)

    print(f"Price distribution — min={y.min():.0f} max={y.max():.0f} mean={y.mean():.2f} median={y.median():.0f}")
    print(f"  {(y <= 1).mean() * 100:.0f}% of picks went for 1 coin or less (the minimum bid).\n")

    print("5-fold cross-validated performance (out-of-fold predictions, not train-set fit):")
    candidates = {
        "Ridge (linear)": Ridge(alpha=5.0),
        "RandomForest": RandomForestRegressor(n_estimators=200, max_depth=5, min_samples_leaf=4, random_state=42),
        "GradientBoosting": GradientBoostingRegressor(n_estimators=150, max_depth=2, learning_rate=0.05, random_state=42),
    }
    scored = {}
    for name, regressor in candidates.items():
        model = make_model(regressor)
        scored[name] = evaluate(model, X, y, name)

    best_name = min(scored, key=scored.get)
    print(f"\nBest by cross-validated MAE: {best_name}")

    # Refit the winner on ALL the data for the model that actually gets
    # saved and served — cross-validation above is purely for honest
    # evaluation, not what ships.
    final_model = make_model(candidates[best_name])
    final_model.fit(X, y)

    os.makedirs(os.path.dirname(PRICE_MODEL_PATH), exist_ok=True)
    joblib.dump(final_model, PRICE_MODEL_PATH)
    print(f"Saved to {PRICE_MODEL_PATH}")

    print(
        "\nCaveat: this is trained on a small, mostly self-generated sample "
        "(this project's own dev/test drafts, not organic multi-person "
        "auctions). Treat it as a working pipeline, not a production-accurate "
        "predictor yet — re-run this script as real usage accumulates."
    )


if __name__ == "__main__":
    main()
