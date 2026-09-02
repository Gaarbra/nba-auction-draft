// Google Analytics (GA4). Loaded only in production builds
// (import.meta.env.PROD, Vite's own env flag) -- local dev (`npm run dev`)
// never sends anything, so testing/iterating doesn't pollute real traffic
// numbers. No client-side router in this app (App.jsx is a single page
// driven by socket state, not URL routes), so GA4's automatic page_view on
// load is all there is to track -- no manual route-change wiring needed.
const MEASUREMENT_ID = "G-3T7YB1ZRZ6";

export function initAnalytics() {
  if (!import.meta.env.PROD) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  }
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID);
}
