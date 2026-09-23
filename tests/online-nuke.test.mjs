import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import net from 'node:net';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function socket(url){
 const ws=new WebSocket(url),messages=[];
 ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
 await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 return {ws,messages,send:o=>ws.send(JSON.stringify(o)),async wait(predicate,ms=5000){
   const end=Date.now()+ms;while(Date.now()<end){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await delay(15);}throw new Error('timeout '+JSON.stringify(messages.slice(-5)));
 }};
}
test('two rooms: authoritative nuke and reset are scoped and persistent', {timeout:30000},async t=>{
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
 const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const dir=await mkdtemp(tmpdir()+'/mc-room-nuke-');
 let child=spawn(process.execPath,['server/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',MC_DATA_DIR:dir,MC_OWNER_KEY:'test-only-owner'}});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true});});
 for(let i=0;i<100&&!logs.includes('http://');i++)await delay(25);assert.match(logs,/http:\/\//,logs);
 const url='ws://127.0.0.1:'+port+'/ws';
 const caster=await socket(url),victim=await socket(url),outsider=await socket(url);
 t.after(()=>{caster.ws.close();victim.ws.close();outsider.ws.close();});
 caster.send({t:'create',name:'caster'});const a=await caster.wait(m=>m.t==='joined');
 victim.send({t:'join',room:a.room,name:'victim'});const b=await victim.wait(m=>m.t==='joined');
 outsider.send({t:'create',name:'outsider'});const c=await outsider.wait(m=>m.t==='joined');
 caster.send({t:'play'});victim.send({t:'play'});outsider.send({t:'play'});
 caster.send({t:'block',x:4294967296,y:19,z:0,b:0});
 caster.send({t:'sync'});assert.deepEqual((await caster.wait(m=>m.t==='sync')).editsByDimension.overworld,[]);

 victim.send({t:'move',x:b.self.x,y:b.self.y,z:b.self.z,dimension:'nether',yaw:0,pitch:0});
 caster.send({t:'chat',text:'Maydaymayday'});
 const event=await victim.wait(m=>m.t==='nuke');assert.equal(event.casterId,a.id);
 caster.send({t:'sync'});victim.send({t:'sync'});outsider.send({t:'sync'});
 const afterA=await caster.wait(m=>m.t==='sync'),afterB=await victim.wait(m=>m.t==='sync'),afterC=await outsider.wait(m=>m.t==='sync');
 assert.equal(afterA.self.hp,20);assert.equal(afterB.self.hp,0);assert.equal(afterC.self.hp,20);
 assert.equal(afterA.boss.hp,0);assert.ok(afterA.boss.respawnAt>Date.now());
 assert.equal(afterA.dragonKilled,true);
 assert.ok(afterA.editsByDimension.overworld.length>0);assert.deepEqual(afterA.editsByDimension.nether,[]);
 victim.send({t:'terrain_reset'});await delay(200);victim.send({t:'sync'});
 assert.ok((await victim.wait(m=>m.t==='sync')).editsByDimension.overworld.length>0);
 caster.send({t:'terrain_reset'});await caster.wait(m=>m.t==='terrain_reset');
 caster.send({t:'sync'});assert.deepEqual((await caster.wait(m=>m.t==='sync')).editsByDimension.overworld,[]);
 assert.doesNotMatch(logs,/TypeError|ReferenceError|SyntaxError/);
});
