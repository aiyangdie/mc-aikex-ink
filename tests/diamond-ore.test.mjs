import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {selectDiamondOrePositions} from '../js/diamond-ore.js';
import {BlockType, Chunk, World, Dim} from '../js/voxel.js';

const samples = Array.from({length:120}, (_,i)=>({x:i%12,y:7+i%5,z:Math.floor(i/12)}));
test('deterministic candidate selection is unique, seeded and respects target quota',()=>{
  const input={seed:12345,cx:2,cz:3,solidCount:5010,candidates:samples};
  const a=selectDiamondOrePositions(input);
  assert.deepEqual(a,selectDiamondOrePositions(input));
  assert.notDeepEqual(a,selectDiamondOrePositions({...input,seed:12346}));
  assert.ok(a.length>=10 && a.length<=11);
  assert.equal(new Set(a.map(p=>`${p.x},${p.y},${p.z}`)).size,a.length);
  assert.ok(a.every(p=>samples.some(c=>c.x===p.x&&c.y===p.y&&c.z===p.z)));
});
test('diamond is appended without changing old block ids and only spawns in overworld underground stone',()=>{
  assert.equal(BlockType.PLANKS,15);
  assert.equal(BlockType.DIAMOND_ORE,16);
  const world=new World(new THREE.Scene(),12345);
  const c=new Chunk(3,3);
  world.generateChunkData(c);
  assert.ok(c.blocks.includes(BlockType.DIAMOND_ORE));
  for(const dimension of [Dim.NETHER,Dim.END]){
    world.setDimension(dimension);
    const other=new Chunk(3,3);
    world.generateChunkData(other);
    assert.ok(!other.blocks.includes(BlockType.DIAMOND_ORE));
  }
});
test('large seed sample approaches one diamond ore per 500 natural solid terrain cells',()=>{
  const world=new World(new THREE.Scene(),98765);
  let solid=0,diamonds=0;
  for(let cx=3;cx<15;cx++)for(let cz=3;cz<13;cz++){
    const chunk=new Chunk(cx,cz);
    world.generateChunkData(chunk);
    for(const b of chunk.blocks){
      if(b!==BlockType.AIR&&b!==BlockType.WATER&&b!==BlockType.LEAVES&&b!==BlockType.WOOD)solid++;
      if(b===BlockType.DIAMOND_ORE)diamonds++;
    }
  }
  assert.ok(solid>100_000);
  const ratio=diamonds/solid;
  assert.ok(ratio>=.0015&&ratio<=.0025,`ratio ${ratio} (${diamonds}/${solid})`);
});
