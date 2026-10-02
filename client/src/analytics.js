// Analytics is optional. No vendor initializes before an explicit choice.
const MEASUREMENT_ID = "G-3T7YB1ZRZ6";
const CONSENT_KEY = "hoop-bids:analytics-consent:v1";
let choice;
let started = false;
let posthog;
let generation = 0;

export function getAnalyticsConsent() {
  if (choice !== undefined) return choice;
  try {
    const stored = JSON.parse(localStorage.getItem(CONSENT_KEY));
    if (stored && Date.now() - stored.at < 180 * 86400000 && ["accepted", "rejected"].includes(stored.value)) return (choice = stored.value);
  } catch { /* Storage may be unavailable. Keep the choice for this visit. */ }
  return null;
}

function gtag() { window.dataLayer.push(arguments); }

export async function initAnalytics() {
  if (!import.meta.env.PROD || getAnalyticsConsent() !== "accepted" || started) return;
  started = true;
  const current = ++generation;
  window[`ga-disable-${MEASUREMENT_ID}`] = false;
  window.dataLayer = window.dataLayer || [];
  gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  gtag("consent", "update", { analytics_storage: "granted" });
  gtag("js", new Date());
  // Never send invite codes, fragments or query strings to analytics.
  gtag("config", MEASUREMENT_ID, { page_location: location.origin + location.pathname, page_referrer: "", allow_google_signals: false, allow_ad_personalization_signals: false });
  if (!document.getElementById("hoop-analytics-script")) {
    const script = document.createElement("script");
    script.id = "hoop-analytics-script";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return;
  try {
    const module = await import("posthog-js");
    if (current !== generation || getAnalyticsConsent() !== "accepted") return;
    posthog = module.default;
    posthog.init(key, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
      person_profiles: "never", autocapture: false, capture_pageview: false,
      capture_pageleave: false, disable_session_recording: true,
      advanced_disable_feature_flags: true, disable_surveys: true,
      sanitize_properties: (properties) => {
        for (const name of ["$current_url", "$pathname"]) if (typeof properties[name] === "string") properties[name] = properties[name].split(/[?#]/)[0];
        delete properties.$referrer;
        delete properties.$initial_referrer;
        delete properties.$initial_current_url;
        return properties;
      },
    });
    posthog.opt_in_capturing({ captureEventName: false });
    posthog.capture("$pageview", { $current_url: location.origin + location.pathname });
  } catch { /* Analytics must never interrupt a game. */ }
}

export function setAnalyticsConsent(value, persist = true) {
  if (!["accepted", "rejected"].includes(value)) return;
  choice = value;
  try { if (persist) localStorage.setItem(CONSENT_KEY, JSON.stringify({ value, at: Date.now() })); } catch { /* Visit-only choice. */ }
  if (value === "accepted") { void initAnalytics(); return; }
  generation++;
  started = false;
  window[`ga-disable-${MEASUREMENT_ID}`] = true;
  if (window.dataLayer) gtag("consent", "update", { analytics_storage: "denied" });
  posthog?.opt_out_capturing();
  // Remove analytics cookies without clearing reconnect or sound preferences.
  const domains = ["", ...location.hostname.split(".").map((_, i, parts) => parts.slice(i).join("."))];
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0];
    if (!/^(_ga|_gid|_gat|ph_)/.test(name)) continue;
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/;${domain ? ` domain=${domain};` : ""} SameSite=Lax`;
  }
}

export function trackEvent(name, properties) {
  if (getAnalyticsConsent() !== "accepted" || !started) return;
  posthog?.capture(name, properties);
}
