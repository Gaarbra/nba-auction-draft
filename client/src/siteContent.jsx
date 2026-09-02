// Shared static page content — was inline inside Footer.jsx, extracted so
// DraftBoard's mid-draft help button (see InfoModal usage in both) can
// show the same "How to Play" content without duplicating it or forcing a
// player to leave the room to read it.
//
// Placeholder copy — a reasonable starting point for a small hobby project,
// not vetted legal text. If Hoop Bids ever collects real user data, takes
// payments, or is run as a registered business, these should be reviewed
// (or replaced) by someone qualified to write actual Privacy/Terms/Cookie
// policies for that situation.
export const PAGES = {
  howToPlay: {
    title: "How to Play",
    body: (
      <>
        <p>Hoop Bids is a fantasy-style auction draft using real NBA players from any era.</p>
        <ol>
          <li>Create a room (or play locally, pass-and-play on one device) and invite friends with the room code.</li>
          <li>The host picks a player pool (era), difficulty, and bidding style, then starts the draft.</li>
          <li>Each turn, someone nominates a random player and everyone bids coins to win them, filling one of five roster slots (PG/SG/SF/PF/C).</li>
          <li>Once every roster is full, the app scores each team from real career stats and ranks the room.</li>
        </ol>
        <p>Everyone starts with the same coin budget — spend it wisely, since a full roster needs at least 1 coin per remaining slot.</p>
      </>
    ),
  },
  privacyPolicy: {
    title: "Privacy Policy",
    body: (
      <>
        <p>
          <em>This is placeholder text for a small hobby project, not a legally reviewed policy.</em>
        </p>
        <p>Hoop Bids stores the minimum needed to run a draft: your chosen display name, room membership, and draft results, tied to your session rather than a real-world identity — there's no account system or email collection.</p>
        <p>Player statistics come from public NBA data. Draft history may be stored to power features like past-draft lookups; it is not sold or shared with third parties.</p>
        <p>Browser local storage is used only to reconnect you to a room you were already in — it never leaves your device.</p>
      </>
    ),
  },
  cookiePolicy: {
    title: "Cookie Policy",
    body: (
      <>
        <p>
          <em>Placeholder text, not a legally reviewed policy.</em>
        </p>
        <p>Hoop Bids doesn't use tracking or advertising cookies. The only browser storage used is <code>localStorage</code>, purely functional: remembering your current room so a page refresh can reconnect you, and small per-device preferences like a sound on/off toggle.</p>
        <p>None of this is used for analytics, advertising, or cross-site tracking.</p>
      </>
    ),
  },
  termsOfUse: {
    title: "Terms of Use",
    body: (
      <>
        <p>
          <em>Placeholder text, not a legally reviewed agreement.</em>
        </p>
        <p>Hoop Bids is a free, fan-made project for personal entertainment. It isn't affiliated with, endorsed by, or sponsored by the NBA or any NBA team.</p>
        <p>Play nice — no harassment, hateful names, or abuse of other players. Rooms and player data may be reset or removed at any time without notice; nothing here is guaranteed to persist.</p>
        <p>Provided "as is," with no warranty of uptime, accuracy of historical stats, or fitness for any particular purpose.</p>
      </>
    ),
  },
  contactUs: {
    title: "Contact Us",
    body: (
      <>
        <p>Found a bug, or have an idea for the app? Reach out — add your preferred contact method here (email, GitHub issues, Discord, etc.).</p>
        <p style={{ color: "var(--text-faint)" }}>(This is a placeholder — swap in a real contact channel before sharing the app widely.)</p>
      </>
    ),
  },
};
