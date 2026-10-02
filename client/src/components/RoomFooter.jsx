import { useLayoutEffect, useRef } from "react";

/* The draft-screen status bar pinned to the bottom of the shell.
   Mirrors the Stitch mock: budget on the left, chat / how-to / wordmark
   on the right. "Draft Log" is a visual stub; there's no persisted log
   in a single-sitting game. */
export default function RoomFooter({ totalBudget, chatCount = 0, onOpenChat, onOpenHelp }) {
  const footerRef = useRef(null);
  useLayoutEffect(() => {
    const footer = footerRef.current;
    const updateHeight = () => document.documentElement.style.setProperty(
      "--room-footer-height", `${footer.getBoundingClientRect().height}px`,
    );
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--room-footer-height");
    };
  }, []);
  return (
    <footer ref={footerRef} className="room-footer">
      <div className="room-footer-group">
        {totalBudget != null && (
          <span>
            Total roster budget: <strong>{totalBudget}c</strong>
          </span>
        )}
      </div>
      <div className="room-footer-group">
        <button type="button" className="room-footer-link" onClick={onOpenChat}>
          Chat ({chatCount})
        </button>
        <span className="room-footer-sep" aria-hidden="true">
          •
        </span>
        <span className="room-footer-muted">Draft Log</span>
        <span className="room-footer-sep" aria-hidden="true">
          •
        </span>
        <button type="button" className="room-footer-link" onClick={onOpenHelp}>
          How to play
        </button>
        <span className="room-footer-sep" aria-hidden="true">
          •
        </span>
        <span className="room-footer-muted">Hoop Bids</span>
      </div>
    </footer>
  );
}
