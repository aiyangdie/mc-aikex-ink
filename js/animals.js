/**
 * 主世界：猪/牛/鸡/鸭/鹿/马/驴（可击杀掉肉）
 * 地狱：敌对侦察机
 */
import * as THREE from 'three';
import { BlockType, isSolid, Dim } from './voxel.js?v=groundfix9';
import { ItemType } from './items.js?v=groundfix9';
import { buildMobDrops } from './loot.js?v=groundfix9';

const SPAWN_RADIUS = 28;
const MIN_SPAWN_DIST = 4;
const WANDER_RANGE = 22;

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

let _idSeq = 1;
function nextLocalId() {
  return `L${(_idSeq++).toString(36)}`;
}

/** 生物定义 */
export const CritterDefs = {
  pig:     { name: '猪', hp: 8,  w: 0.8, h: 0.85, color: 0xf0a0a8, speed: 1.3, drop: ItemType.PORK, dropN: 2 },
  cow:     { name: '牛', hp: 12, w: 0.95, h: 1.15, color: 0x5d4037, speed: 1.0, drop: ItemType.BEEF, dropN: 2 },
  chicken: { name: '鸡', hp: 4,  w: 0.45, h: 0.55, color: 0xfff3e0, speed: 1.6, drop: ItemType.CHICKEN, dropN: 1 },
  duck:    { name: '鸭', hp: 5,  w: 0.5, h: 0.55, color: 0x8d6e63, speed: 1.4, drop: ItemType.DUCK, dropN: 1 },
  deer:    { name: '鹿', hp: 10, w: 0.7, h: 1.2, color: 0xa1887f, speed: 2.0, drop: ItemType.VENISON, dropN: 2 },
  horse:   { name: '马', hp: 16, w: 0.9, h: 1.4, color: 0x6d4c41, speed: 2.2, drop: ItemType.HORSE_MEAT, dropN: 2 },
  donkey:  { name: '驴', hp: 14, w: 0.85, h: 1.25, color: 0x8d6e63, speed: 1.8, drop: ItemType.DONKEY_MEAT, dropN: 2 },
  scout:   { name: '地狱机', hp: 10, w: 0.7, h: 1.0, color: 0xb0b8c0, speed: 1.5, drop: BlockType.NETHERRACK, dropN: 2, hostile: true },
};

class Critter {
  constructor(scene, world, kind, x, y, z, opts = {}) {
    const def = CritterDefs[kind] || CritterDefs.pig;
    this.def = def;
    this.kind = kind;
    this.scene = scene;
    this.world = world;
    this.id = opts.id || nextLocalId();
    this.position = new THREE.Vector3(x, y, z);
    this.knockVelocity = new THREE.Vector3(0, 0, 0);
    this.rotation = opts.yaw != null ? opts.yaw : randRange(0, Math.PI * 2);
    this.targetRotation = this.rotation;
    this.collisionWidth = def.w;
    this.collisionHeight = def.h;
    this.maxHp = opts.maxHp || def.hp;
    this.hp = opts.hp != null ? opts.hp : this.maxHp;
    this.hurtTimer = 0;
    this.dead = false;
    this._netDriven = !!opts.netDriven;
    this.wanderSpeed = def.speed;
    this.turnSpeed = 3;
    this.state = 'idle';
    this.stateTimer = randRange(1, 3);
    this.wanderDir = new THREE.Vector3(1, 0, 0);
    this.bobPhase = Math.random() * 6;
    this._stuckTime = 0;
    this._lastMove = this.position.clone();

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this._buildModel(def);
    this.scene.add(this.group);
    this._baseMats = [];
    this.group.traverse((o) => {
      if (o.isMesh && o.material?.color) {
        this._baseMats.push({ mat: o.material, hex: o.material.color.getHex() });
      }
    });
    this._ensureHpLabel();
  }

