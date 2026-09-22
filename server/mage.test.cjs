const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Spells} = require('./mage.cjs');
const combat = require('./combat.cjs');
const player = id => { const p = {id,x:0,y:10,z:0}; combat.init(p); p.mode='mage'; return p; };
test('fireball flight, impact, 5 second burning, expiry and dimension isolation', () => {
  const spells=new Spells(), a=player('a'), b=player('b'), c=player('c');
  b.z=-5; c.z=-5; c.dimension='nether';
  const msg={end:[0,10.1,-5],ground:[0,10.02,-5]};
  const ball=spells.cast(a,msg,1000); assert.ok(ball);
  assert.equal(spells.cast(a,msg,1100),null);
  const events=[]; const tick=now=>spells.tick([a,b,c],now,m=>events.push(m));
  tick(ball.impact-1); assert.equal(b.hp,20);
  tick(ball.impact); assert.equal(b.hp,14); assert.equal(a.hp,20); assert.equal(c.hp,20);
  assert.equal(spells.fires[0].expires,ball.impact+5000);
  assert.equal(spells.snapshot(ball.impact+4999).fires.length,1);
  tick(ball.impact+500); assert.equal(b.hp,12);
  b.protectedUntil=ball.impact+2000; tick(ball.impact+1000); assert.equal(b.hp,12);
  tick(ball.impact+5000); assert.equal(spells.fires.length,0); assert.equal(b.hp,12);
  assert.equal(spells.snapshot(ball.impact+5000).fires.length,0);
});
test('blink for all classes, cooldown, range and dead block', () => {
  const spells = new Spells();
  const p = player('p');
  assert.equal(spells.cast(p, { end: [100, 10, 0] }, 0), null);
  assert.equal(spells.cast(p, { end: [NaN, 10, 0] }, 0), null);
  assert.equal(spells.cast(p, { end: [0, 10, 0], ground: [8, 10, 0] }, 0), null);

  p.mode = 'ak';
  assert.equal(spells.blink(p, { to: [0, 10, 5] }, 1000), true);
  assert.equal(p.z, 5);
  assert.equal(spells.blink(p, { to: [0, 10, 6] }, 2000), false); // CD 3.2s
  assert.equal(spells.blink(p, { to: [0, 10, 20] }, 5000), false); // too far from z=5
  assert.equal(spells.blink(p, { to: [0, 10, 8] }, 5000), true);
  assert.equal(p.z, 8);

  p.mode = 'build';
  assert.equal(spells.blink(p, { to: [0, 10, 10] }, 9000), true);

  p.hp = 0;
  assert.equal(spells.cast(p, { end: [0, 10, 0] }, 12000), null);
  assert.equal(spells.blink(p, { to: [0, 10, 1] }, 15000), false);
});
