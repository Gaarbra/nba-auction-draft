/* The Hoop Bids mark — a coin whose face is a basketball, with a small
   medallion hub. From the Stitch "Hoop Bids Coin-Basketball Logo" asset.
   Shared by the TopNav, the lobby card, and the mobile nav. */
export default function LogoMark({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      {/* Outer coin rim with edge depth */}
      <circle cx="60" cy="60" r="54" stroke="#FF8A00" strokeWidth="4" />
      <circle
        cx="60"
        cy="60"
        r="48"
        stroke="#FF8A00"
        strokeWidth="1.5"
        strokeDasharray="3.5 2.5"
        opacity="0.85"
      />
      <circle cx="60" cy="60" r="43" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />

      {/* Basketball seams mapped across the coin face */}
      <path d="M17 60H103" stroke="#FF8A00" strokeWidth="3" strokeLinecap="round" />
      <path d="M60 17V103" stroke="#FF8A00" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M30 25C44 35 51 47 51 60C51 73 44 85 30 95"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M90 25C76 35 69 47 69 60C69 73 76 85 90 95"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Center medallion hub */}
      <circle cx="60" cy="60" r="16" fill="#131315" stroke="#FF8A00" strokeWidth="2.5" />
      <path
        d="M54 53V67M66 53V67M54 60H66"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
