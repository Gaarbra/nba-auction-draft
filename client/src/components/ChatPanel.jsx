import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

const REACTIONS = ["🔥", "😭", "💯", "💔"];
const MAX_MESSAGE_LENGTH = 200;

/** Bottom-corner chat during the draft. Messages/reactions are ephemeral —
 * this only shows what arrived while mounted (see server/src/sockets/
 * roomHandlers.js's chat handlers), there's no history to fetch on open. */
export default function ChatPanel({ socket, room, currentPlayerId, messages }) {
  const [collapsed, setCollapsed] = useState(false);
  const [text, setText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, collapsed]);

  function playerName(id) {
    return room.players.find((p) => p.id === id)?.name || "Someone";
  }

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    socket.emit("chat:message", { text: trimmed, playerId: currentPlayerId }, () => {});
    setText("");
  }

  function sendReaction(emoji) {
    socket.emit("chat:reaction", { emoji, playerId: currentPlayerId }, () => {});
  }

  return (
    <div className={`chat-panel ${collapsed ? "collapsed" : ""}`}>
      <button type="button" className="chat-panel-header" onClick={() => setCollapsed((c) => !c)}>
        <span>Chat</span>
        <span className="chat-panel-toggle">{collapsed ? "▲" : "▼"}</span>
      </button>

      {!collapsed && (
        <>
          <div className="chat-panel-messages" ref={listRef}>
            {messages.length === 0 && <p className="chat-panel-empty">No messages yet — say hi.</p>}
            {messages.map((m) => (
              <p key={m.id} className="chat-panel-message">
                <strong>{playerName(m.playerId)}:</strong> {m.text}
              </p>
            ))}
          </div>

          <div className="chat-panel-reactions">
            {REACTIONS.map((emoji) => (
              <motion.button
                key={emoji}
                type="button"
                className="chat-reaction-btn"
                whileTap={{ scale: 0.75 }}
                whileHover={{ scale: 1.15 }}
                onClick={() => sendReaction(emoji)}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </motion.button>
            ))}
          </div>

          <form
            className="chat-panel-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Say something…"
              maxLength={MAX_MESSAGE_LENGTH}
            />
            <button type="submit" className="chat-send-btn" aria-label="Send message">
              ➤
            </button>
          </form>
        </>
      )}
    </div>
  );
}
