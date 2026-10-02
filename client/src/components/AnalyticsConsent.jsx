import { useEffect, useState } from "react";
import { getAnalyticsConsent, setAnalyticsConsent } from "../analytics.js";
import InfoModal from "./InfoModal.jsx";
import { PAGES } from "../siteContent.jsx";

export default function AnalyticsConsent() {
  const [open, setOpen] = useState(() => getAnalyticsConsent() === null);
  const [privacy, setPrivacy] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    const sync = (event) => {
      if (event.key !== "hoop-bids:analytics-consent:v1") return;
      let value;
      try { value = JSON.parse(event.newValue)?.value; } catch { /* Treat a cleared choice as refusal. */ }
      setAnalyticsConsent(value === "accepted" ? "accepted" : "rejected", false);
    };
    window.addEventListener("analytics:preferences", show);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("analytics:preferences", show); window.removeEventListener("storage", sync); };
  }, []);
  function choose(value) { setAnalyticsConsent(value); setOpen(false); }
  if (!open) return null;
  return <>
    <InfoModal title="Allow optional analytics?" onClose={() => choose("rejected")} body={<>
      <p>Help improve Hoop Bids by sharing page visits and game actions with Google Analytics and, when configured, PostHog. They may use cookies and receive device and network information.</p>
      <p>Your choice does not affect gameplay. Analytics stays off unless you allow it. Change your choice anytime in the footer.</p>
      <button className="site-footer-link" type="button" onClick={() => setPrivacy(true)}>Read the privacy notice</button>
      <div className="analytics-actions">
        <button className="secondary-btn" type="button" onClick={() => choose("rejected")}>No thanks</button>
        <button className="secondary-btn" type="button" onClick={() => choose("accepted")}>Allow analytics</button>
      </div>
    </>} />
    {privacy && <InfoModal title="Privacy" body={PAGES.privacyPolicy.body} onClose={() => setPrivacy(false)} />}
  </>;
}