  _ensureHpLabel() {
    if (this.label) return;
    let root = document.getElementById('mobLabels');
    if (!root) {
      root = document.createElement('div');
      root.id = 'mobLabels';
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = 'mob-label';
    el.innerHTML = `<span class="mob-name">${this.def.name}</span><progress max="${this.maxHp}" value="${this.hp}"></progress>`;
    root.appendChild(el);
    this.label = el;
    this.hpBar = el.querySelector('progress');
    this.nameEl = el.querySelector('.mob-name');
  }

  _syncHpLabel() {
    if (!this.label) return;
    if (this.hpBar) {
      this.hpBar.max = this.maxHp;
      this.hpBar.value = Math.max(0, this.hp);
    }
    if (this.nameEl) {
      this.nameEl.textContent = `${this.def.name} ${Math.max(0, Math.ceil(this.hp))}/${this.maxHp}`;
    }
  }

  _buildModel(def) {
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(def.w * 0.95, def.h * 0.55, def.w * 1.1),
      mat
    );
    // group.position 是脚底锚点，身体底面必须落在锚点附近，不能悬空。
    body.position.y = def.h * 0.275;
    this.group.add(body);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(def.w * 0.5, def.h * 0.4, def.w * 0.5),
      mat
    );
    head.position.set(0, def.h * 0.85, def.w * 0.45);
    this.group.add(head);
    if (this.kind === 'deer' || this.kind === 'cow') {
      const horn = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.08), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
      horn.position.set(0.12, def.h * 1.05, def.w * 0.4);
      this.group.add(horn);
    }
    if (this.kind === 'chicken' || this.kind === 'duck') {
      const beak = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.2), new THREE.MeshLambertMaterial({ color: 0xff9800 }));
      beak.position.set(0, def.h * 0.85, def.w * 0.7);
      this.group.add(beak);
    }
  }

  _getGroundY(wx, wz) {
    for (let wy = 47; wy >= 0; wy--) {
      const b = this.world.getBlock(Math.floor(wx), wy, Math.floor(wz));
      if (isSolid(b) && b !== BlockType.LEAVES) return wy + 1;
    }
    return 0;
  }

  _isSafeStep(wx, wy, wz) {
    const below = this.world.getBlock(Math.floor(wx), Math.floor(wy) - 1, Math.floor(wz));
    if (!isSolid(below) || below === BlockType.LEAVES) return false;
    if (this.world.getBlock(Math.floor(wx), Math.floor(wy), Math.floor(wz)) === BlockType.WATER) return false;
    if (Math.abs(this._getGroundY(wx, wz) - this.position.y) > 1.05) return false;
    return this._canOccupy(wx, wy, wz);
  }

  /** 检查生物整个身体的净空，避免只看脚下而穿进墙里。 */
  _canOccupy(wx, wy, wz) {
    const half = this.collisionWidth * 0.5;
    const minX = Math.floor(wx - half + 0.08);
    const maxX = Math.floor(wx + half - 0.08);
    const minZ = Math.floor(wz - half + 0.08);
    const maxZ = Math.floor(wz + half - 0.08);
    const minY = Math.floor(wy + 0.05);
    const maxY = Math.floor(wy + this.collisionHeight - 0.05);
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let y = minY; y <= maxY; y++) {
          const block = this.world.getBlock(x, y, z);
          if (isSolid(block)) return false;
        }
      }
    }
    return true;
  }

  _tryMove(dir, step, spawnCenter) {
    const angles = [0, 0.48, -0.48, 0.9, -0.9, 1.35, -1.35, Math.PI];
    const scales = [1, 0.7, 0.4];
    for (const scale of scales) {
      for (const offset of angles) {
        const angle = Math.atan2(dir.z, dir.x) + offset;
        const distance = step * scale;
        const nx = this.position.x + Math.cos(angle) * distance;
        const nz = this.position.z + Math.sin(angle) * distance;
        const ny = this._getGroundY(nx, nz);
        const dist = Math.hypot(nx - spawnCenter.x, nz - spawnCenter.z);
        if (dist >= WANDER_RANGE || !this._isSafeStep(nx, ny, nz)) continue;
        this.position.set(nx, ny, nz);
        this.targetRotation = angle;
        this.wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
        this._stuckTime = 0;
        return true;
      }
    }
    this._stuckTime += step > 0 ? Math.min(0.1, step / Math.max(this.wanderSpeed, 0.1)) : 0.05;
    return false;
  }

  _tryUnstick() {
    if (this._stuckTime < 1.2) return false;
    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI * 2 * i) / 16;
      const radius = 0.8 + (i % 3) * 0.55;
      const x = this.position.x + Math.cos(angle) * radius;
      const z = this.position.z + Math.sin(angle) * radius;
      const y = this._getGroundY(x, z);
      if (this._isSafeStep(x, y, z)) {
        this.position.set(x, y, z);
        this.targetRotation = angle;
        this._stuckTime = 0;
        return true;
      }
    }
    this.targetRotation += Math.PI * 0.75;
    this._stuckTime = 0.4;
    return false;
  }

  hitDistance(origin, dir, maxDist) {
    if (this.dead) return Infinity;
    const hw = this.collisionWidth / 2;
    const min = { x: this.position.x - hw, y: this.position.y, z: this.position.z - hw };
    const max = { x: this.position.x + hw, y: this.position.y + this.collisionHeight, z: this.position.z + hw };
    let tmin = 0, tmax = maxDist;
    for (const axis of ['x', 'y', 'z']) {
      const o = origin[axis], d = dir[axis];
      if (Math.abs(d) < 1e-8) {
        if (o < min[axis] || o > max[axis]) return Infinity;
        continue;
      }
      let t1 = (min[axis] - o) / d, t2 = (max[axis] - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
    return tmin >= 0 ? tmin : Infinity;
  }

  takeDamage(amount = 3, knockDir = null, knockStr = 7) {
    if (this.dead) return null;
    this.hp -= amount;
    this.hurtTimer = 0.35;
    this.state = 'flee';
    this.stateTimer = 1.8;
    this._syncHpLabel();
    if (knockDir) {
      const d = knockDir.clone ? knockDir.clone() : new THREE.Vector3(knockDir.x, knockDir.y, knockDir.z);
      d.y = 0;
      if (d.lengthSq() < 1e-6) d.set(Math.cos(this.rotation), 0, Math.sin(this.rotation));
      else d.normalize();
      this.knockVelocity.x += d.x * knockStr;
      this.knockVelocity.y += 3.5;
      this.knockVelocity.z += d.z * knockStr;
      this.targetRotation = Math.atan2(d.z, d.x) + Math.PI;
    } else {
      this.targetRotation += Math.PI + randRange(-0.5, 0.5);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this._syncHpLabel();
      if (this.label) this.label.style.display = 'none';
      return { dead: true, drops: buildMobDrops(this.kind) };
    }
    return { dead: false, drops: [] };
  }

  applyNetPose(x, y, z, yaw, hp, state) {
    this.position.set(x, y, z);
    if (yaw != null) { this.rotation = yaw; this.targetRotation = yaw; }
    if (hp != null) { this.hp = hp; this._syncHpLabel(); }
    if (state) this.state = state;
    this.group.position.set(x, y, z);
    this.group.rotation.y = this.rotation;
  }

  updateLabel(camera) {
    this._ensureHpLabel();
    this._syncHpLabel();
    if (!this.label || !camera || this.dead) {
      if (this.label) this.label.style.display = 'none';
      return;
    }
    const v = this.position.clone();
    v.y += this.collisionHeight + 0.35;
    v.project(camera);
    if (v.z > 1) {
      this.label.style.display = 'none';
      return;
    }
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.label.style.display = 'block';
    this.label.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
  }

  update(dt, spawnCenter) {
    if (this.dead) return;
    dt = Math.min(dt, 0.1);
    // 暂停时仍把渲染模型收回物理锚点，避免把跳跃/击退的半空帧冻结在屏幕上。
    if (dt <= 0) {
      this.group.position.set(this.position.x, this.position.y, this.position.z);
      return;
    }
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      for (const { mat, hex } of this._baseMats) {
        mat.color.setHex(this.hurtTimer > 0 ? 0xff4444 : hex);
      }
    }
    if (this._netDriven) {
      this.bobPhase += dt * (this.state === 'idle' ? 2 : 6);
      const bob = this.state !== 'idle' ? Math.sin(this.bobPhase) * 0.02 : 0;
      this.group.position.set(this.position.x, this.position.y + bob, this.position.z);
      this.group.rotation.y = this.rotation;
      return;
    }

    // 击退物理：冲量 + 落地摩擦
    if (this.knockVelocity.lengthSq() > 0.01) {
      this.knockVelocity.y -= 22 * dt;
      const nx = this.position.x + this.knockVelocity.x * dt;
      const ny = this.position.y + this.knockVelocity.y * dt;
      const nz = this.position.z + this.knockVelocity.z * dt;
      const gy = this._getGroundY(nx, nz);
      if (ny <= gy && this._canOccupy(nx, gy, nz)) {
        this.position.set(nx, gy, nz);
        this.knockVelocity.y = 0;
        this.knockVelocity.x *= 0.55;
        this.knockVelocity.z *= 0.55;
      } else if (ny <= gy) {
        this.knockVelocity.x = 0;
        this.knockVelocity.z = 0;
        this.knockVelocity.y = 0;
      } else if (this._canOccupy(nx, ny, nz)) {
        this.position.set(nx, ny, nz);
      } else {
        this.knockVelocity.x = 0;
        this.knockVelocity.z = 0;
      }
      this.knockVelocity.x *= Math.exp(-dt * 3);
      this.knockVelocity.z *= Math.exp(-dt * 3);
      if (this.knockVelocity.lengthSq() < 0.05) this.knockVelocity.set(0, 0, 0);
      this.group.position.set(this.position.x, this.position.y, this.position.z);
      this.group.rotation.y = this.rotation;
      return; // 击退中暂停 AI 步进
    }

    this.stateTimer -= dt;
    this.bobPhase += dt * (this.state === 'idle' ? 2 : 6);

    if (this.state === 'flee' || this.state === 'wander') {
      const step = this.wanderSpeed * (this.state === 'flee' ? 1.8 : 1) * dt;
      const dir = this.state === 'flee'
        ? new THREE.Vector3(Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation))
        : this.wanderDir;
      if (!this._tryMove(dir, step, spawnCenter)) {
        this.targetRotation += randRange(0.6, 1.4);
        this.wanderDir.set(Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation));
        this._tryUnstick();
      }
      if (this.stateTimer <= 0) {
        this.state = this.state === 'flee' ? 'wander' : 'idle';
        this.stateTimer = randRange(1, 4);
      }
    } else if (this.stateTimer <= 0) {
      this.state = 'wander';
      this.stateTimer = randRange(2, 5);
      this.wanderDir.set(Math.cos(this.targetRotation), 0, Math.sin(this.targetRotation));
    }

    let short = ((this.targetRotation - this.rotation + Math.PI) % (Math.PI * 2)) - Math.PI;
    this.rotation += short * Math.min(this.turnSpeed * dt, 1);
    this.group.rotation.y = this.rotation;
    const bob = this.state !== 'idle' ? Math.sin(this.bobPhase) * 0.03 : 0;
    this.group.position.set(this.position.x, this.position.y + bob, this.position.z);
  }

  toNet() {
    return {
      id: this.id, kind: this.kind,
      x: +this.position.x.toFixed(2), y: +this.position.y.toFixed(2), z: +this.position.z.toFixed(2),
      yaw: +this.rotation.toFixed(3), hp: this.hp, maxHp: this.maxHp, state: this.state,
    };
  }

  dispose() {
    if (this.label?.parentNode) this.label.parentNode.removeChild(this.label);
    this.label = null;
    if (!this.group) return;
    this.group.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    this.scene.remove(this.group);
    this.group = null;
  }
}

