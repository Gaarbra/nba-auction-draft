import posthog from "posthog-js";

// Google Analytics (GA4) + PostHog. Both loaded only in production builds
// (import.meta.env.PROD, Vite's own env flag) -- local dev (`npm run dev`)
// never sends anything, so testing/iterating doesn't pollute real traffic
// numbers. No client-side router in this app (App.jsx is a single page
// driven by socket state, not URL routes), so GA4's automatic page_view on
// load is all there is to track there -- no manual route-change wiring
// needed. PostHog additionally gets a handful of manual draft-flow events
// (see trackEvent's call sites) since "page loaded" alone doesn't say
// anything about where people actually get stuck in a draft.
const MEASUREMENT_ID = "G-3T7YB1ZRZ6";

let posthogReady = false;

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

  // Optional: unset in dev and in any deploy that hasn't filled in a real
  // project key yet, same sync:false convention as the app's other
  // optional env vars (see render.yaml). No key means no-op, not a crash.
  const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
  if (posthogKey) {
    posthog.init(posthogKey, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: true,
    });
    posthogReady = true;
  }
}

/** Fire a PostHog event. No-ops in dev or when PostHog isn't configured,
 * so call sites don't need their own import.meta.env.PROD / key checks. */
export function trackEvent(name, properties) {
  if (!posthogReady) return;
  posthog.capture(name, properties);
}
