"""Fallback player photos for players NBA's own CDN has no real headshot
for. This is a confirmed, permanent gap for many older/short-career
players, not fixable with a different NBA URL: nothing anywhere has a real
photo of them.

Wikipedia/Wikimedia Commons is a genuinely independent source with real
coverage for a meaningful slice of "old but still known" retired players
(not everyone; an extremely obscure one-season player may have nothing
anywhere).
"""

import requests

WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php"
REQUEST_HEADERS = {"User-Agent": "HoopBids/1.0 (https://github.com/Gaarbra/nba-auction-draft)"}
REQUEST_TIMEOUT = 10

# NBA's own transparent-cutout CDN -- a real floating headshot with no
# background fill, not the small rectangular studio-photo-on-a-gray-box
# version (ak-static.cms.nba.com's 260x190 set, used here until this was
# swapped). 200 with a real photo when NBA has one; 200 with a generic
# filler image otherwise -- unlike the old host, it never 403s for a player
# it lacks, so "has a real photo" can't be read off the status code alone.
# It CAN be read off Content-Length: verified live, every filler response
# for a made-up/missing id came back as the exact same 12,430-byte image,
# while every real photo checked was 180KB+. HAS_PHOTO_MIN_BYTES sits
# comfortably between the two with real margin on both sides.
NBA_HEADSHOT_URL = "https://cdn.nba.com/headshots/nba/latest/1040x760/{player_id}.png"
HAS_PHOTO_MIN_BYTES = 30_000


def has_nba_headshot(player_id):
    """True if NBA's CDN actually has a real photo for this player (see
    HAS_PHOTO_MIN_BYTES above for how that's told apart from the generic
    filler). Just a plain HEAD request, no image bytes downloaded. Only
    meant to be called from an offline warm script (see warm_photos.py),
    never on a live request path."""
    try:
        resp = requests.head(NBA_HEADSHOT_URL.format(player_id=player_id), timeout=REQUEST_TIMEOUT, allow_redirects=True)
        if resp.status_code != 200:
            return False
        content_length = resp.headers.get("content-length")
        return content_length is not None and int(content_length) >= HAS_PHOTO_MIN_BYTES
    except (requests.RequestException, ValueError):
        # Treat a network hiccup (or a missing/unparseable header) as
        # "unknown, assume it has one" rather than triggering an
        # unnecessary Wikipedia lookup. A real miss will just get caught
        # on a later warm run.
        return True


def find_wikipedia_photo(full_name):
    """Best-effort Wikipedia photo lookup for a player NBA has no headshot
    for. Returns an image URL, or None if nothing turned up. It never raises;
    a lookup failure just means "no fallback photo either," same as any
    other "couldn't find this" case elsewhere in this app.

    Search is deliberately scoped with "basketball player" appended to the
    query (not just the bare name) so Wikipedia's own relevance ranking
    does the disambiguation work for a common name shared with an
    unrelated, more-famous person. Full-text search naturally favors the
    page whose content actually matches those extra terms.

    One consolidated request (search plus the matched page's thumbnail, via
    generator=search) instead of two separate ones, which halves the request
    count across a multi-thousand-player batch. A content-based check (does
    the page mention "basketball"/"NBA") was considered and rejected: tested
    against the same degenerate case below, it would have happily accepted
    Wikipedia's own general "Basketball" article, which obviously mentions
    basketball constantly. Matching the searched name against the returned
    page's TITLE is the check that actually catches that. An empty/garbage
    name matched "Basketball" (or, in another run, Steph Curry's page) with
    zero relevance to the real query; a real player's name should always
    appear in their own page's title. Not bulletproof (a wrong match is
    still possible for an unlucky same-name collision), but a reasonable,
    low-effort disambiguation given this only ever runs offline in a batch
    script, with a human able to spot-check the result before it ships."""
    try:
        resp = requests.get(
            WIKIPEDIA_API_URL,
            params={
                "action": "query",
                "generator": "search",
                "gsrsearch": f"{full_name} basketball player",
                "gsrlimit": 1,
                "prop": "pageimages",
                "pithumbsize": 400,
                "format": "json",
            },
            timeout=REQUEST_TIMEOUT,
            headers=REQUEST_HEADERS,
        )
        resp.raise_for_status()
        pages = resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            title = page.get("title", "")

            # Sanity check: see docstring above for why this exists and why
            # a basketball/NBA content check wouldn't be enough on its own.
            name_words = {w.lower() for w in full_name.split() if len(w) > 1}
            title_words = {w.lower().strip("()") for w in title.split()}
            if not name_words or not (name_words & title_words):
                return None

            thumbnail = page.get("thumbnail", {}).get("source")
            return thumbnail or None
        return None
    except (requests.RequestException, ValueError, KeyError):
        return None
