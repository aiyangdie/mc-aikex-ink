import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import net from 'node:net';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function client(url){
 const ws=new WebSocket(url),messages=[];
 ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
 await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 return {ws,messages,send:o=>ws.send(JSON.stringify(o)),async wait(predicate,ms=3000){
   const end=Date.now()+ms;while(Date.now()<end){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await delay(20);}throw new Error('WebSocket event timeout');
 }};
}
test('two real sockets see one Boss, shared damage, authoritative death and protected respawn', {timeout:20000},async t=>{
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
 const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const dir=await mkdtemp(tmpdir()+'/mc-boss-test-');
 const child=spawn(process.execPath,['server/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',MC_DATA_DIR:dir,MC_OWNER_KEY:'test-only-owner'}});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 t.after(async()=>{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});});
 for(let i=0;i<100&&!logs.includes('http://');i++)await delay(25);
 assert.match(logs,/http:\/\//,logs);
 const a=await client(`ws://127.0.0.1:${port}/ws`),b=await client(`ws://127.0.0.1:${port}/ws`);
 t.after(()=>{a.ws.close();b.ws.close();});
 a.send({t:'create',name:'A'});const joined=await a.wait(m=>m.t==='joined');
 assert.ok(joined.boss,'new rooms must contain the Boss');assert.equal(joined.boss.hp,1500);
 b.send({t:'join',name:'B',room:joined.room});const joinedB=await b.wait(m=>m.t==='joined');
 assert.deepEqual(joinedB.boss,joined.boss);
 const pos=joined.boss;
 a.send({t:'play'});a.send({t:'move',x:pos.x,y:pos.y,z:pos.z+1,dimension:'overworld',hp:20,yaw:0,pitch:0});
 a.send({t:'hit',id:'mist-boss',dmg:9999});
 const wounded=await b.wait(m=>m.t==='boss'&&m.boss.hp===1495);
 assert.equal(wounded.boss.hp,1495);
 for(let i=0;i<20;i++)a.send({t:'hit',id:'mist-boss',dmg:9999});
 a.send({t:'sync'});const snap=await a.wait(m=>m.t==='sync');assert.equal(snap.boss.hp,1495);
 const hits=[];for(let i=0;i<4;i++)hits.push(await a.wait(m=>m.t==='vitals'&&m.cause==='mist-boss',6000));
 assert.deepEqual(hits.map(m=>m.hp),[15,10,5,0]);
 b.send({t:'sync'});assert.equal((await b.wait(m=>m.t==='sync')).boss.hp,1495);
 a.send({t:'respawn'});const revived=await a.wait(m=>m.t==='respawned');assert.equal(revived.hp,20);
 a.send({t:'move',x:pos.x,y:pos.y,z:pos.z+1,dimension:'overworld',hp:20,yaw:0,pitch:0});
 await delay(1500);assert.equal(a.messages.filter(m=>m.t==='vitals'&&m.cause==='mist-boss').length,0);
 assert.doesNotMatch(logs,/TypeError|ReferenceError|SyntaxError/);
});
