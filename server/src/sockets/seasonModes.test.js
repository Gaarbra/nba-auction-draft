import test from "node:test";
import assert from "node:assert/strict";
import { registerRoomHandlers } from "./roomHandlers.js";
import { createRoom, addPlayerToRoom, getRoom } from "../rooms/roomStore.js";
import { getPlayers } from "../services/playerCache.js";

test("peak socket nominations exclude uncached players; Active Now starts and nominates season-only stats", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Use saved catalogue fixture"); });
  const pool = (await getPlayers()).slice(0, 12);
  const ready = pool.slice(0, 7);
  const seasonStats = { season: "2026-27", statsBasis: "season", gamesPlayed: 2,
    pointsPerGame: 4, reboundsPerGame: 2, assistsPerGame: 1, stealsPerGame: 0, blocksPerGame: 0,
    fgaPerGame: 4, ftaPerGame: 0, tovPerGame: 1, minutesPerGame: 20, usagePct: null };
  const requested = [];
  fetchMock.mock.mockImplementation(async url => {
    url = String(url);
    if (url.endsWith('/market-index')) return {ok:true,json:async()=>({players:pool.map(p=>({...p,peakReady:ready.includes(p)}))})};
    if (url.endsWith('/active-now')) return {ok:true,json:async()=>({season:'2026-27',fetchedAt:Date.now()/1000,
      players:ready.map(p=>({...p,isActive:true,stats:seasonStats}))})};
    if (url.includes('/stats?')) {
      const id = Number(new URL(url).searchParams.get('id'));
      requested.push(id);
      assert.ok(ready.some(p=>p.id===id));
      assert.equal(new URL(url).searchParams.get('mode'),'peak');
      return {ok:true,json:async()=>({stats:{...seasonStats,season:'2015-16'},player:{id}})};
    }
    return {ok:true,json:async()=>({playerIds:[]})};
  });
  for (const mode of ['peak','active-now']) {
    const room=createRoom('private',true);
    const host=addPlayerToRoom(room.code,{name:'Host',socketId:mode}).player;
    const handlers=new Map();
    const socket={id:mode,data:{roomCode:room.code,playerId:host.id},handshake:{address:mode},on:(name,fn)=>handlers.set(name,fn),emit(){}};
    registerRoomHandlers({to:()=>({emit(){}}),emit(){}},socket);
    let response;
    await handlers.get('room:start')({era:'all',difficulty:'hard',biddingMode:'open',allowPositionSwaps:true,gameMode:mode}, r=>{response=r});
    assert.equal(response.error,undefined);
    await handlers.get('draft:nominate')({},r=>{response=r});
    assert.equal(response.error,undefined);
    assert.equal(getRoom(room.code).gameMode,mode);
  }
  assert.equal(requested.length,1,'Active Now must never request career/peak stats');
});
