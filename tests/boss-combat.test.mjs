import test from 'node:test';
import assert from 'node:assert/strict';
let BossCombat;
try { ({ BossCombat } = await import('../js/boss-combat.js')); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
const target = (distance = 1) => ({ distance, height: 0, visible: true, playerAlive: true, invulnerable: false });
test('Boss survives 1499 damage and dies at 1500; cannot attack after death', () => {
  assert.ok(BossCombat, 'Boss combat implementation is missing');
  const b = new BossCombat();
  b.takeDamage(1499); assert.equal(b.hp, 1); assert.equal(b.dead, false);
  b.takeDamage(1); assert.equal(b.hp, 0); assert.equal(b.dead, true);
  assert.equal(b.step(.05, target()).hit, 0);
});
test('approaches a visible player, but not an unseen or dead player', () => {
  assert.ok(BossCombat, 'Boss combat implementation is missing');
  const b = new BossCombat();
  assert.equal(b.step(.05, target(10)).move, true);
  assert.equal(b.step(.05, {...target(10), visible:false}).move, false);
  assert.equal(b.step(.05, {...target(10), playerAlive:false}).move, false);
});
test('four timed swings kill a 20 HP player, one hit per swing', () => {
  assert.ok(BossCombat, 'Boss combat implementation is missing');
  const b = new BossCombat(); let hp = 20, hits = 0;
  assert.equal(b.step(.05, target()).hit, 0); // wind-up, not contact damage
  for(let i=0;i<120;i++) { const r=b.step(.05,{...target(),playerAlive:hp>0}); if(r.hit){hp-=r.hit;hits++;} }
  assert.equal(hits,4); assert.equal(hp,0);
});
test('moving out of reach or behind a wall during wind-up avoids damage', () => {
  assert.ok(BossCombat, 'Boss combat implementation is missing');
  for(const escaped of [target(5), {...target(),visible:false}, {...target(),height:4}, {...target(),invulnerable:true}]){
    const b=new BossCombat(); b.step(.05,target()); let damage=0;
    for(let i=0;i<15;i++) damage+=b.step(.05,escaped).hit;
    assert.equal(damage,0);
  }
});
test('invalid and negative damage cannot heal or poison HP', () => {
  assert.ok(BossCombat, 'Boss combat implementation is missing');
  const b=new BossCombat(); for(const n of [-20,NaN,Infinity]) b.takeDamage(n);
  assert.equal(b.hp,1500);
});
