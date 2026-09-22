import test from 'node:test';
import assert from 'node:assert/strict';
let findStandY, hasLineOfSight;
try { ({findStandY,hasLineOfSight}=await import('../js/boss-navigation.js')); } catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
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
