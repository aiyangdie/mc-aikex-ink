import test from 'node:test';
import assert from 'node:assert/strict';

const { findStandY, walkableStandY, hasLineOfSight, isNavSolid } = await import('../js/nav-grid.js');

const flat = { getBlock: (x, y, z) => (y <= 0 ? 3 : 0) };

test('flat ground is standable at y=1', () => {
  assert.equal(findStandY(flat, 2, 2, 1), 1);
});

test('one-block step up is allowed', () => {
  const step = { getBlock: (x, y, z) => (y <= 0 || (x >= 2 && y === 1) ? 3 : 0) };
  assert.equal(findStandY(step, 2.5, 2.5, 1), 2);
  assert.equal(walkableStandY(step, 2, 2, 1), 2);
});

test('tall wall is not standable', () => {
  const wall = { getBlock: (x, y, z) => (y <= 0 || (x >= 2 && y <= 4) ? 3 : 0) };
  assert.equal(findStandY(wall, 2.5, 2.5, 1), null);
});

test('cliff below lookDown is rejected', () => {
  const cliff = { getBlock: (x, y, z) => (y <= -5 ? 3 : 0) };
  assert.equal(findStandY(cliff, 2, 2, 1), null);
});

test('water is not walkable body space', () => {
  const water = {
    getBlock: (x, y, z) => {
      if (y <= 0) return 3;
      if (y === 1) return 7; // WATER
      return 0;
    },
  };
  assert.equal(findStandY(water, 1.5, 1.5, 1), null);
});

test('LOS blocked by solid wall', () => {
  const a = { x: 0.5, y: 1, z: 0.5 };
  const b = { x: 2.5, y: 1, z: 0.5 };
  assert.equal(hasLineOfSight(flat, a, b), true);
  const wall = { getBlock: (x, y, z) => (y <= 0 || (x === 1 && y <= 3) ? 3 : 0) };
  assert.equal(hasLineOfSight(wall, a, b), false);
});

test('isNavSolid matches air/water/portal', () => {
  assert.equal(isNavSolid(0), false);
  assert.equal(isNavSolid(7), false);
  assert.equal(isNavSolid(13), false);
  assert.equal(isNavSolid(3), true);
});
