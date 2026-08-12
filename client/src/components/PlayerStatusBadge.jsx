import { useEffect, useState } from "react";

export default function PlayerStatusBadge({ player, reconnectGraceMs }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (player.connected || player.forfeited || !player.disconnectedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [player.connected, player.forfeited, player.disconnectedAt]);

  if (player.forfeited) {
    return <span className="status-badge forfeited">Left the draft</span>;
  }

  if (!player.connected) {
    const elapsed = now - (player.disconnectedAt || now);
    const remaining = Math.max(0, Math.ceil((reconnectGraceMs - elapsed) / 1000));
    return <span className="status-badge reconnecting">Reconnecting… {remaining}s</span>;
  }

  return null;
}
