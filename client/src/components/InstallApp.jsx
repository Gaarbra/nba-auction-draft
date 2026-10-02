import { useEffect, useState } from "react";
import InfoModal from "./InfoModal.jsx";
import { canPromptInstall, isAppInstalled, promptInstall } from "../webApp.js";

export default function InstallApp() {
  const [installed, setInstalled] = useState(isAppInstalled);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const update = () => setInstalled(isAppInstalled());
    const onInstalled = () => { setInstalled(true); setShowHelp(false); };
    media.addEventListener("change", update);
    window.addEventListener("appinstalled", onInstalled);
    return () => { media.removeEventListener("change", update); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  async function install() {
    if (!canPromptInstall()) { setShowHelp(true); return; }
    setBusy(true);
    try { if (await promptInstall()) setInstalled(true); } catch { setShowHelp(true); }
    finally { setBusy(false); }
  }
  if (installed) return null;
  return <>
    <button className="site-footer-link" type="button" disabled={busy} onClick={install}>{busy ? "Opening installer…" : "Install app"}</button>
    {showHelp && <InfoModal title="Add Hoop Bids to your phone" onClose={() => setShowHelp(false)} body={<>
      <p>Open Hoop Bids from your home screen, with the same rooms, players and game modes.</p>
      <h3>iPhone or iPad</h3><p>Open this site in Safari. Open the Share menu, choose <strong>Add to Home Screen</strong>, turn on <strong>Open as Web App</strong> if shown, then tap <strong>Add</strong>.</p>
      <h3>Android</h3><p>Open this site in Chrome. Open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. If you are in a social app's built-in browser, open the link in Chrome first.</p>
      <p>An internet connection is required to play. No app-store download is needed.</p>
    </>} />}
  </>;
}
