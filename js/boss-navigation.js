/**
 * Boss / creature navigation — shared stand/LOS from nav-grid; findGroundStep kept for callers.
 */
import { findStandY } from './nav-grid.js';

export {
  findStandY,
  hasLineOfSight,
  walkableStandY,
  findUnstickPos,
  isNavSolid,
} from './nav-grid.js';

/**
 * Choose one safe movement step around an obstacle.
 */
export function findGroundStep(world, from, target, options = {}) {
  const step = options.step ?? 0.15;
  const maxStep = options.maxStep ?? 1.05;
  const halfW = options.halfW;
  const bodyH = options.bodyH;
  const navOpts = {};
  if (halfW != null) navOpts.halfW = halfW;
  if (bodyH != null) navOpts.bodyH = bodyH;
  const angle = Math.atan2(target.x - from.x, target.z - from.z);
  const offsets = [0, .45, -.45, .9, -.9, 1.35, -1.35, Math.PI];
  for (const offset of offsets) {
    const a = angle + offset;
    const x = from.x + Math.sin(a) * step;
    const z = from.z + Math.cos(a) * step;
    const y = findStandY(world, x, z, from.y, navOpts);
    if (y === null || Math.abs(y - from.y) > maxStep) continue;
    return { x, y, z, yaw: a };
  }
  return null;
}
