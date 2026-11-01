import { useEffect, useState } from "react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// Read saved progress only. Opening the app never makes an NBA/proxy request.
export default function useDataStatus() {
  const [status, setStatus] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function update() {
      if (document.hidden) return;
      try {
        const response = await fetch(`${SERVER_URL}/api/data-status`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Status unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) { setStatus(data); setUnavailable(false); }
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    }
    update();
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  return { status, unavailable };
}

export function dataUpdatedLabel(timestamp) {
  return timestamp ? new Date(timestamp * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not yet available";
}
