const PLACEHOLDER_SRC = "/player-placeholder.svg";

export default function PlayerHeadshot({ nbaPlayerId, alt, className }) {
  const src = nbaPlayerId
    ? `https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${nbaPlayerId}.png`
    : PLACEHOLDER_SRC;

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
