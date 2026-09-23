import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import net from 'node:net';
import {NetClient} from '../js/net.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function socket(url){
 const ws=new WebSocket(url),messages=[];
 ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
 await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 return {ws,messages,send:o=>ws.send(JSON.stringify(o)),async wait(predicate,ms=5000){
   const end=Date.now()+ms;while(Date.now()<end){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await delay(15);}throw new Error('timeout '+JSON.stringify(messages.slice(-5)));
 }};
}
function assertNoNuke(...clients){for(const client of clients)assert.equal(client.messages.some(m=>m.t==='nuke'),false);}
test('network client delivers nuke grant and projectile lifecycle events',()=>{
 const client=new NetClient();let received;
 client.on('nuke_granted',message=>received=message);
 client._onMsg({t:'nuke_granted'});
 assert.deepEqual(received,{t:'nuke_granted'});
 client.on('nuke_projectile',message=>received=message);
 const event={t:'nuke_projectile',phase:'spawn',id:'test',x:0,y:20,z:0};
 client._onMsg(event);assert.deepEqual(received,event);
});
test('nuke code grants only this connection without detonating or carrying to another room', {timeout:30000},async t=>{
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
 const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const dir=await mkdtemp(tmpdir()+'/mc-room-nuke-');
 const child=spawn(process.execPath,['server/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',MC_DATA_DIR:dir,MC_OWNER_KEY:'test-only-owner'}});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true});});
 for(let i=0;i<100&&!logs.includes('http://');i++)await delay(25);assert.match(logs,/http:\/\//,logs);
 const url='ws://127.0.0.1:'+port+'/ws';
 const caster=await socket(url),victim=await socket(url),outsider=await socket(url);
 t.after(()=>{caster.ws.close();victim.ws.close();outsider.ws.close();});
 caster.send({t:'create',name:'caster'});const a=await caster.wait(m=>m.t==='joined');
 assert.ok(Number.isFinite(a.serverNow),'joined must carry authoritative server time');
 assert.equal(a.nukeUnlocked,false);assert.equal(a.nukeCooldownUntil,0);
 victim.send({t:'join',room:a.room,name:'victim'});await victim.wait(m=>m.t==='joined');
 outsider.send({t:'create',name:'outsider'});const b=await outsider.wait(m=>m.t==='joined');
 caster.send({t:'play'});victim.send({t:'play'});outsider.send({t:'play'});
 caster.send({t:'block',x:4294967296,y:19,z:0,b:0});
 caster.send({t:'sync'});assert.deepEqual((await caster.wait(m=>m.t==='sync')).editsByDimension.overworld,[]);

 caster.send({t:'chat',text:'Maydaymayday'});
 {const grant=await caster.wait(m=>m.t==='nuke_granted');assert.ok(Number.isFinite(grant.serverNow));assert.equal(grant.nukeCooldownUntil,0);}
 await delay(500);
 assertNoNuke(caster,victim,outsider);
 assert.equal(victim.messages.some(m=>m.t==='nuke_granted'),false);
 assert.equal(outsider.messages.some(m=>m.t==='nuke_granted'),false);
 assert.equal(victim.messages.some(m=>m.t==='chat'&&m.text==='Maydaymayday'),false);
 caster.send({t:'sync'});victim.send({t:'sync'});outsider.send({t:'sync'});
 for(const client of [caster,victim,outsider]){
   const snapshot=await client.wait(m=>m.t==='sync');
   assert.ok(Number.isFinite(snapshot.serverNow));
   assert.equal(snapshot.nukeUnlocked,client===caster);
   assert.equal(snapshot.self.hp,20);
   assert.ok(snapshot.boss.hp>0);
   assert.deepEqual(snapshot.editsByDimension.overworld,[]);
   assert.deepEqual(snapshot.editsByDimension.nether,[]);
 }

 // A repeat acknowledgement is idempotent: no detonation or other room-visible effect.
 caster.send({t:'chat',text:'Maydaymayday'});
 {const grant=await caster.wait(m=>m.t==='nuke_granted');assert.ok(Number.isFinite(grant.serverNow));assert.equal(grant.nukeCooldownUntil,0);}
 await delay(500);assertNoNuke(caster,victim,outsider);
 victim.send({t:'chat',text:'maydaymayday'});
 await victim.wait(m=>m.t==='chat'&&m.text==='maydaymayday');
 assert.equal(victim.messages.some(m=>m.t==='nuke_granted'),false);

 const rejoined=await socket(url);t.after(()=>rejoined.ws.close());
 rejoined.send({t:'join',room:a.room,name:'caster'});await rejoined.wait(m=>m.t==='joined');
 rejoined.send({t:'play'});rejoined.send({t:'nuke_throw',x:0,y:19,z:0});
 const denied=await rejoined.wait(m=>m.t==='err');assert.doesNotMatch(denied.msg,/Maydaymayday/);
 await delay(100);assertNoNuke(rejoined,victim);
 rejoined.send({t:'sync'});assert.deepEqual((await rejoined.wait(m=>m.t==='sync')).editsByDimension.overworld,[]);

 // Only intent is accepted: forged client coordinates must not choose the impact.
 caster.send({t:'nuke_throw',x:4000,y:40,z:4000,dimension:'end'});
 const spawnA=await caster.wait(m=>m.t==='nuke_projectile'&&m.phase==='spawn');
 const spawnB=await victim.wait(m=>m.t==='nuke_projectile'&&m.phase==='spawn');
 assert.deepEqual(spawnA,spawnB);assert.equal(spawnA.ownerId,a.id);
 assert.equal(spawnA.dimension,'overworld');assert.ok(Math.abs(spawnA.x)<100);
 assert.ok(Number.isFinite(spawnA.serverNow));assert.equal(spawnA.cooldownUntil-spawnA.serverNow,300000);
 assert.ok(spawnA.cooldownUntil>Date.now());assert.equal(spawnA.previousNukeAt,undefined);
 caster.send({t:'nuke_throw'});
 assert.match((await caster.wait(m=>m.t==='err')).msg,/冷却/);
 const updateA=await caster.wait(m=>m.t==='nuke_projectile'&&m.phase==='update');
 const updateB=await victim.wait(m=>m.t==='nuke_projectile'&&m.phase==='update');
 assert.ok(Number.isFinite(updateA.serverNow));
 assert.deepEqual(updateA,updateB);assert.equal(updateA.id,spawnA.id);
 const endA=await caster.wait(m=>m.t==='nuke_projectile'&&m.phase==='end');
 const endB=await victim.wait(m=>m.t==='nuke_projectile'&&m.phase==='end');
 assert.ok(Number.isFinite(endA.serverNow));
 assert.deepEqual(endA,endB);assert.equal(endA.id,spawnA.id);assert.equal(endA.status,'impact');
 const impactA=await caster.wait(m=>m.t==='nuke'),impactB=await victim.wait(m=>m.t==='nuke');
 assert.deepEqual(impactA,impactB);assert.equal(impactA.casterId,a.id);
 assert.deepEqual(impactA.origin,{x:endA.x,y:endA.y,z:endA.z});
 assert.ok(impactA.edits.length>0);
 assert.equal((await victim.wait(m=>m.t==='combat'&&m.id!==a.id&&m.cause==='nuke')).hp,0);
 assert.equal((await victim.wait(m=>m.t==='boss'&&m.boss.hp===0)).boss.hp,0);
 assert.deepEqual((await victim.wait(m=>m.t==='mobs'&&m.list.length===0)).list,[]);
 caster.send({t:'sync'});victim.send({t:'sync'});outsider.send({t:'sync'});
 const alive=await caster.wait(m=>m.t==='sync'),dead=await victim.wait(m=>m.t==='sync');
 assert.equal(alive.nukeUnlocked,true);assert.equal(alive.nukeProjectile,null);
 assert.equal(alive.nukeCooldownUntil,spawnA.cooldownUntil);assert.equal(alive.self.hp,20);
 assert.equal(dead.self.hp,0);assert.equal(dead.boss.hp,0);
 assert.deepEqual(alive.editsByDimension,dead.editsByDimension);
 const untouched=await outsider.wait(m=>m.t==='sync');
 assert.equal(untouched.self.hp,20);assert.ok(untouched.boss.hp>0);assert.equal(untouched.nukeCooldownUntil,0);
 assert.deepEqual(untouched.editsByDimension.overworld,[]);assertNoNuke(outsider);
 assert.equal(outsider.messages.some(m=>m.t==='nuke_projectile'),false);
 caster.send({t:'terrain_reset'});
 const resetA=await caster.wait(m=>m.t==='terrain_reset'),resetB=await victim.wait(m=>m.t==='terrain_reset');
 assert.deepEqual(resetA,resetB);assert.deepEqual(resetA.editsByDimension.overworld,[]);
 caster.send({t:'sync'});const reset=await caster.wait(m=>m.t==='sync');
 assert.equal(reset.nukeUnlocked,true);assert.equal(reset.nukeCooldownUntil,spawnA.cooldownUntil);

 caster.send({t:'join',room:b.room,name:'caster'});await caster.wait(m=>m.t==='joined');
 caster.send({t:'play'});caster.send({t:'nuke_throw',x:0,y:19,z:0});
 await caster.wait(m=>m.t==='err');
 await delay(100);assertNoNuke(caster,outsider);
 caster.send({t:'sync'});const afterB=await caster.wait(m=>m.t==='sync');
 assert.equal(afterB.nukeUnlocked,false);assert.equal(afterB.nukeCooldownUntil,0);
 assert.equal(afterB.self.hp,20);assert.deepEqual(afterB.editsByDimension.overworld,[]);
 assert.doesNotMatch(logs,/TypeError|ReferenceError|SyntaxError/);
});
