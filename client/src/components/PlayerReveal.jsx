import PlayerHeadshot from "./PlayerHeadshot.jsx";
import { getTeamLogoUrl } from "../teamLogos.js";
import { getTeamColors } from "../teamColors.js";

// Paper storyboard: suspense, team logo, then the settled portrait.
// CSS owns the sequence so bidding and assignment never wait on a timer.
export default function PlayerReveal({ player, className = "" }) {
  const logo = getTeamLogoUrl(player.team?.abbreviation);
  const colors = getTeamColors(player.team?.abbreviation);
  return (
    <div className={`player-reveal ${className}`} style={{ "--reveal-color": colors.primary }}>
      <span className="player-reveal-suspense" aria-hidden="true"><span />Revealing</span>
      {logo && <img className="player-reveal-logo" src={logo} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
      <div className="player-reveal-portrait">
        <PlayerHeadshot nbaPlayerId={player.nbaPlayerId} photoUrl={player.stats?.photoUrl} alt={player.fullName} />
      </div>
    </div>
  );
}
