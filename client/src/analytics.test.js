import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./analytics.js', import.meta.url), 'utf8').replaceAll('export ', '').replaceAll('import.meta.env', 'env').replace('import("posthog-js")', 'posthogModule');
function harness(stored, vendor = null) {
  const values = new Map(stored ? [['hoop-bids:analytics-consent:v1', JSON.stringify(stored)]] : []);
  const scripts = [];
  const context = vm.createContext({ env: { PROD: true, VITE_POSTHOG_KEY: vendor ? "ph_test" : "" }, posthogModule: vendor, Date, JSON, location: { origin: 'https://example.com', pathname: '/hoopbids/', hostname: 'example.com' }, window: {}, localStorage: { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) }, document: { cookie: '', getElementById: () => scripts[0], createElement: () => ({}), head: { appendChild: (s) => scripts.push(s) } } });
  vm.runInContext(source, context);
  return { context, scripts, run: (s) => vm.runInContext(s, context) };
}
test('analytics stays off until permission; refusal and withdrawal stop capture', async () => {
  const h = harness();
  await h.run('initAnalytics()');
  assert.equal(h.scripts.length, 0);
  h.run('setAnalyticsConsent("rejected")');
  await h.run('initAnalytics()');
  assert.equal(h.scripts.length, 0);
  h.run('setAnalyticsConsent("accepted")');
  assert.equal(h.scripts.length, 1);
  h.run('initAnalytics()');
  assert.equal(h.scripts.length, 1);
  assert.equal(h.context.window['ga-disable-G-3T7YB1ZRZ6'], false);
  h.run('setAnalyticsConsent("rejected")');
  assert.equal(h.context.window['ga-disable-G-3T7YB1ZRZ6'], true);
  assert.equal(h.run('getAnalyticsConsent()'), 'rejected');
  const config = h.context.window.dataLayer.find((a) => a[0] === 'config');
  assert.equal(config[2].page_location, 'https://example.com/hoopbids/');
});
test('expired or malformed permission cannot initialize analytics', async () => {
  for (const stored of [{value:'accepted',at:0}, {value:'anything',at:Date.now()}]) {
    const h = harness(stored); await h.run('initAnalytics()'); assert.equal(h.scripts.length, 0);
  }
});

test('PostHog respects permission and a withdrawal during SDK loading', async () => {
  let initCount = 0, captures = 0, optouts = 0;
  const vendor = { init: () => initCount++, opt_in_capturing() {}, capture: () => captures++, opt_out_capturing: () => optouts++ };
  const h = harness(null, Promise.resolve({default:vendor}));
  await h.run('initAnalytics()');
  assert.equal(initCount, 0);
  h.run('setAnalyticsConsent("accepted")');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(initCount, 1);
  h.run('trackEvent("draft_bid", {amount:2})');
  assert.equal(captures, 2);
  h.run('setAnalyticsConsent("rejected")');
  h.run('trackEvent("draft_bid", {amount:3})');
  assert.equal(captures, 2);
  assert.equal(optouts, 1);
  let release;
  const delayed = harness(null, new Promise(resolve => { release = resolve; }));
  delayed.run('setAnalyticsConsent("accepted")');
  delayed.run('setAnalyticsConsent("rejected")');
  release({default:vendor});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(initCount, 1);
});
