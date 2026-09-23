import test from 'node:test';import assert from 'node:assert/strict';
import {craterCells,resolveNuke} from '../server/room-nuke.mjs';
import {RoomTerrain} from '../server/room-terrain.mjs';
const impact={dimension:'end',origin:{x:50,y:19,z:50}};
const peer=(id,dim='overworld')=>({id,hp:20,active:true,dimension:dim,x:0,y:19,z:0});
function fixture(limit=60000){
 const caster=peer('caster'),victim=peer('victim','nether'),outsider=peer('outsider');
 const terrain=new RoomTerrain(limit),boss={hp:1500,kill(now){this.hp=0;this.respawnAt=now+60000;}};
 const room={peers:new Map([[1,caster],[2,victim]]),mobs:new Map([['m',{alive:true,hp:8}]]),boss,terrain,
  terrainRevision:0,lastNukeAt:0,touch(){this.saved=true;}};
 return {caster,victim,outsider,room,terrain};
}
test('nuke spares caster, kills all other room players and creatures and Boss',()=>{
 const {caster,victim,outsider,room,terrain}=fixture();
 const event=resolveNuke(room,caster,10000,impact);
 assert.equal(caster.hp,20);assert.equal(caster.protectedUntil,13000);assert.equal(victim.hp,0);assert.equal(victim.manualRespawn,true);
 assert.equal(outsider.hp,20);assert.equal(room.mobs.size,0);
 assert.equal(room.boss.hp,0);assert.equal(room.boss.respawnAt,70000);
 assert.equal(event.dimension,'end');assert.deepEqual(event.origin,impact.origin);assert.equal(terrain.editsArray('overworld').length,0);assert.ok(event.edits.length>0);
 assert.equal(terrain.editsArray('nether').length,0);
 assert.equal(resolveNuke(room,caster,10001,impact),null);
 assert.equal(resolveNuke(room,caster,310000,impact).edits.length>0,true);
});
test('crater bounded and capacity failure causes no partial deaths or cooldown',()=>{
 const cells=craterCells({x:0,y:19,z:0});
 assert.ok(cells.length>100);assert.ok(cells.every(([x,y,z,b])=>Math.hypot(x,y-19,z)<=12&&b===0));
 const {caster,victim,room,terrain}=fixture(2);
 assert.equal(resolveNuke(room,caster,10000,impact),null);
 assert.equal(victim.hp,20);assert.equal(room.boss.hp,1500);assert.equal(terrain.size,0);
 assert.equal(room.lastNukeAt,0);
});
test('missing or invalid trusted impact cannot settle',()=>{
 const {caster,room}=fixture();assert.equal(resolveNuke(room,caster,10000),null);assert.equal(resolveNuke(room,caster,10000,{dimension:'bad',origin:impact.origin}),null);
 caster.hp=0;assert.equal(resolveNuke(room,caster,10000,impact),null);
});
