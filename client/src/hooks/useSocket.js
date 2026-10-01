import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export function useSocket() {
  const socketRef = useRef(null);
  const verificationRef = useRef(null);
  const retryRef = useRef(() => {});
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: !SITE_KEY, reconnection: !SITE_KEY });
    socketRef.current = socket;
    let widget;
    let disposed = false;
    const reset = () => {
      setConnectionError("");
      if (widget !== undefined) window.turnstile.reset(widget);
      else if (!SITE_KEY) socket.connect();
      else window.location.reload();
    };
    retryRef.current = reset;
    socket.on("connect", () => { setConnected(true); setConnectionError(""); });
    socket.on("disconnect", () => {
      setConnected(false);
      if (SITE_KEY && !disposed) reset();
    });
    socket.on("connect_error", () => setConnectionError("Unable to connect. Check your connection and retry verification."));
    const mount = () => {
      if (disposed) return;
      widget = window.turnstile.render(verificationRef.current, {
        sitekey: SITE_KEY,
        action: "connect",
        size: "flexible",
        theme: "dark",
        callback: (token) => { socket.auth = { token }; socket.connect(); },
        "expired-callback": () => { if (!socket.connected) reset(); },
        "error-callback": () => setConnectionError("Human verification failed to load. Please retry."),
      });
    };
    let script;
    if (SITE_KEY) {
      if (window.turnstile) mount();
      else {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = mount;
        script.onerror = () => setConnectionError("Human verification failed to load. Please retry.");
        document.head.appendChild(script);
      }
    }
    return () => {
      disposed = true;
      socket.disconnect();
      if (widget !== undefined) window.turnstile?.remove(widget);
      script?.remove();
    };
  }, []);

  return { socketRef, connected, verificationRef, needsVerification: Boolean(SITE_KEY), connectionError, retryConnection: () => retryRef.current() };
}
