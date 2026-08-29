import { motion } from "motion/react";

// Career-high-ish ceilings per stat, used purely to normalize the radar's
// 0-1 axes — not a claim about the literal all-time record, just enough
// headroom that a real standout reaches close to the edge without every
// axis looking maxed out for everyone.
const AXES = [
  { key: "pointsPerGame", label: "PTS", max: 32 },
  { key: "reboundsPerGame", label: "REB", max: 24 },
  { key: "assistsPerGame", label: "AST", max: 12 },
  { key: "stealsPerGame", label: "STL", max: 3 },
  { key: "blocksPerGame", label: "BLK", max: 4 },
];

const SIZE = 168;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 26;
const ANGLE_STEP = 360 / AXES.length;

function pointAt(angleDeg, r) {
  const rad = (Math.PI / 180) * (angleDeg - 90);
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
}

/** A small 5-axis radar chart (PTS/REB/AST/STL/BLK) for a player's career per-game
 * line, drawn as raw SVG and animated in with Motion — no charting library needed
 * for something this simple, and it means the fill color can follow the player's
 * team like everything else in the app already does. */
export default function StatRadarChart({ stats, color = "#ff7a1a" }) {
  if (!stats || stats.unavailable) return null;

  const points = AXES.map((axis, i) => {
    // Steals/blocks genuinely weren't recorded before 1973-74 (see
    // defensiveImpactRating in scoring.js, which makes this same
    // distinction) — that's a real `null`, not a measured zero, so it has
    // to plot as 0 on the chart but must not print as "0" in the label,
    // which would misrepresent "never tracked" as "recorded zero".
    const raw = stats[axis.key];
    const ratio = Math.max(0, Math.min(1, (raw ?? 0) / axis.max));
    return { ...axis, raw, point: pointAt(i * ANGLE_STEP, RADIUS * ratio) };
  });
  const polygonPoints = points.map((p) => p.point.join(",")).join(" ");

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="stat-radar" role="img" aria-label="Career per-game stat radar">
      {[0.33, 0.66, 1].map((f) => (
        <polygon
          key={f}
          points={AXES.map((_, i) => pointAt(i * ANGLE_STEP, RADIUS * f).join(",")).join(" ")}
          className="stat-radar-grid"
        />
      ))}
      {AXES.map((_, i) => {
        const [x, y] = pointAt(i * ANGLE_STEP, RADIUS);
        return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} className="stat-radar-axis" />;
      })}

      <motion.polygon
        points={polygonPoints}
        fill={color}
        fillOpacity={0.32}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 190, damping: 16 }}
        style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
      />

      {points.map((p, i) => (
        <motion.circle
          key={p.key}
          cx={p.point[0]}
          cy={p.point[1]}
          r={2.75}
          fill={color}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.18 + i * 0.05, type: "spring", stiffness: 300, damping: 14 }}
        />
      ))}

      {points.map((p, i) => {
        const [x, y] = pointAt(i * ANGLE_STEP, RADIUS + 18);
        return (
          <text key={p.key} x={x} y={y - 4} textAnchor="middle" className="stat-radar-label">
            {p.label}
          </text>
        );
      })}
      {points.map((p, i) => {
        const [x, y] = pointAt(i * ANGLE_STEP, RADIUS + 18);
        return (
          <text key={`${p.key}-val`} x={x} y={y + 9} textAnchor="middle" className="stat-radar-value">
            {p.raw === null || p.raw === undefined ? "—" : p.raw}
          </text>
        );
      })}
    </svg>
  );
}
