import test from 'node:test';
import assert from 'node:assert/strict';

const { findPath, stepAlongPath } = await import('../js/pathfind.js');

const flat = { getBlock: (x, y, z) => (y <= 0 ? 3 : 0) };

test('short path on flat ground has a solution', () => {
  const path = findPath(flat, { x: 1.5, y: 1, z: 1.5 }, { x: 5.5, y: 1, z: 1.5 }, { radius: 24 });
  assert.ok(path.length >= 2);
  assert.ok(Math.abs(path[path.length - 1].x - 5.5) < 0.01);
});

test('wall blocks straight path; A* goes around', () => {
  // wall at x=3, z=0..4, height 1-4
  const maze = {
    getBlock: (x, y, z) => {
      if (y <= 0) return 3;
      if (x === 3 && z >= 0 && z <= 4 && y >= 1 && y <= 4) return 3;
      return 0;
    },
  };
  const path = findPath(maze, { x: 1.5, y: 1, z: 2.5 }, { x: 5.5, y: 1, z: 2.5 }, { radius: 24 });
  assert.ok(path.length > 2, 'expected detour path');
  // never stand inside the wall slab (x=3, z=0..4)
  for (const p of path) {
    const gx = Math.floor(p.x), gz = Math.floor(p.z);
    assert.ok(!(gx === 3 && gz >= 0 && gz <= 4), `path through wall at ${gx},${gz}`);
  }
});

test('unreachable beyond radius returns empty', () => {
  const path = findPath(flat, { x: 0.5, y: 1, z: 0.5 }, { x: 80.5, y: 1, z: 0.5 }, { radius: 24 });
  assert.equal(path.length, 0);
});

test('stepAlongPath advances and consumes waypoints', () => {
  const path = [
    { x: 2.5, y: 1, z: 1.5 },
    { x: 3.5, y: 1, z: 1.5 },
  ];
  const moved = stepAlongPath({ x: 1.5, y: 1, z: 1.5, yaw: 0 }, path, 1.2);
  assert.ok(moved);
  assert.ok(moved.x > 1.5);
  assert.ok(path.length <= 2);
});
