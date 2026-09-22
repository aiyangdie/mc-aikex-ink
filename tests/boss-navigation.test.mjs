import test from 'node:test';
import assert from 'node:assert/strict';
let findStandY, findGroundStep, hasLineOfSight;
try { ({findStandY,findGroundStep,hasLineOfSight}=await import('../js/boss-navigation.js')); } catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const flat={getBlock:(x,y,z)=>y<=0?3:0};
test('Boss stands on ground and steps up one block, never a tall wall or cliff',()=>{
  assert.ok(findStandY,'navigation implementation missing');
  assert.equal(findStandY(flat,2,2,1),1);
  const step={getBlock:(x,y,z)=>y<=0||(x>=2&&y===1)?3:0};
  assert.equal(findStandY(step,2.5,2.5,1),2);
  const wall={getBlock:(x,y,z)=>y<=0||(x>=2&&y<=4)?3:0};
  assert.equal(findStandY(wall,2.5,2.5,1),null);
  const cliff={getBlock:(x,y,z)=>y<=-5?3:0};
  assert.equal(findStandY(cliff,2,2,1),null);
});
test('body clearance checks width as well as height',()=>{
  assert.ok(findStandY,'navigation implementation missing');
  const wall={getBlock:(x,y,z)=>y<=0||(x===1&&y<=5)?3:0};
  assert.equal(findStandY(wall,.8,2,1),null);
});
test('solid wall blocks melee sight',()=>{
  assert.ok(hasLineOfSight,'navigation implementation missing');
  const a={x:.5,y:1,z:.5},b={x:2.5,y:1,z:.5};
  assert.equal(hasLineOfSight(flat,a,b),true);
  const wall={getBlock:(x,y,z)=>y<=0||(x===1&&y<=3)?3:0};
  assert.equal(hasLineOfSight(wall,a,b),false);
});
test('ground step chooses a safe side step around a low obstacle',()=>{
  assert.ok(findGroundStep,'ground-step implementation missing');
  const wall={getBlock:(x,y,z)=>y<=0||(x>=1&&x<=2&&z>=-1&&z<=1&&y<=2)?3:0};
  const step=findGroundStep(wall,{x:.5,y:1,z:0},{x:4,y:1,z:0},{step:.5,maxStep:1.05});
  assert.ok(step);
  assert.ok(Math.abs(step.z) > .1);
  assert.equal(Math.abs(step.y-1)<=1.05,true);
});