export class AnimalManager {
  constructor(scene, world, isMobile = false) {
    this.scene = scene;
    this.world = world;
    this.isMobile = isMobile;
    this.robots = []; // 兼容旧字段名
    this.spawnCenter = new THREE.Vector3(5.4, 0, 22.6);
    this._spawned = false;
    this._netMode = false;
  }

  get animals() { return this.robots; }

  clearAll() {
    for (const r of this.robots) r.dispose();
    this.robots = [];
    this._spawned = false;
  }

  spawnAnimals(dimension = Dim.OVERWORLD) {
    if (this._spawned || this._netMode) return;
    this._spawned = true;
    if (dimension === Dim.END) return;
    if (dimension === Dim.NETHER) {
      this._spawnKinds(['scout', 'scout', 'scout', 'scout'], 8, 20);
      return;
    }
    const kinds = this.isMobile
      ? ['pig', 'cow', 'chicken', 'deer']
      : ['pig', 'pig', 'cow', 'cow', 'chicken', 'duck', 'deer', 'deer', 'horse', 'donkey'];
    this._spawnKinds(kinds, 5, SPAWN_RADIUS);
  }

  /** 管理：在指定坐标刷一只 */
  spawnOne(kind, x, y, z, opts = {}) {
    const k = CritterDefs[kind] ? kind : 'pig';
    const bot = new Critter(this.scene, this.world, k, x, y, z, opts);
    this.robots.push(bot);
    this._spawned = true;
    return bot;
  }

