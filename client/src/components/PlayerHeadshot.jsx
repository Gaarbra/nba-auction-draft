import { useEffect, useRef, useState } from "react";

const PLACEHOLDER_SRC = "/player-placeholder.svg";
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
// Long enough that the server-side background resolve (see
// get_fallback_photo_url in app.py) has almost always already finished by
// the time this fires — that resolve is itself usually under a couple
// seconds (one HEAD request, plus a Wikipedia search only when needed).
const RETRY_DELAY_MS = 2500;

function nbaHeadshotUrl(nbaPlayerId) {
  return `https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${nbaPlayerId}.png`;
}

/** `photoUrl` is an optional Wikipedia fallback (stats.photoUrl from
 * /stats — see stats-service/photos.py) for players NBA's own CDN
 * confirmed has no real headshot for. Used straight away, skipping the NBA
 * URL entirely, since we already know from that offline check it would
 * just fail — no point in a request that's guaranteed to error first.
 *
 * When photoUrl ISN'T given and NBA's own URL fails, that's a player being
 * seen for the very first time anywhere — nothing's been resolved for them
 * yet, but the server starts resolving it in the background the instant
 * it's asked (same request that just failed). One retry a couple seconds
 * later usually catches that resolve landing, swapping the placeholder for
 * a real photo without the viewer needing to do anything. `allowRetry`
 * (see PriceTicker) skips this for spots where a couple dozen simultaneous
 * retries would just be noise for a purely decorative photo. */
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
