/**
 * 炸弹：右键投掷 / 贴墙放置，短延时后爆炸
 * 炸毁可破坏方块、伤害生物与玩家、带击退
 */
import * as THREE from 'three';
import { BlockType, isSolid } from './voxel.js?v=mistboss5';

const FUSE = 2.4;
const RADIUS = 3.6;
const BLAST_DMG = 12;
const BLAST_KNOCK = 11;

const HARD = new Set([
  BlockType.OBSIDIAN,
  BlockType.PORTAL,
  BlockType.COZE_CYAN,
]);

export class BombManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  /** 从相机方向投掷 */
  throwFromPlayer() {
    const g = this.game;
    const origin = g.camera.position.clone();
    const dir = g.camera.getWorldDirection(new THREE.Vector3());
    const vel = dir.multiplyScalar(14);
    vel.y += 4;
    this.spawn(origin.add(dir.clone().normalize().multiplyScalar(0.6)), vel, FUSE);
  }

  /** 贴在准星邻格 */
  placeAtTarget() {
    const g = this.game;
    const tb = g.player.targetBlock;
    const face = g.player.targetFace;
    let x; let y; let z;
    if (tb && face) {
      x = tb.x + (face.x || 0);
      y = tb.y + (face.y || 0);
      z = tb.z + (face.z || 0);
    } else {
      const p = g.player.position;
      const yaw = g.player.yaw;
      x = Math.floor(p.x - Math.sin(yaw) * 2);
      y = Math.floor(p.y);
      z = Math.floor(p.z - Math.cos(yaw) * 2);
    }
    if (isSolid(g.world.getBlock(x, y, z))) y += 1;
    this.spawn(new THREE.Vector3(x + 0.5, y + 0.35, z + 0.5), new THREE.Vector3(0, 0, 0), FUSE * 0.85);
  }

  spawn(pos, vel, fuse = FUSE) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.45, 0.45),
      new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
    );
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.1, 0.48),
      new THREE.MeshLambertMaterial({ color: 0xc62828 })
    );
    band.position.y = 0.05;
    const fuseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.2, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xffcc80 })
    );
    fuseMesh.position.y = 0.32;
    mesh.add(body, band, fuseMesh);
    mesh.position.copy(pos);
    this.game.scene.add(mesh);
    this.list.push({
      mesh,
      fuseMesh,
      pos: pos.clone(),
      vel: vel.clone(),
      fuse,
      blink: 0,
    });
    this.game._showSaveToast?.(`炸弹已投放 · ${fuse.toFixed(1)}s`);
  }

  tick(dt) {
    const g = this.game;
    const world = g.world;
    dt = Math.min(dt, 0.05);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.fuse -= dt;
      b.blink += dt;

      // 简易弹道 + 落地
      b.vel.y -= 22 * dt;
      const next = b.pos.clone().addScaledVector(b.vel, dt);
      const gy = this._groundY(world, next.x, next.z);
      if (next.y <= gy + 0.25 && b.vel.y <= 0) {
        next.y = gy + 0.25;
        b.vel.y = 0;
        b.vel.x *= 0.55;
        b.vel.z *= 0.55;
      }
      // 撞实心侧面
      if (isSolid(world.getBlock(Math.floor(next.x), Math.floor(next.y + 0.2), Math.floor(next.z)))) {
        b.vel.x *= -0.3;
        b.vel.z *= -0.3;
        next.copy(b.pos);
      }
      b.pos.copy(next);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.y += dt * 4;

      // 引信闪烁
      const urgent = b.fuse < 0.8;
      const on = Math.sin(b.blink * (urgent ? 28 : 10)) > 0;
      b.fuseMesh.material.color.setHex(on ? 0xffee58 : 0xff6f00);

      if (b.fuse <= 0) {
        this._explode(b.pos);
        this._dispose(b);
        this.list.splice(i, 1);
      }
    }
  }

  _groundY(world, x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    for (let y = Math.min(60, Math.floor(this.game.player.position.y) + 8); y >= 0; y--) {
      if (isSolid(world.getBlock(ix, y, iz))) return y + 1;
    }
    return 0;
  }

  _explode(center) {
    const g = this.game;
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);
    const r = RADIUS;
    const r2 = r * r;
    const touched = new Set();

    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
        for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) continue;
          const wx = cx + dx;
          const wy = cy + dy;
          const wz = cz + dz;
          const t = g.world.getBlock(wx, wy, wz);
          if (!t || HARD.has(t)) continue;
          // 外圈概率破坏，更自然
          if (d2 > (r - 1) * (r - 1) && Math.random() > 0.55) continue;
          g.world.setBlock(wx, wy, wz, BlockType.AIR);
          if (g._online && g.net?.room) g.net.sendBlock?.(wx, wy, wz, BlockType.AIR);
          touched.add(`${Math.floor(wx / 16)},${Math.floor(wz / 16)}`);
        }
      }
    }

    for (const key of touched) {
      const [cx0, cz0] = key.split(',').map(Number);
      g._rebuildChunkAt?.(cx0, cz0);
    }

    // 伤生物
    if (g.animalManager) {
      for (const mob of [...g.animalManager.robots]) {
        if (mob.dead) continue;
        const d = mob.position.distanceTo(center);
        if (d > r + 0.5) continue;
        const falloff = 1 - d / (r + 0.5);
        const dmg = Math.max(3, Math.round(BLAST_DMG * falloff));
        const dir = mob.position.clone().sub(center).normalize();
        if (g._online && g.net?.room && mob._netDriven) {
          g.net.sendHit(mob.id, dmg);
          mob.hurtTimer = 0.35;
          continue;
        }
        const result = mob.takeDamage?.(dmg, dir, BLAST_KNOCK * falloff);
        if (result?.dead && result.drops) {
          g._onLocalMobKill?.(mob, result.drops);
        }
      }
      g._updateHotbar?.();
    }

    if (g._dragon && !g._dragon.dead) {
      const d = g._dragon.position.distanceTo(center);
      if (d <= r + 1) g._dragon.takeDamage?.(Math.round(BLAST_DMG * 0.7));
    }

    // 伤自己
    const pd = g.player.position.distanceTo(center);
    if (pd <= r + 0.8 && g.player.invuln <= 0) {
      const falloff = 1 - pd / (r + 0.8);
      const dmg = Math.max(2, Math.round(BLAST_DMG * 0.85 * falloff));
      g.player.hp = Math.max(0, g.player.hp - dmg);
      const dir = g.player.position.clone().sub(center);
      dir.y = 0;
      if (dir.lengthSq() > 1e-4) dir.normalize();
      else dir.set(0, 0, 1);
      g.player.knockVelocity.x += dir.x * BLAST_KNOCK * falloff;
      g.player.knockVelocity.y += 5;
      g.player.knockVelocity.z += dir.z * BLAST_KNOCK * falloff;
      g.player.addShake?.(0.06);
      document.body.classList.add('combat-hurt');
      setTimeout(() => document.body.classList.remove('combat-hurt'), 250);
      g._updateHpHud?.();
    }

    this._flashFx(center);
    g._dirtySinceSave = true;
    g._showSaveToast?.('轰！');
  }

  _flashFx(center) {
    const light = new THREE.PointLight(0xff9800, 4, 18);
    light.position.copy(center);
    this.game.scene.add(light);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.85 })
    );
    ball.position.copy(center);
    this.game.scene.add(ball);
    const t0 = performance.now();
    const anim = () => {
      const t = (performance.now() - t0) / 280;
      if (t >= 1) {
        this.game.scene.remove(light, ball);
        ball.geometry.dispose();
        ball.material.dispose();
        return;
      }
      ball.scale.setScalar(1 + t * 5);
      ball.material.opacity = 0.85 * (1 - t);
      light.intensity = 4 * (1 - t);
      requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
  }

  _dispose(b) {
    this.game.scene.remove(b.mesh);
    b.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  clear() {
    for (const b of this.list) this._dispose(b);
    this.list.length = 0;
  }
}

export function isBomb(type) {
  return (type | 0) === 108;
}
