import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {selectAdDecals, AD_TEXT, AD_MAX_PER_CHUNK} from '../js/ad-decals.js';
import {BlockType, Chunk, World, Dim} from '../js/voxel.js';

const floor = (x,y,z) => y === 20 && x >= 0 && x < 16 && z >= 0 && z < 16 ? BlockType.GRASS : BlockType.AIR;
const select = (dimension='overworld', getBlock=floor) => selectAdDecals({seed:12345,dimension,cx:0,cz:0,getBlock});

test('decal positions are repeatable for seed/dimension/coordinates and vary by dimension', () => {
  assert.deepEqual(select(),select());
  assert.notDeepEqual(select(),select('nether'));
  assert.notDeepEqual(select(),selectAdDecals({seed:12346,dimension:'overworld',cx:0,cz:0,getBlock:floor}));
});
test('selection is sparse, bounded per chunk and only uses exposed eligible block faces', () => {
  const ads=select();
  assert.ok(ads.length > 0 && ads.length <= AD_MAX_PER_CHUNK);
  for(const ad of ads){
    assert.equal(floor(ad.x,ad.y,ad.z),BlockType.GRASS);
    assert.deepEqual(ad.face,[0,1,0]);
  }
  assert.deepEqual(select('overworld',()=>BlockType.AIR),[]);
  assert.deepEqual(select('overworld',(x,y,z)=> y===20 ? BlockType.WATER : BlockType.AIR),[]);
  assert.deepEqual(select('overworld',()=>BlockType.STONE),[]);
});
test('removed blocks and newly covered faces no longer have decals', () => {
  const ad=select()[0];
  const removed=(x,y,z)=> x===ad.x&&y===ad.y&&z===ad.z?BlockType.AIR:floor(x,y,z);
  assert.ok(!select('overworld',removed).some(a=>a.x===ad.x&&a.y===ad.y&&a.z===ad.z));
  const covered=(x,y,z)=>x===ad.x&&y===ad.y+1&&z===ad.z?BlockType.STONE:floor(x,y,z);
  assert.ok(!select('overworld',covered).some(a=>a.x===ad.x&&a.y===ad.y&&a.z===ad.z));
});
test('rendered text is the exact approved Chinese phrase and domain',()=>{
  assert.equal(AD_TEXT,'激情大戏：spb.biily.top');
});
test('chunk rebuild and unload dispose decal geometry while sharing material',()=>{
  const scene=new THREE.Scene(),world=new World(scene,12345),chunk=new Chunk(0,0);
  for(let x=0;x<16;x++)for(let z=0;z<16;z++)chunk.setBlock(x,20,z,BlockType.GRASS);
  world.chunks.set('0,0',chunk);
  const material=new THREE.MeshBasicMaterial();
  world.adMaterial=material;
  world.configureChunkDecals(chunk);
  const get=(x,y,z)=>world.getBlock(x,y,z);
  chunk.buildMesh(get,material,material);
  assert.ok(chunk.adMesh && chunk.adMesh.geometry.getAttribute('position').count > 0);
  const old=chunk.adMesh.geometry;
  let disposed=false;old.addEventListener('dispose',()=>{disposed=true;});
  const first=chunk.adEntries[0];
  world.setBlock(first.x,first.y,first.z,BlockType.AIR);
  assert.equal(chunk.adMesh,null,'edit immediately removes stale decal');
  assert.equal(disposed,true);
  world.setBlock(first.x,first.y,first.z,BlockType.GRASS);
  chunk.buildMesh(get,material,material);
  assert.ok(chunk.adMesh);
  const newGeo=chunk.adMesh.geometry;
  let unloadDisposed=false;newGeo.addEventListener('dispose',()=>{unloadDisposed=true;});
  chunk.dispose();
  assert.equal(unloadDisposed,true);
  assert.equal(chunk.adMesh,null);
  material.dispose();
});
test('world teardown releases shared decal material and texture exactly once',()=>{
  const world=new World(new THREE.Scene());
  const map=new THREE.Texture();
  const material=new THREE.MeshBasicMaterial({map});
  let mapDisposed=0,materialDisposed=0;
  map.addEventListener('dispose',()=>mapDisposed++);
  material.addEventListener('dispose',()=>materialDisposed++);
  world.adMaterial=material;
  world.dispose();
  assert.equal(mapDisposed,1);
  assert.equal(materialDisposed,1);
  assert.equal(world.adMaterial,null);
});
