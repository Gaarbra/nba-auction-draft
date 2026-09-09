import { useEffect, useRef, useState } from "react";

const PLACEHOLDER_SRC = "/player-placeholder.svg";
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
// Long enough that the server-side background resolve (see
// get_fallback_photo_url in app.py) has almost always already finished by
// the time this fires. That resolve is itself usually under a couple
// seconds (one HEAD request, plus a Wikipedia search only when needed).
const RETRY_DELAY_MS = 2500;

function nbaHeadshotUrl(nbaPlayerId) {
  // The transparent-cutout set, not the small rectangular studio-photo
  // version -- a real floating headshot with no background fill, which is
  // what lets the team-color wash and the big logo behind it (see
  // DraftBoard.jsx's reveal) actually show through around the player.
  // Matches stats-service/photos.py's own NBA_HEADSHOT_URL exactly; that
  // file is what decides stats.photoUrl below, so the two have to agree
  // on which CDN set "has a real photo" even means.
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`;
}

/** `photoUrl` is an optional Wikipedia fallback (see stats-service/photos.py)
 * for players NBA's own CDN confirmed has no headshot for. Used straight
 * away, skipping a request we already know would fail.
 *
 * When photoUrl isn't given and NBA's URL fails, this player is being seen
 * for the first time anywhere; the server starts resolving a fallback in
 * the background on that same request. One retry a couple seconds later
 * usually catches it landing. `allowRetry` (see PriceTicker) skips this
 * where a couple dozen simultaneous retries would just be noise for a
 * purely decorative photo. */
export default function PlayerHeadshot({ nbaPlayerId, photoUrl, alt, className, allowRetry = true }) {
  const [src, setSrc] = useState(() => photoUrl || (nbaPlayerId ? nbaHeadshotUrl(nbaPlayerId) : PLACEHOLDER_SRC));
  const retriedRef = useRef(false);
  const mountedRef = useRef(true);

  // A new player (nbaPlayerId change) or a photoUrl that showed up after
  // this mounted (a parent re-render, not just this component's own retry)
  // both reset the attempt from scratch.
  useEffect(() => {
    setSrc(photoUrl || (nbaPlayerId ? nbaHeadshotUrl(nbaPlayerId) : PLACEHOLDER_SRC));
    retriedRef.current = false;
  }, [nbaPlayerId, photoUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        setSrc(PLACEHOLDER_SRC); // never leave a broken-image icon showing while a retry is pending

        // Only worth retrying when the server hadn't already told us the
        // answer (a photoUrl that itself 404s means the resolved fallback
        // broke, which asking again won't fix) and only once per mount.
        if (photoUrl || !allowRetry || retriedRef.current || !nbaPlayerId) return;
        retriedRef.current = true;

        setTimeout(() => {
          if (!mountedRef.current) return;
          fetch(`${SERVER_URL}/api/players/${nbaPlayerId}/photo`)
            .then((res) => res.json())
            .then((data) => {
              if (mountedRef.current && data.photoUrl) setSrc(data.photoUrl);
            })
            .catch(() => {});
        }, RETRY_DELAY_MS);
      }}
    />
  );
}
