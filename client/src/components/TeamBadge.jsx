import { useEffect, useState } from "react";
import { getTeamColors } from "../teamColors.js";
import { getTeamLogoUrl } from "../teamLogos.js";

/** A team-identity chip. Prefers the real logo (hotlinked from the NBA's own
 * CDN via teamLogos.js, era-adaptive through that file's relocation/rename
 * map -- see its comments for exactly what "adaptive" does and doesn't
 * cover) and falls back to colored initials built from the app's own
 * teamColors.js whenever there's no confident logo mapping for that
 * abbreviation (an unmapped historical code) or the image itself fails to
 * load -- same "never a broken image, just degrade" contract as
 * PlayerHeadshot.jsx. */
export default function TeamBadge({ abbreviation, size = 28 }) {
  const logoUrl = getTeamLogoUrl(abbreviation);
  const [imgFailed, setImgFailed] = useState(false);

  // A new abbreviation (switching players) deserves a fresh attempt even if
  // a previous one failed to load.
  useEffect(() => {
    setImgFailed(false);
  }, [logoUrl]);

  if (!abbreviation) return null;

  if (logoUrl && !imgFailed) {
    // Padding as a pixel value derived from `size`, not a CSS percentage --
    // percentage padding resolves against the *containing block's* width,
    // not this badge's own (a badge sitting in a wide card would get a
    // padding many times its own size, squeezing the logo down to nothing).
    const inset = Math.round(size * 0.12);
    return (
      <span className="team-badge team-badge-logo" style={{ width: size, height: size, padding: inset }} title={abbreviation}>
        <img src={logoUrl} alt={abbreviation} onError={() => setImgFailed(true)} />
      </span>
    );
  }

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
