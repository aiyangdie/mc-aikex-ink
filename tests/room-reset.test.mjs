import test from 'node:test';import assert from 'node:assert/strict';
import {resetRoomTerrain,nextHost} from '../server/room-authority.mjs';
import {RoomTerrain} from '../server/room-terrain.mjs';
test('only current host ID resets all dimensions but Boss timer remains',()=>{
 const host={id:'h',name:'renamed'},guest={id:'g',name:'h'};
 const terrain=new RoomTerrain();terrain.setBlock(1,20,1,0,'nether');terrain.setBlock(2,20,1,0,'end');
 const room={hostId:'h',terrain,boss:{respawnAt:61000},terrainRevision:7,touch(){this.saved=true;}};
 assert.equal(resetRoomTerrain(room,guest),false);
 assert.equal(room.terrainRevision,7);
 assert.equal(resetRoomTerrain(room,host),true);
 assert.deepEqual(terrain.editsArray('nether'),[]);assert.deepEqual(terrain.editsArray('end'),[]);
 assert.equal(room.terrainRevision,8);assert.equal(room.boss.respawnAt,61000);
 assert.equal(nextHost(new Map([[1,guest],[2,host]])),'g');
});