  clearNear(x, z, radius = 32) {
    const keep = [];
    for (const r of this.robots) {
      const d = Math.hypot(r.position.x - x, r.position.z - z);
      if (d <= radius) r.dispose();
      else keep.push(r);
    }
    this.robots = keep;
  }

  _spawnKinds(kinds, minDist, radius) {
    const used = [];
    for (const kind of kinds) {
      for (let a = 0; a < 40; a++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = randRange(minDist, radius);
        const sx = this.spawnCenter.x + Math.cos(ang) * dist;
        const sz = this.spawnCenter.z + Math.sin(ang) * dist;
        const gy = this._getGroundY(sx, sz);
        const ground = this.world.getBlock(Math.floor(sx), Math.floor(gy - 1), Math.floor(sz));
        if (ground !== BlockType.GRASS && ground !== BlockType.SAND && ground !== BlockType.NETHERRACK && ground !== BlockType.END_STONE) continue;
        if (gy < 1 || gy > 40) continue;
        if (used.some((p) => Math.hypot(sx - p.x, sz - p.z) < MIN_SPAWN_DIST)) continue;
        used.push({ x: sx, z: sz });
        this.robots.push(new Critter(this.scene, this.world, kind, sx, gy, sz));
        break;
      }
    }
  }

  _getGroundY(wx, wz) {
    for (let wy = 47; wy >= 0; wy--) {
      const b = this.world.getBlock(Math.floor(wx), wy, Math.floor(wz));
      if (isSolid(b) && b !== BlockType.LEAVES) return wy + 1;
    }
    return 1;
  }

