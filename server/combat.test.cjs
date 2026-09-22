const { test } = require('node:test');
const assert = require('node:assert/strict');
const combat = require('./combat.cjs');
function player(id, z) {
  const p = { id, x: 0, y: 20, z, yaw: 0, pitch: 0 }; combat.init(p); return p;
}
const aim = { direction: [0, 0, -1], distance: 80 };
test('nearest player, damage, fire rate, death, respawn and protection', () => {
  const a = player('a', 0), b = player('b', -10), c = player('c', -20);
  const peers = [a, b, c];
  assert.equal(combat.shoot(a, peers, aim, 1000).target, b);
  assert.equal(b.hp, 15); assert.equal(c.hp, 20);
  assert.equal(combat.shoot(a, peers, aim, 1050), null);
  for (const t of [1130, 1260, 1390]) combat.shoot(a, peers, aim, t);
  assert.equal(b.hp, 0); assert.equal(b.deadUntil, 4390);
  assert.equal(combat.shoot(b, peers, aim, 1500), null);
  assert.equal(combat.respawn(b, 4389), false);
  assert.equal(combat.respawn(b, 4390), true); assert.equal(b.hp, 20);
  assert.equal(combat.hurt(b, 5, 4400), false);
  assert.equal(combat.hurt(b, 5, 6400), true);
});
test('misses, terrain occlusion distance, dimensions and invalid input', () => {
  const a = player('a', 0), b = player('b', -10);
  assert.equal(combat.shoot(a, [a,b], { ...aim, distance: 5 }, 1000).target, null);
  assert.equal(b.hp, 20);
  b.dimension = 'nether';
  assert.equal(combat.shoot(a, [a,b], aim, 1200).target, null);
  assert.equal(combat.shoot(a, [a,b], { ...aim, direction: [NaN,0,-1] }, 1400), null);
  b.dimension = 'overworld'; b.x = 5;
  assert.equal(combat.shoot(a, [a,b], aim, 1500).target, null);
});
