'use strict';
const HP = 20, DAMAGE = 5, INTERVAL = 120, RESPAWN = 3000, RANGE = 80;
function init(p) {
  Object.assign(p, { hp: HP, maxHp: HP, deadUntil: 0, protectedUntil: 0, lastShot: -Infinity, dimension: 'overworld' });
}
function state(p) {
  return { id: p.id, hp: p.hp, maxHp: HP, deadUntil: p.deadUntil, dimension: p.dimension,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
}
function hurt(p, damage, now) {
  if (p.hp <= 0 || now < p.protectedUntil) return false;
  p.hp = Math.max(0, p.hp - damage);
  if (!p.hp) p.deadUntil = now + RESPAWN;
  return true;
}
// Ray / player box intersection. The client supplies the nearest terrain distance;
// the server chooses the nearest player and owns damage, fire rate and life state.
function shoot(p, peers, msg, now) {
  if (p.hp <= 0 || now - p.lastShot < INTERVAL) return null;
  const d = msg.direction;
  if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return null;
  const len = Math.hypot(...d);
  if (len < 0.99 || len > 1.01 || !Number.isFinite(msg.distance)) return null;
  p.lastShot = now;
  const origin = [p.x, p.y + 1.62, p.z];
  let distance = Math.max(0, Math.min(RANGE, msg.distance)), target = null;
  for (const other of peers) {
    if (other === p || other.hp <= 0 || other.dimension !== p.dimension) continue;
    let near = 0, far = distance;
    // 略放宽碰撞盒，对战更跟手
    const min = [other.x - 0.35, other.y, other.z - 0.35];
    const max = [other.x + 0.35, other.y + 1.8, other.z + 0.35];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-8) {
        if (origin[i] < min[i] || origin[i] > max[i]) { far = -1; break; }
      } else {
        const a = (min[i] - origin[i]) / d[i], b = (max[i] - origin[i]) / d[i];
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      }
    }
    if (near <= far && near < distance) { distance = near; target = other; }
  }
  if (target && !hurt(target, DAMAGE, now)) target = null;
  return { target, origin, direction: d, distance };
}
function respawn(p, now) {
  if (p.hp > 0 || now < p.deadUntil) return false;
  Object.assign(p, { hp: HP, deadUntil: 0, protectedUntil: now + 2000,
    x: 7.5, y: 19.2, z: 8.5, dimension: 'overworld' });
  return true;
}
module.exports = { init, state, shoot, hurt, respawn };
