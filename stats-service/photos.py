"""Fallback player photos for players NBA's own CDN doesn't have a real
headshot for — confirmed empirically (see stats-service/scripts/
warm_photos.py's module docstring) that this is a real, permanent gap for
a lot of older/short-career players, not something fixable by finding a
different NBA URL: NBA's "latest" headshot set (the only one this app used
before) 403s for players it has no photo of, and an alternate NBA CDN host
serves back a generic byte-identical placeholder under a 200 instead of
erring, rather than either of them having a real photo hiding somewhere.

Wikipedia/Wikimedia Commons is a genuinely different, independently-
maintained source with real coverage for a lot of these — not everyone (an
extremely obscure one-season player may have nothing anywhere), but a
meaningfully large slice of "old but still known" retired players.
"""

import requests

WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php"
REQUEST_HEADERS = {"User-Agent": "HoopBids/1.0 (https://github.com/Gaarbra/nba-auction-draft)"}
REQUEST_TIMEOUT = 10

# NBA's own CDN for real headshots — this app's original (and still primary,
# fast, no-lookup-needed) source. 403 for a player it has no photo of; 200
# with a real image otherwise. Deliberately NOT the alternate cdn.nba.com
# host: that one returns 200 with a generic filler image for a missing
# photo instead of erring, which would make "no photo" indistinguishable
# from "has a photo" using just the HTTP status.
NBA_HEADSHOT_URL = "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/{player_id}.png"


def has_nba_headshot(player_id):
    """True if NBA's CDN actually has a real photo for this player — a
    plain HEAD request, no image bytes downloaded. Only meant to be called
    from an offline warm script (see warm_photos.py), never on a live
    request path."""
    try:
        resp = requests.head(NBA_HEADSHOT_URL.format(player_id=player_id), timeout=REQUEST_TIMEOUT, allow_redirects=True)
        return resp.status_code == 200
    except requests.RequestException:
        # Treat a network hiccup as "unknown, assume it has one" rather
        # than triggering an unnecessary Wikipedia lookup — a real 403
        # will just get caught on a later warm run.
        return True


def find_wikipedia_photo(full_name):
    """Best-effort Wikipedia photo lookup for a player NBA has no headshot
    for. Returns an image URL, or None if nothing turned up (never raises
    — a lookup failure just means "no fallback photo either," same as any
    other "couldn't find this" case elsewhere in this app).

    Search is deliberately scoped with "basketball player" appended to the
    query (not just the bare name) so Wikipedia's own relevance ranking
    does the disambiguation work for a common name shared with an
    unrelated, more-famous person — full-text search naturally favors the
    page whose content actually matches those extra terms. Not bulletproof
    (a wrong match is possible for an unlucky name collision), but a
    reasonable, low-effort disambiguation given this only ever runs
    offline in a batch script, with a human able to spot-check the result
    before it ships."""
    try:
        search_resp = requests.get(
            WIKIPEDIA_API_URL,
            params={
                "action": "query",
                "list": "search",
                "srsearch": f"{full_name} basketball player",
                "format": "json",
                "srlimit": 1,
            },
            timeout=REQUEST_TIMEOUT,
            headers=REQUEST_HEADERS,
        )
        search_resp.raise_for_status()
        results = search_resp.json().get("query", {}).get("search", [])
        if not results:
            return None
        title = results[0]["title"]

        # Sanity check: the matched title has to actually share a word
        # with the name being searched for. Confirmed necessary, not just
        # theoretical — an empty/garbage name (the "basketball player"
        # boilerplate alone) matched an unrelated, simply-popular page
        # (Steph Curry's) with zero relevance to the actual query. A real
        # player's name should always appear in their own page's title;
        # this catches exactly the degenerate case where it doesn't
        # without needing a full-blown identity/biography cross-check.
        name_words = {w.lower() for w in full_name.split() if len(w) > 1}
        title_words = {w.lower().strip("()") for w in title.split()}
        if not name_words or not (name_words & title_words):
            return None

        image_resp = requests.get(
            WIKIPEDIA_API_URL,
            params={
                "action": "query",
                "titles": title,
                "prop": "pageimages",
                "format": "json",
                "pithumbsize": 400,
            },
            timeout=REQUEST_TIMEOUT,
            headers=REQUEST_HEADERS,
        )
        image_resp.raise_for_status()
        pages = image_resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            thumbnail = page.get("thumbnail", {}).get("source")
            if thumbnail:
                return thumbnail
        return None
    except (requests.RequestException, ValueError, KeyError):
        return None
