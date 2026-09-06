import { getTeamColors } from "../teamColors.js";

/** A small team-identity chip built from real per-player team data and the
 * app's own team-color table (client/src/teamColors.js) — not the NBA's
 * actual logos. Two reasons: sourcing 30+ official team marks (correctly,
 * per era — several teams changed both name and logo across decades, e.g.
 * SEA -> OKC, NOH/NOK -> NOP, CHH -> CHA) isn't something this app can do
 * reliably, and this project already had a real trademark scare this
 * session (an AI-generated hero photo with the actual NBA logo baked into
 * it, caught and removed before shipping) — a colored initials badge gets
 * the same "which team" glance-value without that risk. Since the
 * abbreviation itself already varies correctly by era (a player's own
 * historical team code, not today's), this is "adaptable to the era" in
 * the way that actually matters here. */
export default function TeamBadge({ abbreviation, size = 28 }) {
  if (!abbreviation) return null;
  const colors = getTeamColors(abbreviation);

  return (
    <span
      className="team-badge"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        background: `linear-gradient(160deg, ${colors.primary}, color-mix(in srgb, ${colors.primary} 55%, #000))`,
        borderColor: colors.secondary,
      }}
      title={abbreviation}
    >
      {abbreviation}
    </span>
  );
}