  syncFromNet(list) {
    this._netMode = true;
    this._spawned = true;
    const keep = new Set((list || []).map((m) => m.id));
    for (const r of [...this.robots]) {
      if (!keep.has(r.id)) { r.dispose(); this.robots = this.robots.filter((x) => x !== r); }
    }
    for (const m of (list || [])) {
      let bot = this.robots.find((r) => r.id === m.id);
      if (!bot) {
        bot = new Critter(this.scene, this.world, m.kind || 'pig', m.x, m.y, m.z, {
          id: m.id, hp: m.hp, maxHp: m.maxHp, netDriven: true,
        });
        this.robots.push(bot);
      }
      bot._netDriven = true;
      bot.applyNetPose(m.x, m.y, m.z, m.yaw, m.hp, m.state);
    }
  }

  upsertNetMob(m) {
    this._netMode = true;
    let bot = this.robots.find((r) => r.id === m.id);
    if (!bot) {
      bot = new Critter(this.scene, this.world, m.kind || 'pig', m.x, m.y, m.z, {
        id: m.id, hp: m.hp, maxHp: m.maxHp, netDriven: true,
      });
      this.robots.push(bot);
    }
    bot.applyNetPose(m.x, m.y, m.z, m.yaw, m.hp, m.state);
    if (m.hurt) bot.hurtTimer = 0.35;
  }

  removeById(id) {
    const bot = this.robots.find((r) => r.id === id);
    if (!bot) return;
    bot.dispose();
    this.robots = this.robots.filter((r) => r !== bot);
  }

  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const r of this.robots) {
      const t = r.hitDistance(origin, dir, maxDist);
      if (t < bestT) { bestT = t; best = r; }
    }
    return best ? { robot: best, dist: bestT } : null;
  }

  update(dt, camera = null) {
    for (const r of this.robots) {
      r.update(dt, this.spawnCenter);
      r.updateLabel?.(camera);
    }
  }

  dispose() { this.clearAll(); }
}
