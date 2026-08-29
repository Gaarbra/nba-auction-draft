// Synthesized (Web Audio API) sound effects for the nomination roll — a
// quick tick on each name-flip while rolling, and a short chime when it
// lands on a real player. Generated in-browser rather than played from an
// audio file, so there's nothing to download or license.
const MUTE_KEY = "hoop-bids:sound-muted";

let audioCtx = null;

function getAudioContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  // Browsers start contexts suspended until a user gesture — any bid/pass/
  // nominate click that got us here already counts as one, so this resume
  // is normally a same-tick no-op, not something the user has to notice.
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function isSoundMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setSoundMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "true" : "false");
  } catch {
    // Storage unavailable — the toggle just won't survive a refresh.
  }
}

/** A short, dry tick — one per name-flip while the roll is spinning. */
export function playRollTick() {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 700;
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

/** A brighter three-note chime when the roll lands on a real player. */
export function playRollSelectChime() {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  [660, 880, 1100].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = ctx.currentTime + i * 0.07;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}
