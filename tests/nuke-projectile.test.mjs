import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomTerrain} from '../server/room-terrain.mjs';
import {CollisionWorld,RoomBoss} from '../server/room-boss.mjs';
import {World,Chunk,CHUNK_SIZE,CHUNK_HEIGHT,isSolid} from '../js/voxel.js';
import * as api from '../server/nuke-projectile.mjs';
function fixture(limit=60000){
 const peer={id:'owner',active:true,hp:20,nukeUnlocked:true,x:.5,y:35,z:.5,yaw:0,pitch:0,dimension:'overworld'};
 const terrain=new RoomTerrain(limit),collision=new CollisionWorld(123,terrain.getEdits());
 const room={seed:123,terrain,collision,peers:new Map([[1,peer]]),mobs:new Map(),boss:new RoomBoss(collision),lastNukeAt:0,terrainRevision:0,touch(){}};
 return {room,peer};
}
test('launch uses peer pose, ignores extra client coordinates and reserves exactly one projectile',()=>{
 const {room,peer}=fixture();
 const p=api.beginNukeThrow(room,peer,10000,{x:999,y:999,z:999,dimension:'end'});
 assert.equal(p.ownerId,'owner');assert.equal(p.dimension,'overworld');assert.equal(p.x,.5);assert.equal(p.z,.5);assert.ok(p.y>35&&p.y<37);
 assert.equal(p.vx,0);assert.equal(p.vy,0);assert.ok(p.vz<0);
 assert.equal(room.lastNukeAt,10000);assert.equal(room.nukeProjectile,p);
 assert.equal(api.beginNukeThrow(room,peer,10000),null);
});
test('rejects unauthorized, invalid and cooling down throws without changing state',()=>{
 for(const patch of [{nukeUnlocked:false},{hp:0},{active:false},{x:Infinity},{x:4097},{y:-1},{y:48},{yaw:NaN},{pitch:Infinity},{dimension:'fake'}]){
  const {room,peer}=fixture();Object.assign(peer,patch);assert.equal(api.beginNukeThrow(room,peer,10000),null);assert.equal(room.lastNukeAt,0);
 }
 const {room,peer}=fixture();assert.equal(api.beginNukeThrow(room,{...peer},10000),null);
 room.lastNukeAt=9999;assert.equal(api.beginNukeThrow(room,peer,10000),null);
});
test('fixed clock applies ballistic gravity and stops at first solid voxel without tunnelling',()=>{
 const {room,peer}=fixture();const p=api.beginNukeThrow(room,peer,10000);const y=p.y;
 let result=api.stepNukeProjectile(room,p,.05,10050);
 assert.equal(result.status,'flying');assert.ok(p.z<.5);assert.ok(Math.abs(p.y-(y-.02))<1e-9);assert.ok(Math.abs(p.vy+.8)<1e-9);
 // A solid wall spanning the path, with another wall behind it.
 for(let yy=20;yy<48;yy++)for(const z of [-3,-7])room.terrain.setBlock(0,yy,z,1);
 result=api.stepNukeProjectile(room,p,.5,10550);
 assert.equal(result.status,'impact');assert.equal(Math.floor(result.event.origin.z),-3);
 assert.equal(room.nukeProjectile,null);assert.equal(api.stepNukeProjectile(room,p,.1,10650),null);
});
test('timeout settles by three seconds and disconnected owner does not spare new connection',()=>{
 const {room,peer}=fixture();peer.pitch=Math.PI/2;const p=api.beginNukeThrow(room,peer,10000);
 room.peers.clear();const reconnected={...peer,id:'new-owner'};room.peers.set(2,reconnected);
 const result=api.stepNukeProjectile(room,p,.05,13000);
 assert.equal(result.status,'impact');assert.equal(reconnected.hp,0);assert.equal(result.event.casterId,'owner');
 assert.equal(room.lastNukeAt,10000);
});
test('capacity failure rolls reserved cooldown back and leaves all life intact',()=>{
 const {room,peer}=fixture(2);room.lastNukeAt=1;const p=api.beginNukeThrow(room,peer,310001);
 const result=api.stepNukeProjectile(room,p,.05,313001);
 assert.equal(result.status,'rejected');assert.equal(room.lastNukeAt,1);assert.equal(peer.hp,20);assert.equal(room.terrain.size,0);assert.equal(room.boss.hp,1500);
});
test('collision reads live edits from the projectile dimension only',()=>{
 const {room,peer}=fixture();peer.dimension='end';peer.x=100.5;peer.z=100.5;
 // Clear this flight corridor in End, including its generated terrain.
 for(let z=90;z<=101;z++)for(let y=25;y<40;y++)room.terrain.setBlock(100,y,z,0,'end');
 for(let y=25;y<40;y++){
  room.terrain.setBlock(100,y,99,1,'overworld');room.terrain.setBlock(100,y,96,1,'end');
 }
 const p=api.beginNukeThrow(room,peer,10000);
 const result=api.stepNukeProjectile(room,p,.5,10500);
 assert.equal(result.status,'impact');assert.equal(Math.floor(result.event.origin.z),96);assert.equal(result.event.dimension,'end');
 assert.equal(room.terrain.getEdits('overworld').get('100,35,99'),1);
});
test('world boundary settles at the last valid location rather than creating out-of-bounds edits',()=>{
 const {room,peer}=fixture();peer.x=4095.9;peer.yaw=-Math.PI/2;
 const p=api.beginNukeThrow(room,peer,10000),result=api.stepNukeProjectile(room,p,.05,10050);
 assert.equal(result.status,'impact');assert.ok(result.event.origin.x<=4096);
 assert.ok(result.event.edits.every(([x,y,z])=>Math.abs(x)<=4096&&Math.abs(z)<=4096&&y>=0&&y<48));
});
test('sweep hits the first solid voxel even when a segment only grazes its corner',()=>{
 const {room,peer}=fixture();Object.assign(peer,{x:.98,y:34,z:1.04,yaw:-Math.PI/4});
 for(let x=-1;x<=2;x++)for(let z=-1;z<=2;z++)room.terrain.setBlock(x,35,z,0);
 room.terrain.setBlock(1,35,1,1);
 const p=api.beginNukeThrow(room,peer,10000);
 const result=api.stepNukeProjectile(room,p,.005,10005);
 assert.equal(result.status,'impact');
 assert.deepEqual([result.event.origin.x,result.event.origin.y,result.event.origin.z].map(Math.floor),[1,35,1]);
 assert.ok(result.event.origin.x<1.001);
});
test('an embedded launch settles before leaving the initial solid voxel',()=>{
 const {room,peer}=fixture();Object.assign(peer,{x:.999,y:34,z:.5,yaw:-Math.PI/2});
 room.terrain.setBlock(0,35,0,1);room.terrain.setBlock(1,35,0,0);
 const p=api.beginNukeThrow(room,peer,10000);
 const result=api.stepNukeProjectile(room,p,.005,10005);
 assert.equal(result.status,'impact');assert.deepEqual(result.event.origin,{x:.999,y:35.5,z:.5});
});

