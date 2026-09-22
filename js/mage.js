import * as THREE from 'three';
import { isSolid } from './voxel.js?v=groundfix9';

const BLINK_RANGE = 7.5;
const BLINK_CD = 3200;

/**
 * 法师火球 + 全职业 Z 闪现
 */
export class Mage {
  constructor(game) {
    this.game = game;
    this.nextCast = 0;
    this.nextBlink = 0;
    this.effects = new Map();
    this.sequence = 0;
    this.orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff781c })
    );
    this.orb.position.set(0.28, -0.20, -0.55);
    game.camera.add(this.orb);
    this.orb.visible = false;
  }

  cast() {
    const g = this.game;
    const now = Date.now();
    if (now < this.nextCast || !g._controlsActive() || g.player.hp <= 0) return;
    if (g.combat?.mode !== 'mage') return;
    this.nextCast = now + 900;
    const origin = g.camera.position.clone();
    const dir = g.camera.getWorldDirection(new THREE.Vector3());
    let end = origin.clone().addScaledVector(dir, 40);
    let ground = null;
    for (let t = 0.1; t <= 40; t += 0.1) {
      const point = origin.clone().addScaledVector(dir, t);
      if (!isSolid(g.world.getBlock(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)))) continue;
      end = point.addScaledVector(dir, -0.12);
      for (let y = Math.floor(end.y); y >= Math.max(0, end.y - 48); y--) {
        if (isSolid(g.world.getBlock(Math.floor(end.x), y, Math.floor(end.z)))) {
          ground = [end.x, y + 1.02, end.z];
          break;
        }
      }
      break;
    }
    const msg = { t: 'fireball', end: end.toArray(), ground };
    if (g._online) g.net._send(msg);
    else {
      this.receive({
        ...msg,
        id: `solo-${++this.sequence}`,
        origin: origin.toArray(),
        dimension: g.dimension,
        start: now,
        impact: now + Math.max(80, origin.distanceTo(end) / 22 * 1000),
        solo: true,
      });
    }
  }

  canOccupy(p) {
    const world = this.game.world;
    for (let x = Math.floor(p.x - 0.3); x <= Math.floor(p.x + 0.3); x++) {
      for (let y = Math.floor(p.y + 0.02); y <= Math.floor(p.y + 1.74); y++) {
        for (let z = Math.floor(p.z - 0.3); z <= Math.floor(p.z + 0.3); z++) {
          if (isSolid(world.getBlock(x, y, z))) return false;
        }
      }
    }
    return true;
  }

  _snapGround(pos) {
    const world = this.game.world;
    const ix = Math.floor(pos.x);
    const iz = Math.floor(pos.z);
    const start = Math.floor(pos.y + 1.5);
    for (let y = start; y >= Math.max(0, start - 12); y--) {
      if (!isSolid(world.getBlock(ix, y, iz))) continue;
      const stand = new THREE.Vector3(pos.x, y + 1.05, pos.z);
      if (this.canOccupy(stand)) return stand;
    }
    return this.canOccupy(pos) ? pos : null;
  }

  /** Z 闪现：全职业，朝视角瞬移并贴地 */
  blink() {
    const g = this.game;
    const now = Date.now();
    if (!g._controlsActive() || g.player.hp <= 0 || now < this.nextBlink) return false;

    const origin = g.player.position.clone();
    const look = g.camera.getWorldDirection(new THREE.Vector3());
    const dir = new THREE.Vector3(look.x, look.y * 0.35, look.z);
    if (dir.lengthSq() < 1e-6) dir.set(-Math.sin(g.player.yaw), 0, -Math.cos(g.player.yaw));
    dir.normalize();

    let best = null;
    for (let t = 0.4; t <= BLINK_RANGE; t += 0.25) {
      const probe = origin.clone().addScaledVector(dir, t);
      const snapped = this._snapGround(probe);
      if (!snapped) break;
      if (snapped.distanceTo(origin) < 0.35) continue;
      best = snapped;
    }
    if (!best) {
      g._showSaveToast?.('前方无法闪现');
      return false;
    }

    this.nextBlink = now + BLINK_CD;
    this._ghostFx(origin);
    if (g._online && g.net?.room) {
      // 乐观 CD；服务器拒绝时 blink_fail 回滚
      g.net._send({ t: 'blink', to: [best.x, best.y, best.z] });
    } else {
      this.teleport([best.x, best.y, best.z]);
    }
    return true;
  }

  /** 联机闪现被拒：回滚冷却 */
  onBlinkFail(msg) {
    this.nextBlink = msg?.nextBlink || 0;
    this.game._showSaveToast?.('闪现失败（冷却或受阻）');
  }

  _ghostFx(from) {
    const g = this.game;
    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.6, 0.35),
      new THREE.MeshBasicMaterial({ color: 0x80deea, transparent: true, opacity: 0.45 })
    );
    ghost.position.set(from.x, from.y + 0.85, from.z);
    g.scene.add(ghost);
    const t0 = performance.now();
    const anim = () => {
      const t = (performance.now() - t0) / 220;
      if (t >= 1) {
        g.scene.remove(ghost);
        ghost.geometry.dispose();
        ghost.material.dispose();
        return;
      }
      ghost.material.opacity = 0.45 * (1 - t);
      ghost.scale.setScalar(1 + t * 0.4);
      requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
  }

  teleport(to) {
    const p = this.game.player;
    p.position.set(to[0], to[1], to[2]);
    p.velocity.set(0, 0, 0);
    p.knockVelocity?.set(0, 0, 0);
    p._fallVy = 0;
    this.game.camera.position.set(p.position.x, p.position.y + p.eyeHeight, p.position.z);
    document.body.classList.add('mage-blink');
    setTimeout(() => document.body.classList.remove('mage-blink'), 160);
    this.game._showSaveToast?.('闪现！');
  }

  remove(key) {
    const effect = this.effects.get(key);
    if (!effect) return;
    this.game.scene.remove(effect.mesh);
    effect.mesh.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.effects.delete(key);
  }

  clear() {
    for (const key of this.effects.keys()) this.remove(key);
  }

  receive(msg) {
    const key = `${msg.t}-${msg.id}`;
    if (this.effects.has(key)) return;
    const mesh = new THREE.Group();
    if (msg.t === 'fireball') {
      mesh.add(new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.24, 1),
        new THREE.MeshBasicMaterial({ color: 0xffa125 })
      ));
    } else {
      const ring = new THREE.Mesh(
        new THREE.CircleGeometry(2.5, 32),
        new THREE.MeshBasicMaterial({
          color: 0xff4510,
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      mesh.add(ring);
      for (let i = 0; i < 16; i++) {
        const flame = new THREE.Mesh(
          new THREE.ConeGeometry(0.16, 0.8, 5),
          new THREE.MeshBasicMaterial({
            color: i % 2 ? 0xffc64a : 0xff6719,
            transparent: true,
            opacity: 0.85,
          })
        );
        const angle = i * 2.4;
        const radius = 0.4 + (i % 5) * 0.4;
        flame.position.set(Math.cos(angle) * radius, 0.4, Math.sin(angle) * radius);
        mesh.add(flame);
      }
      mesh.position.set(...msg.position);
    }
    this.effects.set(key, { msg, mesh });
    this.game.scene.add(mesh);
  }

  tick(active) {
    const g = this.game;
    const now = Date.now();
    this.orb.visible = active && g.combat.mode === 'mage' && g.player.hp > 0;
    this.orb.rotation.y += 0.04;
    for (const [key, { msg, mesh }] of this.effects) {
      mesh.visible = msg.dimension === g.dimension;
      if (msg.t === 'fireball') {
        const fraction = Math.min(1, (now - msg.start) / Math.max(1, msg.impact - msg.start));
        mesh.position.fromArray(msg.origin).lerp(new THREE.Vector3(...msg.end), Math.max(0, fraction));
        if (now < msg.impact) continue;
        this.remove(key);
        if (msg.solo && msg.ground) {
          this.receive({
            t: 'fire',
            id: msg.id,
            position: msg.ground,
            dimension: msg.dimension,
            expires: msg.impact + 5000,
            solo: true,
            nextDamage: now,
            _burstDone: false,
          });
        }
      } else if (now >= msg.expires) {
        this.remove(key);
      } else {
        if (msg.solo) this._soloBurn(msg, now);
        mesh.children.forEach((o, i) => {
          if (i) o.scale.y = 0.8 + Math.sin(now * 0.012 + i) * 0.3;
        });
      }
    }
  }

  /** 单机火球地面灼烧：对齐服务端半径/跳伤（不伤自己） */
  _soloBurn(msg, now) {
    if (!msg.position || now < (msg.nextDamage || 0)) return;
    const amount = msg._burstDone ? 2 : 6;
    msg._burstDone = true;
    msg.nextDamage = now + 500;
    const [x, y, z] = msg.position;
    const g = this.game;
    for (const mob of g.animalManager?.robots || []) {
      if (mob.dead) continue;
      if (Math.hypot(mob.position.x - x, mob.position.z - z) > 2.5) continue;
      if (mob.position.y > y + 2 || mob.position.y + 1.75 < y) continue;
      const result = mob.takeDamage?.(amount);
      if (result?.dead && result.drops) {
        g._onLocalMobKill?.(mob, result.drops);
      }
    }
    if (g._dragon && !g._dragon.dead) {
      const d = g._dragon.position;
      if (Math.hypot(d.x - x, d.z - z) <= 2.5) g._dragon.takeDamage?.(amount);
    }
  }

  cdLeft() {
    return Math.max(0, this.nextBlink - Date.now());
  }
}
