/**
 * Lightweight mob brain: idle / wander / flee / chase / stuck.
 * Shared by server Mob and offline Critter. No three.js.
 */
import { findStandY, findUnstickPos } from './nav-grid.js';
import { findPath, stepAlongPath } from './pathfind.js';

export const MobState = {
  IDLE: 'idle',
  WANDER: 'wander',
  FLEE: 'flee',
  CHASE: 'chase',
  STUCK: 'stuck',
};

const STUCK_EPS = 0.08;
const STUCK_TIME = 1.2;

export function createBrain(seed = Math.random()) {
  return {
    state: MobState.IDLE,
    stateTimer: 1 + seed * 2,
    path: [],
    goal: null,
    stuckTime: 0,
    lastX: null,
    lastZ: null,
    fleeFrom: null,
    chaseTarget: null,
    repathCd: 0,
  };
}

function randRange(a, b) {
  return a + Math.random() * (b - a);
}

function pickWanderGoal(world, body, leash, opts) {
  const cx = leash?.x ?? body.x;
  const cz = leash?.z ?? body.z;
  const r = leash?.r ?? 22;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 3 + Math.random() * Math.min(14, r * 0.6);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (Math.hypot(x - cx, z - cz) > r) continue;
    const y = findStandY(world, x, z, body.y, opts);
    if (y !== null) return { x, y, z };
  }
  return null;
}

function pickFleeGoal(world, body, from, leash, opts) {
  if (!from) return pickWanderGoal(world, body, leash, opts);
  const dx = body.x - from.x;
  const dz = body.z - from.z;
  let base = Math.atan2(dz, dx);
  if (Math.hypot(dx, dz) < 0.2) base = Math.random() * Math.PI * 2;
  for (let i = 0; i < 10; i++) {
    const a = base + (Math.random() - 0.5) * 1.2;
    const d = 6 + Math.random() * 8;
    const x = body.x + Math.cos(a) * d;
    const z = body.z + Math.sin(a) * d;
    if (leash && Math.hypot(x - leash.x, z - leash.z) > leash.r) continue;
    const y = findStandY(world, x, z, body.y, opts);
    if (y !== null) return { x, y, z };
  }
  return pickWanderGoal(world, body, leash, opts);
}

function ensurePath(brain, world, body, goal, opts) {
  if (!goal) {
    brain.path = [];
    brain.goal = null;
    return;
  }
  const need =
    !brain.path.length ||
    !brain.goal ||
    Math.hypot(brain.goal.x - goal.x, brain.goal.z - goal.z) > 1.5 ||
    brain.repathCd <= 0;
  if (!need) return;
  brain.goal = goal;
  brain.path = findPath(world, body, goal, { radius: opts.radius ?? 24, ...opts });
  brain.repathCd = 0.8;
}

/**
 * Force flee away from a point (e.g. after hit).
 */
export function forceFlee(brain, from, duration = 1.8) {
  brain.state = MobState.FLEE;
  brain.stateTimer = duration;
  brain.fleeFrom = from ? { x: from.x, z: from.z } : null;
  brain.path = [];
  brain.goal = null;
  brain.repathCd = 0;
}

/**
 * Step one brain tick. Mutates brain + returns new pose fields.
 * body: {x,y,z,yaw,speed}
 * ctx: {dt, world, leash, fleeFrom?, chaseTarget?, navOpts?}
 */
