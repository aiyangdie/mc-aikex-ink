/** Isolated local browser acceptance: no production room is contacted. */
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dir=await mkdtemp(tmpdir()+'/mc-browser-nuke-');
const backend=spawn(process.execPath,['server/server.js'],{env:{...process.env,PORT:'3040',HOST:'127.0.0.1',MC_DATA_DIR:dir,MC_OWNER_KEY:'test-only-owner'},stdio:['ignore','pipe','pipe']});
const staticServer=spawn(process.execPath,['scripts/dev-server.mjs'],{env:{...process.env,PORT:'8086'},stdio:['ignore','pipe','pipe']});
let logs='';for(const child of [backend,staticServer])for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs+=String(b));
let browser;
try{
 for(let i=0;i<100&&(!logs.includes('http://127.0.0.1:3040')||!logs.includes('8086'));i++)await sleep(50);
 assert.match(logs,/http:\/\/127\.0\.0\.1:3040/);assert.match(logs,/8086/);
 browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({viewport:{width:1200,height:800}});
 const errors=[];
 await ctx.addInitScript(()=>{HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.reject(Error('fallback-test'));});
 await ctx.route('**/js/game.js*',async route=>{
   const response=await route.fetch(),code=await response.text();
   await route.fulfill({response,body:code.replace('const game = new Game();','const game = new Game(); window.__testGame=game;')});
 });
 async function enter(name,room){
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8086');await page.locator('#loadingBar').waitFor({state:'hidden'});
   await page.locator('#playerNameInput').fill(name);
   if(room){await page.locator('#roomCodeInput').fill(room);await page.locator('#btnJoin').click();}
   else await page.locator('#btnHost').click();
   if(!room)await page.locator('#btnEnterRoom').waitFor({state:'visible'});
   return page;
 }
 const host=await enter('核弹房主');
 const room=await host.evaluate(()=>window.__testGame.net.room);assert.ok(room,logs);
 const victim=await enter('受害者',room);
 await host.locator('#btnEnterRoom').click();
 if(await victim.locator('#btnEnterRoom').isVisible())await victim.locator('#btnEnterRoom').click();
 await host.waitForFunction(()=>window.__testGame._online&&window.__testGame.isRunning);
 await victim.waitForFunction(()=>window.__testGame._online&&window.__testGame.isRunning,null,{timeout:5000});
 for(const [page,x] of [[host,80],[victim,90]])await page.evaluate(x=>{
   const g=window.__testGame;g.player.adminFly=true;g.player.position.set(x,20,80);
   g.net._send({t:'move',x,y:20,z:80,dimension:'overworld',yaw:0,pitch:0});
 },x);
 await host.mouse.move(500,400);await host.mouse.move(540,400);
 const yaw=await host.evaluate(()=>window.__testGame.player.yaw);
 assert.notEqual(yaw,0,'fallback hover must rotate without button');
 await host.evaluate(()=>{const field=document.createElement('input');field.id='testFocusedInput';document.body.appendChild(field);field.focus();});
 await host.keyboard.press('t');
 assert.equal(await host.evaluate(()=>window.__testGame._chatOpen),false,'typing T in another input must not steal focus');
 await host.locator('#testFocusedInput').evaluate(el=>el.remove());await host.mouse.click(600,400);
 await host.keyboard.press('t');await host.locator('#roomChatInput').waitFor({state:'visible'});
 const before=await host.evaluate(()=>window.__testGame.player.yaw);
 await host.mouse.move(620,400);
 assert.equal(await host.evaluate(()=>window.__testGame.player.yaw),before,'chat must suppress look');
 await host.locator('#roomChatInput').fill('<img src=x onerror=alert(1)>');await host.locator('#roomChatInput').press('Enter');
 await host.locator('#roomChatLog').getByText('<img src=x onerror=alert(1)>',{exact:false}).waitFor();
 assert.equal(await host.locator('#roomChatLog img').count(),0,'remote chat remains text');
 await host.mouse.click(600,400);await host.waitForFunction(()=>window.__testGame._fallbackActive);
 await host.evaluate(()=>{window.__testGame.__places=0;window.__testGame._secondaryAction=()=>{window.__testGame.__places++};});
 await host.mouse.move(600,400);await host.mouse.down({button:'right'});
 assert.equal(await host.evaluate(()=>window.__testGame.__places),1,'right button places immediately without drag');
 await host.mouse.move(610,410);await host.mouse.up({button:'right'});
 assert.equal(await host.evaluate(()=>window.__testGame.__places),1,'right button action never duplicates on release');
 await host.keyboard.press('t');await host.locator('#roomChatInput').waitFor({state:'visible'});
 const casterHpBefore=await host.evaluate(()=>window.__testGame.player.hp);
 await host.locator('#roomChatInput').fill('Maydaymayday');await host.locator('#roomChatInput').press('Enter');
 await victim.locator('#deathScreen').waitFor({state:'visible',timeout:12000});
 assert.match(await victim.locator('#deathReason').textContent(),/核弹/);
 await host.waitForFunction(()=>window.__testGame._netBossState?.hp===0);
 assert.ok(await host.locator('#nukeFlash').count(),'blast flash overlay visible in DOM');
 const state=await host.evaluate(()=>({hp:window.__testGame.player.hp,edits:window.__testGame.world.edits.size}));
 assert.equal(state.hp,casterHpBefore,'nuke must not damage its caster');assert.ok(state.edits>0);
 await mkdir('docs/verification',{recursive:true});await host.screenshot({path:'docs/verification/room-nuke-local.png'});
 await host.locator('#btnTerrainReset').waitFor({state:'visible'});
 host.once('dialog',dialog=>dialog.accept());await host.locator('#btnTerrainReset').click();
 await host.waitForFunction(()=>window.__testGame.world.edits.size===0,null,{timeout:12000});
 await host.screenshot({path:'docs/verification/room-reset-local.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS local browser: mouse hover, chat, nuke, victim death, Boss death, crater, host reset',state);
}finally{
 if(browser)await browser.close();for(const child of [backend,staticServer])child.kill('SIGTERM');
 await sleep(250);await rm(dir,{recursive:true,force:true});
 if(logs.match(/TypeError|ReferenceError|SyntaxError/))console.error(logs.slice(-1600));
}
