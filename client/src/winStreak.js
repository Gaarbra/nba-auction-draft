// Browser-local win streak, no accounts/backend involved (see the app's
// no-accounts privacy stance). Keyed on room code so returning to an
// already-scored results screen (a re-render, or navigating back) doesn't
// double-count the same draft.
const KEY = "hoopbids_win_streak";

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { current: 0, lastRoomCode: null };
  } catch {
    return { current: 0, lastRoomCode: null };
  }
}

export function getStreak() {
  return read().current;
}

/** Call once per completed draft with whether the local player finished 1st. */
export function recordDraftResult(roomCode, won) {
  const state = read();
  if (state.lastRoomCode === roomCode) return state.current;
  const current = won ? state.current + 1 : 0;
  try {
    localStorage.setItem(KEY, JSON.stringify({ current, lastRoomCode: roomCode }));
  } catch {
    // Storage unavailable (private browsing, quota) -- streak just won't persist.
  }
  return current;
}
