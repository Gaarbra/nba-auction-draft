// Run: node client/checks/lobby.mjs. Supply PLAYWRIGHT_MODULE if Playwright is outside this repo.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = await mkdtemp(root + '.lobby-check-');
let browser, server;
try {
  await writeFile(fixture + '/index.html', '<div id="root"></div><script type="module" src="./room.jsx"></script>');
  await writeFile(fixture + '/room.jsx', `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import RoomView from '../src/components/RoomView.jsx';
    import '../src/index.css';
    const names = ['Gabriel', 'Alex', 'Jordan', 'Taylor', 'Morgan', 'Sam', 'Casey', 'Riley'];
    function Check() {
      const [room, setRoom] = useState({code:'ABCDEF', visibility:'private', maxPlayers:8,
        reconnectGraceMs:60000, players:names.map((name, i) => ({id:String(i), name, isHost:i===0, connected:true, budget:100}))});
      window.setRoom = setRoom;
      return <main className="app-main"><RoomView room={room} currentPlayerId="0"
        socket={{emit:(event, data, done)=>{window.lastEmit={event,data};done?.({});}}}
        onLeaveRoom={()=>{}} onStartDraft={(...args)=>{window.started=args;}} /></main>;
    }
    createRoot(document.getElementById('root')).render(<Check/>);
  `);
  server = await createServer({root, server:{host:'127.0.0.1',port:0}, logLevel:'error'});
  await server.listen();
  browser = await chromium.launch({headless:true, channel:'msedge'});
  const page = await browser.newPage({viewport:{width:1366,height:768}, reducedMotion:'reduce'});
  await page.route('**/api/players/eras', route=>route.fulfill({json:{eras:Array.from({length:15}, (_,i)=>({id:i ? 'era'+i:'all',label:i ? 'Era '+i:'All Eras',count:100}))}}));
  await page.goto(server.resolvedUrls.local[0] + fixture.split(/[\\/]/).pop() + '/index.html');
  await page.locator('.lobby-players li').last().waitFor();
  assert.equal(await page.locator('.lobby-players li').count(),8);
  assert.equal(await page.locator('.empty-slot').count(),0);
  await page.getByText('Alex',{exact:true}).click();
  await page.getByRole('button',{name:'Kick',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.lastEmit),{event:'room:vote-kick-start',data:{targetId:'1'}});
  await page.getByText('Alex',{exact:true}).click();
  const game = page.getByRole('button',{name:/^Game mode:/});
  const before = await page.locator('.room-card').boundingBox();
  if (process.env.LOBBY_SCREENSHOTS) await page.screenshot({path:process.env.LOBBY_SCREENSHOTS+'/lobby-initial.png',fullPage:true});
  console.log('Desktop lobby bounds:',before);
  assert(before.height < 650, 'Eight-player desktop lobby should fit without tall slot rows');
  await game.focus(); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.match(await game.innerText(),/Peak Season/);
  await game.click(); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('listbox').count(),0);
  assert(await game.evaluate(el=>el===document.activeElement));
  await game.click(); await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('listbox').count(),0);
  await page.getByRole('button',{name:'Start Draft',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.started))[4],'peak');
  await page.getByRole('button',{name:/^Player limit:/}).click();
  assert.equal(await page.getByRole('option').count(),1);
  await page.keyboard.press('Escape');
  for (const width of [1366,375,320]) {
    await page.setViewportSize({width,height:768});
    await page.evaluate(()=>window.scrollTo(0,0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows at '+width);
    const rect = await page.locator('.room-card').boundingBox();
    await game.click();
    const menu = await page.getByRole('listbox').boundingBox();
    assert(menu.x>=0 && menu.x+menu.width<=width && menu.y>=0 && menu.y+menu.height<=768, 'Menu outside viewport');
    assert.equal((await page.locator('.room-card').boundingBox()).height,rect.height,'Menu expands layout');
    if (process.env.LOBBY_SCREENSHOTS) await page.screenshot({path:process.env.LOBBY_SCREENSHOTS+'/lobby-'+width+'.png',fullPage:true});
    await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>window.setRoom(r=>({...r,players:r.players.slice(0,2).map(p=>({...p,name:'VeryLongPlayerNameWithoutSpaces',connected:p.id==='0',disconnectedAt:Date.now()}))})));
  await page.waitForFunction(()=>document.querySelectorAll('.lobby-players li').length===2);
  assert.equal(await page.locator('.lobby-players li').count(),2);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long names overflow');
  await page.evaluate(()=>window.setRoom(r=>({...r,isLocal:true})));
  await page.waitForFunction(()=>!document.querySelector('.kick-btn'));
  assert.equal(await page.locator('.kick-btn').count(),0);
  await page.evaluate(()=>window.setRoom(r=>({...r,players:r.players.map(p=>({...p,isHost:false}))})));
  await page.waitForFunction(()=>!document.querySelector('.room-settings'));
  assert.equal(await page.locator('.room-settings').count(),0);
  console.log('Lobby checks passed: 8 players, 320/375/1366px, dropdown bounds/keyboard, peak selection, long names, local and guest states.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(fixture,{recursive:true,force:true});
}