export function tickBrain(brain, body, ctx) {
  const dt = Math.min(ctx.dt || 0.05, 0.2);
  const world = ctx.world;
  const opts = ctx.navOpts || { halfW: 0.32, bodyH: 2 };
  const speed = body.speed != null ? body.speed : 1.2;
  let x = body.x, y = body.y, z = body.z;
  let yaw = body.yaw != null ? body.yaw : 0;

  // Snap to ground each tick
  const stand = findStandY(world, x, z, y, opts);
  if (stand !== null) y = stand;

  brain.repathCd = Math.max(0, (brain.repathCd || 0) - dt);
  brain.stateTimer -= dt;

  // Stuck detection
  if (brain.lastX != null) {
    const moved = Math.hypot(x - brain.lastX, z - brain.lastZ);
    if (brain.state === MobState.WANDER || brain.state === MobState.FLEE || brain.state === MobState.CHASE) {
      if (moved < STUCK_EPS) brain.stuckTime += dt;
      else brain.stuckTime = 0;
    } else {
      brain.stuckTime = 0;
    }
  }
  brain.lastX = x;
  brain.lastZ = z;

  if (brain.stuckTime >= STUCK_TIME) {
    brain.state = MobState.STUCK;
    brain.stateTimer = 0.3;
    brain.path = [];
    brain.goal = null;
    brain.stuckTime = 0;
    const rescue = findUnstickPos(world, x, y, z, opts);
    if (rescue) {
      x = rescue.x;
      y = rescue.y;
      z = rescue.z;
      console.log('[mob-brain] unstuck', body.id || '', rescue.x.toFixed(1), rescue.z.toFixed(1));
    }
  }

  if (ctx.chaseTarget) {
    brain.state = MobState.CHASE;
    brain.chaseTarget = ctx.chaseTarget;
  } else if (ctx.fleeFrom || brain.fleeFrom) {
    if (brain.state !== MobState.FLEE && brain.state !== MobState.STUCK) {
      forceFlee(brain, ctx.fleeFrom || brain.fleeFrom);
    }
    brain.fleeFrom = ctx.fleeFrom || brain.fleeFrom;
  }

  if (brain.state === MobState.STUCK) {
    if (brain.stateTimer <= 0) {
      brain.state = MobState.WANDER;
      brain.stateTimer = randRange(1, 3);
    }
  } else if (brain.state === MobState.IDLE) {
    if (brain.stateTimer <= 0) {
      brain.state = MobState.WANDER;
      brain.stateTimer = randRange(2, 5);
      brain.path = [];
      brain.goal = null;
    }
  } else if (brain.state === MobState.FLEE) {
    const goal = pickFleeGoal(world, { x, y, z }, brain.fleeFrom, ctx.leash, opts);
    ensurePath(brain, world, { x, y, z }, goal, opts);
    const step = speed * 1.8 * dt;
    const moved = stepAlongPath({ x, y, z, yaw }, brain.path, step);
    if (moved) {
      x = moved.x;
      y = moved.y;
      z = moved.z;
      yaw = moved.yaw;
    }
    if (brain.stateTimer <= 0) {
      brain.state = MobState.WANDER;
      brain.stateTimer = randRange(1, 3);
      brain.fleeFrom = null;
      brain.path = [];
    }
  } else if (brain.state === MobState.CHASE) {
    const t = brain.chaseTarget || ctx.chaseTarget;
    if (t) {
      ensurePath(brain, world, { x, y, z }, { x: t.x, y: t.y, z: t.z }, { ...opts, radius: 24 });
      const step = speed * dt;
      const moved = stepAlongPath({ x, y, z, yaw }, brain.path, step);
      if (moved) {
        x = moved.x;
        y = moved.y;
        z = moved.z;
        yaw = moved.yaw;
      } else {
        // fallback slide toward target with stand check
        const dx = t.x - x, dz = t.z - z;
        const dist = Math.hypot(dx, dz) || 1;
        const nx = x + (dx / dist) * step;
        const nz = z + (dz / dist) * step;
        const ny = findStandY(world, nx, nz, y, opts);
        if (ny !== null) {
          x = nx;
          y = ny;
          z = nz;
          yaw = Math.atan2(dz, dx);
        }
      }
    }
  } else if (brain.state === MobState.WANDER) {
    if (!brain.path.length || !brain.goal) {
      const goal = pickWanderGoal(world, { x, y, z }, ctx.leash, opts);
      ensurePath(brain, world, { x, y, z }, goal, opts);
    }
    const step = speed * dt;
    const moved = stepAlongPath({ x, y, z, yaw }, brain.path, step);
    if (moved) {
      x = moved.x;
      y = moved.y;
      z = moved.z;
      yaw = moved.yaw;
      if (moved.arrived) {
        brain.state = MobState.IDLE;
        brain.stateTimer = randRange(1, 4);
        brain.goal = null;
      }
    } else if (brain.stateTimer <= 0) {
      brain.state = MobState.IDLE;
      brain.stateTimer = randRange(1, 3);
    }
    if (brain.stateTimer <= 0 && brain.state === MobState.WANDER) {
      brain.path = [];
      brain.goal = null;
      brain.stateTimer = randRange(2, 5);
    }
  }

  // Leash soft pull
  const leash = ctx.leash;
  if (leash && Math.hypot(x - leash.x, z - leash.z) > leash.r) {
    const a = Math.atan2(leash.z - z, leash.x - x);
    const nx = x + Math.cos(a) * speed * dt * 2;
    const nz = z + Math.sin(a) * speed * dt * 2;
    const ny = findStandY(world, nx, nz, y, opts);
    if (ny !== null) {
      x = nx;
      y = ny;
      z = nz;
      yaw = a;
    }
    brain.path = [];
    brain.goal = null;
  }

  const pathHead = brain.path[0] || null;
  return {
    x, y, z, yaw,
    state: brain.state,
    stuckTime: brain.stuckTime,
    pathHead,
    path: brain.path.slice(),
  };
}

