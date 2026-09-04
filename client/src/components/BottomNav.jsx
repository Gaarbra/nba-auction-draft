/* Mobile-only bottom tab bar for the lobby, mirroring the Stitch mock.
   Draft / Roster / Account are visual stubs — the game is a single
   pass-through flow, not a multi-section app — so only "Lobby" is live. */

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
function RosterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6.2 18.4a6 6 0 0 1 11.6 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ITEMS = [
  { label: "Lobby", Icon: HomeIcon, active: true },
  { label: "Draft", Icon: GavelIcon },
  { label: "Roster", Icon: RosterIcon },
  { label: "Account", Icon: AccountIcon },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Sections">
      {ITEMS.map(({ label, Icon, active }) => (
        <button
          key={label}
          type="button"
          className={`bottom-nav-item ${active ? "active" : ""}`}
          aria-current={active ? "page" : undefined}
          disabled={!active}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
