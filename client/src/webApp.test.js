import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('worker handles offline game navigation without intercepting APIs, sockets or portfolio', async () => {
  const handlers = {};
  const cached = { offline: true };
  const self = { registration: { scope: 'https://example.com/hoopbids/' }, addEventListener: (name, handler) => handlers[name] = handler };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL, Response, fetch: async () => { throw new Error('Offline'); }, caches: { match: async () => cached } });
  for (const [url, mode] of [['https://example.com/api/players','cors'],['https://example.com/socket.io/','cors'],['https://example.com/','navigate']]) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
  let response;
  handlers.fetch({ request: { method: 'GET', url: 'https://example.com/hoopbids/?room=ABCDE', mode: 'navigate' }, respondWith: (promise) => { response = promise; } });
  assert.equal(await response, cached);
});

test('manifest stays scoped to the game and includes valid phone icons', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(manifest.scope, '/hoopbids/');
  assert.equal(manifest.start_url, '/hoopbids/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = readFileSync(new URL('../public/' + icon.src, import.meta.url));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});
