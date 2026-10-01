import { getTeamLogoUrl } from "../teamLogos.js";

export default function TeamRevealBackdrop({ team, playerId }) {
  const src = getTeamLogoUrl(team);
  return src ? (
    <img key={`${team}-${playerId}`} src={src} alt="" aria-hidden="true"
      className="team-reveal-backdrop"
      onError={(event) => { event.currentTarget.style.display = "none"; }} />
  ) : null;
}
