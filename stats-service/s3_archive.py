"""Archives raw stats.nba.com API responses to S3, unprocessed. Phase 2 of
the planned AWS work (see AWS_MIGRATION.md; Phase 1 was the RDS move).

Everywhere else in this app, a live nba_api response gets parsed down into
the small derived shape the product actually needs right now (career
averages, award chips, one season's USG_PCT, ...) and the rest is thrown
away. That's the right call for what's live today, but it means every
season, every stat this app doesn't currently surface, is gone the moment
it's parsed. This keeps an unprocessed copy of each response in S3, for
whatever a future model (Phase 3) might want that today's parsing doesn't
capture -- without needing to re-fetch from stats.nba.com (slow, rate
limited, and confirmed unreachable from Render/most cloud IPs) to get it.

Same best-effort shape as every other secondary system in this app (DB
persistence in db.py, the disk caches in app.py itself): configured or
not, working or not, this never breaks the primary response. Missing
bucket config or credentials just means archiving silently no-ops --
checked once with a clear log line, not a crash, and not a retry storm.
"""

import json
import os
import time

_S3_BUCKET = os.environ.get("S3_RAW_ARCHIVE_BUCKET")
_S3_REGION = os.environ.get("AWS_REGION", "us-east-1")

_client = None
_client_init_attempted = False
_warned_not_configured = False


def _get_client():
    """Lazy, cached boto3 client. boto3 is a real (if small) import cost --
    not worth paying at module load for a feature that might not even be
    configured, so the import itself lives in here, not at the top of the
    file. Credentials come from boto3's standard chain (AWS_ACCESS_KEY_ID /
    AWS_SECRET_ACCESS_KEY env vars, same `sync: false`-in-render.yaml
    pattern as DATABASE_URL), never hardcoded and never read directly by
    this module."""
    global _client, _client_init_attempted, _warned_not_configured
    if _client_init_attempted:
        return _client
    _client_init_attempted = True

    if not _S3_BUCKET:
        if not _warned_not_configured:
            print("[s3 archive] S3_RAW_ARCHIVE_BUCKET not set, raw-response archiving disabled")
            _warned_not_configured = True
        return None

    try:
        import boto3

        _client = boto3.client("s3", region_name=_S3_REGION)
    except Exception as e:
        print(f"[s3 archive] failed to init boto3 client, archiving disabled: {e.__class__.__name__}: {e}")
        _client = None
    return _client


def archive_raw_response(category, key, raw):
    """Fire-and-forget upload of one raw API response.

    `category` groups responses by endpoint ("stats", "bio", "awards",
    "usage"); `key` identifies the specific request within it -- a player
    id for the per-player endpoints, or a season string for usage (that
    endpoint returns one whole season's league-wide table per call, not a
    single player's row, so the season is what actually varies per fetch).

    Overwrites on every live fetch: this is a latest-snapshot archive, not
    a version history. That matches the disk caches elsewhere in this app
    (one entry per key, refreshed in place) and is simplest to reason
    about; if a real history of how a stat changed over time ever becomes
    worth keeping, switch to a timestamped key
    (`raw/{category}/{key}/{archivedAt}.json`) instead of changing this
    function's contract.

    Never raises. A failure here is logged and otherwise invisible to the
    caller -- archiving is strictly additive, and the product behaves
    identically whether or not it succeeds."""
    client = _get_client()
    if client is None:
        return

    try:
        body = json.dumps({"archivedAt": time.time(), "raw": raw}).encode("utf-8")
        client.put_object(
            Bucket=_S3_BUCKET,
            Key=f"raw/{category}/{key}.json",
            Body=body,
            ContentType="application/json",
        )
    except Exception as e:
        print(f"[s3 archive] failed to archive {category}/{key}: {e.__class__.__name__}: {e}")
