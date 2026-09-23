/**
 * Grid A* pathfinding — no three.js. Radius-capped; empty array on failure.
 */
import { walkableStandY } from './nav-grid.js';

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function key(gx, gz) {
  return `${gx},${gz}`;
}

/**
 * @param {object} world getBlock(x,y,z)
 * @param {{x:number,y:number,z:number}} from
 * @param {{x:number,y:number,z:number}} to
 * @param {{radius?:number, halfW?:number, bodyH?:number, maxStep?:number}} [opts]
 * @returns {{x:number,y:number,z:number}[]}
 */
export function findPath(world, from, to, opts = {}) {
  const radius = opts.radius != null ? opts.radius : 24;
  const sx = Math.floor(from.x);
  const sz = Math.floor(from.z);
  const gx = Math.floor(to.x);
  const gz = Math.floor(to.z);
  if (Math.hypot(gx - sx, gz - sz) > radius) return [];

  const startY = walkableStandY(world, sx, sz, from.y, opts);
  if (startY === null) return [];
  const goalY = walkableStandY(world, gx, gz, to.y != null ? to.y : from.y, opts);
  if (goalY === null) return [];
  if (sx === gx && sz === gz) return [{ x: gx + 0.5, y: goalY, z: gz + 0.5 }];

  const open = [];
  const gScore = new Map();
  const fScore = new Map();
  const came = new Map();
  const yAt = new Map();
  const sk = key(sx, sz);
  gScore.set(sk, 0);
  fScore.set(sk, Math.hypot(gx - sx, gz - sz));
  yAt.set(sk, startY);
  open.push({ gx: sx, gz: sz, f: fScore.get(sk) });

  const closed = new Set();
  let guard = 0;
  const maxNodes = radius * radius * 4;

  while (open.length && guard++ < maxNodes) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    const ck = key(cur.gx, cur.gz);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.gx === gx && cur.gz === gz) {
      const path = [];
      let k = ck;
      while (k) {
        const [px, pz] = k.split(',').map(Number);
        path.push({ x: px + 0.5, y: yAt.get(k), z: pz + 0.5 });
        k = came.get(k);
      }
      path.reverse();
      return path;
    }
    const cy = yAt.get(ck);
    for (const [dx, dz] of DIRS) {
      const nx = cur.gx + dx;
      const nz = cur.gz + dz;
      if (Math.hypot(nx - sx, nz - sz) > radius) continue;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      const ny = walkableStandY(world, nx, nz, cy, opts);
      if (ny === null) continue;
      // diagonal: both ortho neighbors must be walkable
      if (dx !== 0 && dz !== 0) {
        if (walkableStandY(world, cur.gx + dx, cur.gz, cy, opts) === null) continue;
        if (walkableStandY(world, cur.gx, cur.gz + dz, cy, opts) === null) continue;
      }
      const stepCost = dx !== 0 && dz !== 0 ? 1.414 : 1;
      const tentative = (gScore.get(ck) ?? Infinity) + stepCost;
      if (tentative >= (gScore.get(nk) ?? Infinity)) continue;
      came.set(nk, ck);
      gScore.set(nk, tentative);
      yAt.set(nk, ny);
      const f = tentative + Math.hypot(gx - nx, gz - nz);
      fScore.set(nk, f);
      open.push({ gx: nx, gz: nz, f });
    }
  }
  return [];
}

/**
 * Advance along path by `step` distance. Mutates path (shifts consumed waypoints).
 * @returns {{x:number,y:number,z:number,yaw:number,arrived:boolean}|null}
 */
export function stepAlongPath(pos, path, step) {
  if (!path || !path.length) return null;
  let x = pos.x, y = pos.y, z = pos.z;
  let remain = step;
  let yaw = pos.yaw != null ? pos.yaw : 0;
  while (remain > 1e-4 && path.length) {
    const w = path[0];
    const dx = w.x - x;
    const dz = w.z - z;
    const dist = Math.hypot(dx, dz);
    if (dist <= remain || dist < 0.12) {
      x = w.x;
      y = w.y;
      z = w.z;
      remain -= dist;
      path.shift();
      if (dist > 1e-4) yaw = Math.atan2(dz, dx);
      continue;
    }
    const t = remain / dist;
    x += dx * t;
    z += dz * t;
    y = w.y;
    yaw = Math.atan2(dz, dx);
    remain = 0;
  }
  return { x, y, z, yaw, arrived: path.length === 0 };
}
