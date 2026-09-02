import { Filter } from "bad-words";

// One shared instance — bad-words builds its word-boundary regex once at
// construction time, no reason to redo that per call.
const filter = new Filter();

/**
 * True if `name` contains profanity or slurs the "bad-words" library's
 * (community-maintained, actively updated) word list catches. Used
 * anywhere a player picks their own display name — room:create, room:join,
 * room:create-local — since those names show up unmoderated in places
 * other people see immediately: the public room list, in-room player
 * lists, chat headers. Not perfect (no filter is), but real coverage
 * where there was previously none at all.
 */
export function containsProfanity(name) {
  try {
    return filter.isProfane(name);
  } catch {
    // A filter bug should never be the reason someone can't join a room —
    // fail open (treat as clean) rather than block on our own error.
    return false;
  }
}