/**
 * Chase helper for bosses: keep/rebuild path toward target, step once.
 */
export function chaseStep(world, pos, target, speed, dt, cache, opts = {}) {
  const brainish = cache || { path: [], goal: null, repathCd: 0, stuckTime: 0, lastX: null, lastZ: null };
  brainish.repathCd = Math.max(0, (brainish.repathCd || 0) - dt);
  const need =
    !brainish.path.length ||
    !brainish.goal ||
    Math.hypot(brainish.goal.x - target.x, brainish.goal.z - target.z) > 2 ||
    brainish.repathCd <= 0;
  if (need) {
    brainish.goal = { x: target.x, y: target.y, z: target.z };
    brainish.path = findPath(world, pos, target, { radius: opts.radius ?? 24, ...opts });
    brainish.repathCd = 0.6;
  }
  let x = pos.x, y = pos.y, z = pos.z;
  let yaw = pos.yaw != null ? pos.yaw : 0;
  const step = speed * Math.min(dt, 0.05);
  const moved = stepAlongPath({ x, y, z, yaw }, brainish.path, step);
  if (moved) {
    x = moved.x;
    y = moved.y;
    z = moved.z;
  } else {
    // side-step fallback (legacy)
    const a = Math.atan2(target.x - pos.x, target.z - pos.z);
    for (const offset of [0, 0.65, -0.65, 1.2, -1.2]) {
      const nx = pos.x + Math.sin(a + offset) * step;
      const nz = pos.z + Math.cos(a + offset) * step;
      const ny = findStandY(world, nx, nz, pos.y, opts);
      if (ny !== null) {
        x = nx;
        y = ny;
        z = nz;
        break;
      }
    }
  }
  // Boss yaw convention: atan2(dx, dz)
  yaw = Math.atan2(x - pos.x, z - pos.z);
  if (Math.hypot(x - pos.x, z - pos.z) < 1e-4) {
    yaw = Math.atan2(target.x - pos.x, target.z - pos.z);
  }

  if (brainish.lastX != null) {
    const movedDist = Math.hypot(x - brainish.lastX, z - brainish.lastZ);
    brainish.stuckTime = movedDist < STUCK_EPS ? (brainish.stuckTime || 0) + dt : 0;
  }
  brainish.lastX = x;
  brainish.lastZ = z;
  if ((brainish.stuckTime || 0) >= STUCK_TIME) {
    brainish.stuckTime = 0;
    brainish.path = [];
    brainish.goal = null;
    const rescue = findUnstickPos(world, x, y, z, opts);
    if (rescue) {
      x = rescue.x;
      y = rescue.y;
      z = rescue.z;
      console.log('[boss-nav] unstuck', rescue.x.toFixed(1), rescue.z.toFixed(1));
    }
  }
  const stand = findStandY(world, x, z, y, opts);
  if (stand !== null) y = stand;
  return { x, y, z, yaw, cache: brainish, path: brainish.path.slice(), stuckTime: brainish.stuckTime || 0 };
}
