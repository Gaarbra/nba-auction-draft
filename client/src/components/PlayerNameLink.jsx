import { nbaStatsUrl } from "../nbaLinks.js";

// Renders plain text when there's no nbaPlayerId to link to (unavailable
// stats), rather than a dead link. stopPropagation matters here — this gets
// nested inside clickable roster slots/cards, and a click on the name
// should open the stats page, not also trigger whatever the parent does.
export default function PlayerNameLink({ nbaPlayerId, name, className }) {
  const url = nbaStatsUrl(nbaPlayerId);
  if (!url) return <span className={className}>{name}</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(e) => e.stopPropagation()}
      title="View on NBA.com/stats"
    >
      {name}
    </a>
  );
}
