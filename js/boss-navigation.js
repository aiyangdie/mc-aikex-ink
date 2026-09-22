import { isSolid, BlockType } from './voxel.js?v=mistboss2';

// A small grounded capsule: no teleporting through walls, ceilings, water or cliffs.
export function findStandY(world, x, z, currentY) {
  for (let y = Math.floor(currentY) + 1; y >= Math.floor(currentY) - 2; y--) {
    let clear = true;
    for (const dx of [-.32, .32]) for (const dz of [-.32, .32]) {
      const bx = Math.floor(x + dx), bz = Math.floor(z + dz);
      if (!isSolid(world.getBlock(bx, y - 1, bz))) { clear = false; continue; }
      for (let by = y; by < y + 2; by++) {
        const block = world.getBlock(bx, by, bz);
        if (isSolid(block) || block === BlockType.WATER) clear = false;
      }
    }
    if (clear) return y;
  }
  return null;
}

export function hasLineOfSight(world, a, b) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z) * 5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isSolid(world.getBlock(Math.floor(a.x+(b.x-a.x)*t),
      Math.floor(a.y+1+(b.y-a.y)*t), Math.floor(a.z+(b.z-a.z)*t)))) return false;
  }
  return true;
}
