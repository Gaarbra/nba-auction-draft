import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMarketCatalogue } from "./marketCatalogue.js";

test("catalogue failures reach the retry UI instead of looking like an empty pool", async () => {
  const request = (status, body) => async () => new Response(JSON.stringify(body), { status });
  await assert.rejects(loadMarketCatalogue("/players", request(503, { players: [] })), /unavailable/);
  await assert.rejects(loadMarketCatalogue("/players", request(200, { error: "offline" })), /Invalid/);
  await assert.rejects(loadMarketCatalogue("/players", async () => { throw new Error("Network failed"); }), /Network/);
  assert.deepEqual(await loadMarketCatalogue("/players", request(200, { players: [] })), []);
  const players = [{ id: 1, fullName: "Test player" }];
  assert.deepEqual(await loadMarketCatalogue("/players", request(200, { players })), players);
});

import { marketTeams, playedInMarketEra } from './marketCatalogue.js';
test('market uses actual team seasons, including returns and current rosters', () => {
  const player = { draftYear: 2003, team: 'CLE', firstSeason: '2003-04', lastSeason: '2025-26', teamHistory: [
    { abbreviation: 'CLE', seasons: ['2003-04','2009-10','2014-15','2017-18'] },
    { abbreviation: 'MIA', seasons: ['2010-11','2013-14'] },
    { abbreviation: 'LAL', seasons: ['2018-19','2025-26'] }
  ], currentTeam: 'PHI', rosterSeason: '2026-27' };
  assert.deepEqual(marketTeams(player, '2000s'), ['CLE']);
  assert.deepEqual(marketTeams(player, '2010s'), ['CLE','MIA','LAL']);
  assert.deepEqual(marketTeams(player, '2020s'), ['LAL','PHI']);
  assert.equal(playedInMarketEra(player, '2020s'), true);
  assert.equal(playedInMarketEra(player, '1990s'), false);
  assert.equal(marketTeams(player).length, 4);
  const gaps = {teamHistory: [{abbreviation:'CLE', seasons:['2008-09','2020-21']}]};
  assert.deepEqual(marketTeams(gaps, '2010s'), []);
});
test('legacy team history is usable without inventing dates', () => {
  const player = {team:'MIA',firstSeason:'2003-04',lastSeason:'2015-16',teamHistory:[{abbreviation:'MIA',gamesPlayed:100}]};
  assert.deepEqual(marketTeams(player), ['MIA']);
  assert.deepEqual(marketTeams(player,'2000s'), []);
  assert.equal(playedInMarketEra(player,'2010s'),true);
});
