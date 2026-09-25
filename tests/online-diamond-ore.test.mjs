import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as THREE from 'three';
import {World,Chunk,BlockType} from '../js/voxel.js';
import {hasDiamondMicrotext} from '../js/ad-decals.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function socket(url){
  const ws=new WebSocket(url),messages=[];
  ws.addEventListener('message',event=>messages.push(JSON.parse(event.data)));
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  return {ws,send:obj=>ws.send(JSON.stringify(obj)),async wait(predicate){
    const until=Date.now()+5000;
    while(Date.now()<until){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await delay(10);}
    throw new Error('websocket timeout '+JSON.stringify(messages.slice(-3)));
  }};
}
test('two real room clients agree on deterministic diamond and host reset restores mined ore', {timeout:30000},async t=>{
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const dir=await mkdtemp(tmpdir()+'/mc-diamond-');
  const child=spawn(process.execPath,['server/server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),MC_DATA_DIR:dir,MC_OWNER_KEY:'diamond-test'}});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
  for(let i=0;i<100&&!logs.includes('http://');i++)await delay(25);
  assert.match(logs,/http:\/\//,logs);
  const host=await socket(`ws://127.0.0.1:${port}/ws`),guest=await socket(`ws://127.0.0.1:${port}/ws`);
  t.after(()=>{host.ws.close();guest.ws.close();});
  host.send({t:'create',name:'host'});const joined=await host.wait(m=>m.t==='joined');
  guest.send({t:'join',room:joined.room,name:'guest'});const second=await guest.wait(m=>m.t==='joined');
  assert.equal(second.seed,joined.seed);
  const terrain=new World(new THREE.Scene(),joined.seed),chunk=new Chunk(4,7);
  terrain.generateChunkData(chunk);
  const i=chunk.blocks.findIndex(b=>b===BlockType.DIAMOND_ORE);
  assert.ok(i>=0);
  const x=4*16+(i%16),z=7*16+(Math.floor(i/16)%16),y=Math.floor(i/256);
  const server=(await import('../server/room-boss.mjs')).CollisionWorld;
  assert.equal(new server(joined.seed,new Map()).getBlock(x,y,z),BlockType.DIAMOND_ORE);
  assert.equal(hasDiamondMicrotext(joined.seed,'overworld',x,y,z),hasDiamondMicrotext(second.seed,'overworld',x,y,z));
  host.send({t:'block',x,y,z,b:BlockType.AIR});
  const mine=await guest.wait(m=>m.t==='block'&&m.x===x&&m.y===y&&m.z===z);
  assert.equal(mine.b,BlockType.AIR);
  guest.send({t:'sync'});
  assert.ok((await guest.wait(m=>m.t==='sync')).editsByDimension.overworld.some((v,n,a)=>n%4===0&&v===x&&a[n+1]===y&&a[n+2]===z&&a[n+3]===BlockType.AIR));
  host.send({t:'terrain_reset'});await guest.wait(m=>m.t==='terrain_reset');
  guest.send({t:'sync'});assert.deepEqual((await guest.wait(m=>m.t==='sync')).editsByDimension.overworld,[]);
  assert.equal(new server(joined.seed,new Map()).getBlock(x,y,z),BlockType.DIAMOND_ORE);
  assert.doesNotMatch(logs,/TypeError|ReferenceError|SyntaxError/);
});
