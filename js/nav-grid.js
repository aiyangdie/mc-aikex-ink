/**
 * Shared nav grid helpers — no three.js dependency.
 * Block ids mirror voxel.js (AIR/WATER/PORTAL non-solid; LEAVES not standable).
 */

export const NAV_AIR = 0;
export const NAV_LEAVES = 6;
export const NAV_WATER = 7;
export const NAV_PORTAL = 13;

const NON_SOLID = new Set([NAV_AIR, NAV_WATER, NAV_PORTAL]);

export function isNavSolid(type) {
  return !NON_SOLID.has(type | 0);
}

export function isStandableFloor(type) {
  return isNavSolid(type) && (type | 0) !== NAV_LEAVES;
}

/**
 * Find a standable Y for a capsule centered at (x,z).
 * @returns {number|null} feet Y, or null if no safe stand nearby
 */
export function findStandY(world, x, z, currentY, opts = {}) {
  const halfW = opts.halfW != null ? opts.halfW : 0.32;
  const bodyH = opts.bodyH != null ? opts.bodyH : 2;
  const up = opts.lookUp != null ? opts.lookUp : 1;
  const down = opts.lookDown != null ? opts.lookDown : 2;
  const base = Math.floor(currentY);
  for (let y = base + up; y >= base - down; y--) {
    if (y < 1) continue;
    let clear = true;
    for (const dx of [-halfW, halfW]) {
      for (const dz of [-halfW, halfW]) {
        const bx = Math.floor(x + dx);
        const bz = Math.floor(z + dz);
        const floor = world.getBlock(bx, y - 1, bz);
        if (!isStandableFloor(floor)) {
          clear = false;
          break;
        }
        for (let by = y; by < y + bodyH; by++) {
          const block = world.getBlock(bx, by, bz);
          if (isNavSolid(block) || block === NAV_WATER) {
            clear = false;
            break;
          }
        }
        if (!clear) break;
      }
      if (!clear) break;
    }
    if (clear) return y;
  }
  return null;
}

/** Cell walkable from fromY (max one-block step). Returns stand Y or null. */
export function walkableStandY(world, gx, gz, fromY, opts = {}) {
  const maxStep = opts.maxStep != null ? opts.maxStep : 1.05;
  const cx = gx + 0.5;
  const cz = gz + 0.5;
  const y = findStandY(world, cx, cz, fromY, opts);
  if (y === null) return null;
  if (Math.abs(y - fromY) > maxStep) return null;
  return y;
}

export function hasLineOfSight(world, a, b) {
  const ax = a.x, ay = a.y, az = a.z;
  const bx = b.x, by = b.y, bz = b.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) * 5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(ax + (bx - ax) * t);
    const y = Math.floor(ay + 1 + (by - ay) * t);
    const z = Math.floor(az + (bz - az) * t);
    if (isNavSolid(world.getBlock(x, y, z))) return false;
  }
  return true;
}

/**
 * Unstick: try adjacent cells (and one up) for a standable foot position.
 * @returns {{x:number,y:number,z:number}|null}
 */
export function findUnstickPos(world, x, y, z, opts = {}) {
  const candidates = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 0], [-2, 0], [0, 2], [0, -2],
  ];
  for (const [dx, dz] of candidates) {
    const nx = Math.floor(x) + dx + 0.5;
    const nz = Math.floor(z) + dz + 0.5;
    const stand = findStandY(world, nx, nz, y + (dx === 0 && dz === 0 ? 1 : 0), {
      ...opts,
      lookUp: 2,
      lookDown: 3,
    });
    if (stand !== null) return { x: nx, y: stand, z: nz };
  }
  return null;
}