// Regression: assigning dimension without setDimension retains overworld noise.
for(const dimension of ['overworld','nether','end'])test(`natural ${dimension} collision matches client-generated chunks`,()=>{
 const client=new World(null,12345);client.setDimension(dimension);
 const collision=new CollisionWorld(12345,new Map(),dimension);
 for(const [cx,cz] of [[0,0],[-3,-3],[-3,-2],[2,1]]){
  const chunk=new Chunk(cx,cz);client.generateChunkData(chunk);
  client.chunks.set(client.chunkKey(cx,cz),chunk);
  for(let x=cx*CHUNK_SIZE;x<(cx+1)*CHUNK_SIZE;x++)
   for(let z=cz*CHUNK_SIZE;z<(cz+1)*CHUNK_SIZE;z++)
    for(let y=0;y<CHUNK_HEIGHT;y++)
     assert.equal(collision.getBlock(x,y,z),client.getBlock(x,y,z),`${dimension} ${x},${y},${z}`);
 }
});
for(const [dimension,x,z,surfaceY] of [['nether',-48,-48,15],['end',-48,-25,17]])
 test(`projectile hits unedited ${dimension} surface, not incorrectly seeded terrain`,()=>{
  const client=new World(null,12345);client.setDimension(dimension);
  const chunk=new Chunk(Math.floor(x/CHUNK_SIZE),Math.floor(z/CHUNK_SIZE));
  client.generateChunkData(chunk);client.chunks.set(client.chunkKey(chunk.cx,chunk.cz),chunk);
  assert.ok(isSolid(client.getBlock(x,surfaceY,z)));
  assert.equal(client.getBlock(x,surfaceY+1,z),0);
  const {room,peer}=fixture();room.seed=12345;
  Object.assign(peer,{dimension,x:x+.5,z:z+.5,y:surfaceY+2,pitch:-Math.PI/2});
  assert.equal(room.terrain.size,0,'no artificial corridor or surface edits');
  const p=api.beginNukeThrow(room,peer,10000);
  const result=api.stepNukeProjectile(room,p,.5,10500);
  assert.equal(result.status,'impact');
  assert.equal(result.event.dimension,dimension);
  assert.deepEqual(['x','y','z'].map(axis=>Math.floor(result.event.origin[axis])),[x,surfaceY,z]);
 });
