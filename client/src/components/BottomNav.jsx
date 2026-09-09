/* Mobile-only bottom tab bar for the lobby, mirroring TopNav's own lobby
   tabs (client/src/components/TopNav.jsx). This is the ONLY way to reach
   Market or How to Play on a phone, since TopNav's own tab row is
   desktop-only (`hidden md:flex`). */

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3 3 10v11h6v-6h6v6h6V10z" />
    </svg>
  );
}
function GavelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m16 16 6-6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m8 8 6-6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m9 7 8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m21 11-8-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function HowToPlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" />
    </svg>
  );
}

const ITEMS = [
  { id: "lobby", label: "Lobby", Icon: HomeIcon },
  { id: "market", label: "Market", Icon: GavelIcon },
  { id: "how-to-play", label: "How to Play", Icon: HowToPlayIcon },
];

export default function BottomNav({ activeTab = "lobby", onTabChange }) {
  return (
    <nav className="bottom-nav" aria-label="Sections">
      {ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`bottom-nav-item ${id === activeTab ? "active" : ""}`}
          aria-current={id === activeTab ? "page" : undefined}
          onClick={() => onTabChange?.(id)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
