import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
// Browser progress event required by Three's data-URI loader in Node.
globalThis.ProgressEvent ??= class ProgressEvent extends Event { constructor(type, init={}) { super(type); Object.assign(this,init); } };
let MistBoss;
try {({MistBoss}=await import('../js/mist-boss.js'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
async function modelWithoutTextures(){
  // Node has no image decoder. Keep the actual geometry/skins/animation binary;
  // only omit image materials. Full textured GLB is verified in the browser.
  const b=await readFile(new URL('../assets/models/mist-heroine.glb',import.meta.url));
  const n=b.readUInt32LE(12), json=JSON.parse(b.subarray(20,20+n));
  const bin=b.subarray(28+n);
  delete json.images; delete json.textures; delete json.materials;
  for(const m of json.meshes)for(const p of m.primitives)delete p.material;
  json.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');
  return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
test('original rig runs, holds a blade, chases, can be hit and disposes',async()=>{
  assert.ok(MistBoss,'MistBoss implementation missing');
  const scene=new THREE.Scene(), world={getBlock:(x,y,z)=>y<=0?3:0};
  const b=new MistBoss(scene,world,{x:0,y:1,z:0});
  b.installModel(await modelWithoutTextures());
  assert.ok(b.ready); assert.ok(b.actions.run); assert.ok(b.actions.slash);
  assert.ok(b.sword.parent.isBone);
  assert.ok(b.hitDistance(new THREE.Vector3(0,2,5),new THREE.Vector3(0,0,-1),7)<7);
  const player={position:new THREE.Vector3(0,1,10),hp:20,invuln:0};
  for(let i=0;i<20;i++)b.update(.05,player);
  assert.ok(b.position.z>2,'must approach player');
  b.takeDamage(1500); assert.equal(b.dead,true);
  const pos=b.position.clone();b.update(.05,player);assert.ok(b.position.equals(pos));
  b.dispose();assert.equal(scene.children.length,0);
});
test('network-driven model never runs its own attack AI',async()=>{
  assert.ok(MistBoss.prototype.applyNetState,'network pose support missing');
  const b=new MistBoss(new THREE.Scene(),{getBlock:(x,y,z)=>y<=0?3:0},{x:0,y:1,z:0});
  b.installModel(await modelWithoutTextures());
  b.applyNetState({x:0,y:1,z:0,yaw:0,hp:1490,state:'attack',attackId:1,attackTime:.2});
  const p={position:new THREE.Vector3(0,1,1),hp:20,invuln:0};
  for(let i=0;i<100;i++)assert.equal(b.update(.05,p),0);
  assert.equal(b.hp,1490);assert.equal(p.hp,20);b.dispose();
});
test('loaded rig is grounded even if no renderer updated its parent transform yet',async()=>{
 const b=new MistBoss(new THREE.Scene(),{getBlock:()=>0},{x:5,y:19,z:8});
 b.installModel(await modelWithoutTextures());
 b.group.updateMatrixWorld(true);
 // Exclude the held sword, which can extend below the hand.
 const sword=b.sword;b.sword.removeFromParent();
 b.model.traverse(o=>{if(o.isSkinnedMesh)o.computeBoundingBox();});
 const bounds=new THREE.Box3().setFromObject(b.model);
 assert.ok(Math.abs(bounds.min.y-19)<.1,`feet at ${bounds.min.y}, expected ground 19`);
 const center=bounds.getCenter(new THREE.Vector3());
 assert.ok(Math.abs(center.x-5)<.1&&Math.abs(center.z-8)<.1,'visual body must align with collision position');
 b.dispose();sword.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});
});
