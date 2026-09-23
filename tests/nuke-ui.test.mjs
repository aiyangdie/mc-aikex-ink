import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Real browser + production Game/RoomChat/NetClient. Only bootstrap and transport
// are replaced: deterministic events exercise the UI without a second server.
test('nuke grant, equipment, input guards, cooldown and session reset in browser', {timeout:60000}, async t => {
  const server=http.createServer(async(req,res)=>{
    try {const file=new URL('../'+new URL(req.url,'http://local').pathname.slice(1),import.meta.url);
      let body=await readFile(file.pathname.endsWith('/')?new URL('index.html',file):file);
      if(file.pathname.endsWith('/game.js'))body=body.toString().replace('const game = new Game();','const game = window.__game = new Game();');
      res.setHeader('Content-Type',file.pathname.endsWith('.js')?'text/javascript':file.pathname.endsWith('.css')?'text/css':'text/html');res.end(body);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
  t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>window.__game?.ui.loadingBar.style.display==='none');
  assert.equal(await page.locator('#nukeEquip').count(),1,'independent equipment control must exist');
  await page.evaluate(()=>{const g=window.__game;g._online=true;g.net.room='TEST';g.isRunning=true;g._fallbackActive=true;
    g.ui.startScreen.style.display='none';g.ui.pauseScreen.style.display='none';g._showGameUI(true);g.roomChat.show();
    window.sent=[];g.net._send=msg=>window.sent.push(msg);window.before=JSON.stringify(g.inventory.toJSON());g._openChat();});
  await page.locator('#roomChatInput').fill('Maydaymayday');await page.locator('#roomChatInput').press('Enter');
  assert.deepEqual(await page.evaluate(()=>sent.filter(m=>m.t==='chat')), [{t:'chat',text:'Maydaymayday'}]);
  await page.evaluate(()=>__game.net._onMsg({t:'nuke_granted'}));
  assert.equal(await page.locator('#nukeEquip').isVisible(),true);
  assert.match(await page.locator('#roomChatLog').innerText(),/核弹.*领取|领取.*核弹/);
  assert.equal(await page.evaluate(()=>sent.some(m=>m.t==='nuke_throw')),false);
  assert.equal(await page.locator('#hotbar .hotbar-slot').count(),9);
  await page.locator('#nukeEquip').click();assert.equal(await page.locator('#nukeEquip').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>__game._updateHotbar());
  assert.equal(await page.locator('#nukeEquip').getAttribute('aria-pressed'),'true','inventory redraw must not unequip');
  await page.locator('#gameCanvas').dispatchEvent('mousedown',{button:2});
  assert.deepEqual(await page.evaluate(()=>sent.filter(m=>m.t==='nuke_throw')),[{t:'nuke_throw'}]);
  await page.evaluate(()=>__game.net._onMsg({t:'err',msg:'核弹冷却中'}));
  assert.equal(await page.evaluate(()=>JSON.stringify(__game.inventory.toJSON())===before),true);
  assert.equal(await page.evaluate(()=>__game.nukeUnlocked),true);
  await page.evaluate(()=>__game._openChat());
  await page.locator('#gameCanvas').dispatchEvent('mousedown',{button:2});
  assert.equal(await page.evaluate(()=>sent.filter(m=>m.t==='nuke_throw').length),1);
  await page.evaluate(()=>{__game._closeChat();__game.adminPanel.setOpen(true);});
  await page.locator('#gameCanvas').dispatchEvent('mousedown',{button:2});
  assert.equal(await page.evaluate(()=>sent.filter(m=>m.t==='nuke_throw').length),1,'dialog blocks throwing');
  await page.evaluate(()=>__game.adminPanel.setOpen(false));
  await page.evaluate(()=>{__game._closeChat();__game.net._onMsg({t:'nuke_projectile',phase:'spawn',id:'p',ownerId:'other',dimension:'overworld',x:7,y:21,z:4,cooldownUntil:Date.now()+300000});});
  await page.waitForFunction(()=>document.getElementById('nukeCooldown').textContent.includes('冷却'));
  await page.locator('#gameCanvas').dispatchEvent('mousedown',{button:2});
  assert.equal(await page.evaluate(()=>sent.filter(m=>m.t==='nuke_throw').length),1);
  await page.keyboard.press('Digit2');assert.equal(await page.locator('#nukeEquip').getAttribute('aria-pressed'),'false');
  await page.keyboard.press('n');assert.equal(await page.locator('#nukeEquip').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>{__game.net._onMsg({t:'nuke_projectile',phase:'end',id:'p',cooldownUntil:0,status:'failed'});});
  await page.screenshot({path:'/tmp/mc-task4-nuke-ui.png'});
  await page.evaluate(()=>{__game.isMobile=true;__game._updateNukeHUD();});
  await page.locator('#nukeThrow').click();
  assert.equal(await page.evaluate(()=>sent.filter(m=>m.t==='nuke_throw').length),2,'touch equivalent can throw again without new grant');
  await page.evaluate(()=>__game.net._onMsg({t:'joined',room:'NEXT',id:'new',nukeUnlocked:false,nukeCooldownUntil:0,nukeProjectile:null}));
  assert.equal(await page.evaluate(()=>__game.nukeEquipped),false);
  assert.equal(await page.locator('#nukeEquip').isVisible(),false);
  await page.evaluate(()=>__game.net._onMsg({t:'nuke_granted'}));
  await page.evaluate(()=>__game.net._emit('close'));
  assert.equal(await page.locator('#nukeEquip').isVisible(),false);
  assert.equal(await page.evaluate(()=>__game.nukeUnlocked),false);
  assert.deepEqual(errors,[]);
});
