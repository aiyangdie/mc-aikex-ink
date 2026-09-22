/**
 * 轻量战斗物理（不替换体素 AABB）
 * - 弹道：速度 + 重力 + 方块/实体碰撞
 * - 击退冲量
 * - 随机安全复活点
 */
import * as THREE from 'three';
import { isSolid, Dim } from './voxel.js?v=playerstats6';

const BULLET_SPEED = 95;
const BULLET_GRAVITY = -18;
const BULLET_LIFE = 1.2;

export function randomSpawnHint(dimension = 'overworld') {
  const rnd = Math.random.bind(Math);
  if (dimension === Dim.NETHER || dimension === 'nether') {
    const a = rnd() * Math.PI * 2;
    const r = 3 + rnd() * 14;
    return {
      x: 8 + Math.cos(a) * r,
      y: 15.2,
      z: 8 + Math.sin(a) * r,
      dimension: 'nether',
    };
  }
  if (dimension === Dim.END || dimension === 'end') {
    return {
      x: (rnd() - 0.5) * 24,
      y: 22,
      z: (rnd() - 0.5) * 24,
      dimension: 'end',
    };
  }
  return {
    x: (rnd() - 0.5) * 36,
    y: 19.5,
    z: (rnd() - 0.5) * 16,
    dimension: 'overworld',
  };
}

/** 找柱子上可站立的地面 */
export function findStandY(world, x, z, preferY = 40) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const start = Math.min(CHUNK_SAFE_Y, Math.floor(preferY) + 8);
  for (let y = start; y >= 1; y--) {
    const here = world.getBlock(ix, y, iz);
    const above = world.getBlock(ix, y + 1, iz);
    const above2 = world.getBlock(ix, y + 2, iz);
    if (isSolid(here) && !isSolid(above) && !isSolid(above2)) {
      return y + 1.05;
    }
  }
  return preferY;
}

const CHUNK_SAFE_Y = 60;

export function pickRandomSpawn(world, dimension = 'overworld') {
  for (let i = 0; i < 14; i++) {
    const hint = randomSpawnHint(dimension);
    if (!world) return hint;
    const y = findStandY(world, hint.x, hint.z, hint.y + 10);
    if (y > 1 && y < 70) return { ...hint, y };
  }
  return randomSpawnHint(dimension);
}

export class CombatPhysics {
  constructor(game) {
    this.game = game;
    this.bullets = [];
  }

  /** 发射一颗有物理的子弹；命中回调 onHit({kind,target,point,dir}) */
  fire(origin, direction, opts = {}) {
    const dir = direction.clone().normalize();
    const speed = opts.speed ?? BULLET_SPEED;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 5, 5),
      new THREE.MeshBasicMaterial({ color: 0xffe082 })
    );
    mesh.position.copy(origin);
    this.game.scene.add(mesh);
    const trail = [];
    this.bullets.push({
      mesh,
      trail,
      pos: origin.clone(),
      vel: dir.multiplyScalar(speed),
      life: opts.life ?? BULLET_LIFE,
      damage: opts.damage ?? 5,
      owner: opts.owner || 'local',
      online: !!opts.online,
      onHit: opts.onHit || null,
    });
  }

  tick(dt) {
    const g = this.game;
    const world = g.world;
    dt = Math.min(dt, 0.05);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        this._disposeBullet(b);
        this.bullets.splice(i, 1);
        continue;
      }

      b.vel.y += BULLET_GRAVITY * dt;
      const next = b.pos.clone().addScaledVector(b.vel, dt);
      const hitBlock = this._segmentHitsBlock(world, b.pos, next);
      if (hitBlock) {
        this._spark(hitBlock);
        this._disposeBullet(b);
        this.bullets.splice(i, 1);
        continue;
      }

      // 联机伤害由服务器判定；本地子弹只打生物 / 表现
      if (!b.online) {
        const ent = this._hitEntity(b.pos, next, b.owner);
        if (ent) {
          const dir = b.vel.clone().normalize();
          if (b.onHit) b.onHit({ target: ent, point: next.clone(), dir, damage: b.damage });
          this._spark(next);
          this._disposeBullet(b);
          this.bullets.splice(i, 1);
          continue;
        }
      }

      b.pos.copy(next);
      b.mesh.position.copy(next);
    }
  }

  _hitEntity(from, to, owner) {
    const g = this.game;
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 1e-4) return null;
    dir.multiplyScalar(1 / dist);
    let best = null;
    let bestT = dist;

    if (g.animalManager) {
      const hit = g.animalManager.raycast(from, dir, dist);
      if (hit && hit.dist < bestT) {
        bestT = hit.dist;
        best = hit.robot;
      }
    }
    if (g._dragon && !g._dragon.dead) {
      const t = g._dragon.hitDistance(from, dir, dist);
      if (t < bestT) {
        bestT = t; best = g._dragon;
      }
    }
    if (g._mistBoss && !g._mistBoss.dead) {
      const t = g._mistBoss.hitDistance(from, dir, dist);
      if (t < bestT) { bestT = t; best = g._mistBoss; }
    }
    return best;
  }

  _segmentHitsBlock(world, a, b) {
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      if (isSolid(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)))) {
        return new THREE.Vector3(x, y, z);
      }
    }
    return null;
  }

  _spark(point) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xffab40, transparent: true, opacity: 0.9 })
    );
    mesh.position.copy(point);
    this.game.scene.add(mesh);
    setTimeout(() => {
      this.game.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }, 80);
  }

  _disposeBullet(b) {
    if (!b.mesh) return;
    this.game.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
    b.mesh = null;
  }

  clear() {
    for (const b of this.bullets) this._disposeBullet(b);
    this.bullets.length = 0;
  }
}

/** 给实体加击退冲量 */
export function applyKnockback(target, dir, strength = 7) {
  if (!target) return;
  const d = dir.clone();
  d.y = 0;
  if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
  else d.normalize();
  const ix = d.x * strength;
  const iy = 3.2 + strength * 0.15;
  const iz = d.z * strength;
  if (target.knockVelocity) {
    target.knockVelocity.x += ix;
    target.knockVelocity.y += iy;
    target.knockVelocity.z += iz;
  } else if (target.velocity) {
    target.velocity.x += ix;
    target.velocity.y += iy;
    target.velocity.z += iz;
  }
}
