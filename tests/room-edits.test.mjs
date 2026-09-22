import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomTerrain} from '../server/room-terrain.mjs';
test('legacy edits migrate to overworld and other dimensions stay isolated',()=>{
 const terrain=RoomTerrain.fromPersist({edits:[1,19,2,3]});
 assert.deepEqual(terrain.editsArray('overworld'),[1,19,2,3]);
 assert.deepEqual(terrain.editsArray('nether'),[]);
 assert.equal(terrain.setBlock(1,19,2,0,'nether'),true);
 assert.deepEqual(terrain.editsArray('overworld'),[1,19,2,3]);
 assert.deepEqual(terrain.editsArray('nether'),[1,19,2,0]);
 const resumed=RoomTerrain.fromPersist({editsByDimension:terrain.toJSON()});
 assert.deepEqual(resumed.editsArray('nether'),[1,19,2,0]);
});
test('capacity preflight is atomic across the whole batch',()=>{
 const terrain=new RoomTerrain(2);
 terrain.setBlock(0,19,0,3,'overworld');
 assert.equal(terrain.applyBatch([[1,19,0,0],[2,19,0,0]],'overworld'),false);
 assert.deepEqual(terrain.editsArray('overworld'),[0,19,0,3]);
});
