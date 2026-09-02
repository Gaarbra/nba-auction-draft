const PLACEHOLDER_SRC = "/player-placeholder.svg";

/** `photoUrl` is an optional Wikipedia fallback (stats.photoUrl from
 * /stats — see stats-service/photos.py) for players NBA's own CDN
 * confirmed has no real headshot for. Used straight away, skipping the NBA
 * URL entirely, since we already know from that offline check it would
 * just fail — no point in a request that's guaranteed to error first. */
export default function PlayerHeadshot({ nbaPlayerId, photoUrl, alt, className }) {
  const src = photoUrl || (nbaPlayerId ? `https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${nbaPlayerId}.png` : PLACEHOLDER_SRC);

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={(e) => {
        if (e.currentTarget.dataset.fallback) return;
        e.currentTarget.dataset.fallback = "true";
        e.currentTarget.src = PLACEHOLDER_SRC;
      }}
    />
  );
}
