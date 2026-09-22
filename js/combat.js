import * as THREE from 'three';
import { isSolid } from './voxel.js?v=mistboss2';

/**
 * AK 对战：后坐力、枪口火光、弹道、命中反馈；单机可打生物
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this.armed = false;
    this.held = false;
    this.nextShot = 0;
    this.deadUntil = 0;
    this.lastHp = game.player.hp;
    this.traces = [];
    this._spread = 0;
    this._hitUntil = 0;
    this._killUntil = 0;

    this.panel = document.createElement('div');
    this.panel.id = 'combatHud';
    this.panel.innerHTML =
      '<button type="button" id="equipAK">AK [Q]</button>' +
      '<button type="button" id="fireAK">开火</button>' +
      '<span id="combatStatus"></span>';
    document.body.appendChild(this.panel);
    this.status = this.panel.querySelector('#combatStatus');

    this.hitMark = document.createElement('div');
    this.hitMark.id = 'hitMarker';
    this.hitMark.innerHTML = '<i></i><i></i><i></i><i></i>';
    document.body.appendChild(this.hitMark);

    const equip = this.panel.querySelector('#equipAK');
    equip.onclick = () => this.toggle();
    const fire = this.panel.querySelector('#fireAK');
    fire.onpointerdown = (e) => {
      e.preventDefault();
      fire.setPointerCapture(e.pointerId);
      this.held = true;
    };
    fire.onpointerup = fire.onpointercancel = fire.onlostpointercapture = () => {
      this.held = false;
    };

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ' && !e.repeat && game._controlsActive() && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
        this.toggle();
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && game._controlsActive() && (game.isPointerLocked || e.target === game.canvas)) {
        this.held = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held = false;
    });
    document.addEventListener('pointerlockchange', () => { this.held = false; });
    window.addEventListener('blur', () => { this.held = false; });

    this._buildGun();
  }

  _buildGun() {
    const g = this.game;
    this.gun = new THREE.Group();
    const part = (x, y, z, w, h, d, color, rx = 0) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color })
      );
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      this.gun.add(mesh);
    };
    part(0, 0, 0, 0.09, 0.10, 0.38, 0x30343b);
    part(0, 0.015, -0.30, 0.035, 0.035, 0.30, 0x171b20);
    part(0, -0.01, -0.16, 0.10, 0.085, 0.17, 0x955b32);
    part(0, -0.07, 0.20, 0.09, 0.13, 0.20, 0x955b32);
    part(0, -0.12, 0.07, 0.06, 0.19, 0.065, 0x704126, -0.3);
    part(0, -0.15, -0.07, 0.06, 0.22, 0.10, 0x25292e, 0.3);
    part(0, 0.08, -0.36, 0.025, 0.08, 0.025, 0x171b20);

    this.muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0 })
    );
    this.muzzle.position.set(0, 0.02, -0.48);
    this.gun.add(this.muzzle);

    this._gunBase = { x: 0.28, y: -0.26, z: -0.52 };
    this.gun.position.set(this._gunBase.x, this._gunBase.y, this._gunBase.z);
    g.camera.add(this.gun);
    if (!g.camera.parent) g.scene.add(g.camera);
  }

  toggle() {
    this.armed = !this.armed;
    this.held = false;
    this._spread = this.armed ? 0.35 : 0;
    document.body.classList.toggle('combat-armed', this.armed);
    if (this.armed) this.game._punchFov?.(-6);
    else this.game._punchFov?.(0);
  }

  receive(msg) {
    const g = this.game;
    if (msg.id !== g.net.id) {
      g.remotes.upsert(msg);
      if (msg.by === g.net.id && msg.hp != null) {
        this._flashHit(msg.hp <= 0);
      }
      return;
    }
    if (msg.hp < g.player.hp) {
      document.body.classList.add('combat-hurt');
      setTimeout(() => document.body.classList.remove('combat-hurt'), 220);
      g.player.addShake?.(0.04);
      g.player.viewKickP -= 0.02;
    }
    g.player.hp = msg.hp;
    this.lastHp = msg.hp;
    this.deadUntil = msg.deadUntil || 0;
    if (!msg.hp) {
      this.held = false;
      g.player.keys = {};
      this.armed = false;
      document.body.classList.remove('combat-armed');
    }
    if (msg.respawn) {
      const reset = () => {
        g.player.position.set(msg.x, msg.y, msg.z);
        g.player.velocity.set(0, 0, 0);
        g.player._fallVy = 0;
        g.player.invuln = 3;
        g.player._wasOnGround = true;
      };
      if (g.dimension !== msg.dimension) g._switchDimension(msg.dimension).then(reset);
      else reset();
    }
    g._updateHpHud();
  }

  _flashHit(kill) {
    this._hitUntil = performance.now() + (kill ? 280 : 120);
    this._killUntil = kill ? performance.now() + 400 : this._killUntil;
    this.hitMark.classList.toggle('kill', !!kill);
    this.hitMark.classList.add('show');
  }

  shoot() {
    const g = this.game;
    const now = performance.now();
    if (!this.armed || !g.isRunning || g.player.hp <= 0 || now < this.nextShot) return;
    if (this.deadUntil && Date.now() < this.deadUntil) return;
    this.nextShot = now + 105;

    const p = g.player;
    // 后坐力 + 散射（连射越开越散）
    const spread = 0.008 + this._spread * 0.018;
    p.viewKickP += 0.028 + Math.random() * 0.012;
    p.viewKickY += (Math.random() - 0.5) * 0.024;
    p.addShake?.(0.012);
    this._spread = Math.min(1, this._spread + 0.12);

    const dir = g.camera.getWorldDirection(new THREE.Vector3());
    // 轻微散射
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread * 0.7;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const origin = g.camera.position.clone();
    let distance = 80;
    for (let t = 0; t < 80; t += 0.05) {
      const bx = Math.floor(origin.x + dir.x * t);
      const by = Math.floor(origin.y + dir.y * t);
      const bz = Math.floor(origin.z + dir.z * t);
      if (isSolid(g.world.getBlock(bx, by, bz))) {
        distance = t;
        break;
      }
    }

    // 枪模型后坐
    this.gun.position.z = this._gunBase.z + 0.07;
    this.gun.rotation.x = -0.08;
    this.muzzle.material.opacity = 0.95;
    this.muzzle.scale.setScalar(1.6);

    if (g._online && g.net?.room) {
      g.net._send({ t: 'shoot', direction: [dir.x, dir.y, dir.z], distance });
    } else {
      this._offlineHit(origin, dir, distance);
      this.trace({
        origin: [origin.x, origin.y, origin.z],
        direction: [dir.x, dir.y, dir.z],
        distance,
        dimension: g.dimension,
      });
    }
  }

  _offlineHit(origin, dir, maxDist) {
    const g = this.game;
    let best = null;
    let bestT = maxDist;
    if (g.animalManager) {
      const hit = g.animalManager.raycast(origin, dir, maxDist);
      if (hit && hit.dist < bestT) {
        bestT = hit.dist;
        best = hit.robot;
      }
    }
    if (g._dragon && !g._dragon.dead) {
      const t = g._dragon.hitDistance(origin, dir, maxDist);
      if (t < bestT) {
        bestT = t;
        best = g._dragon;
      }
    }
    if (g._mistBoss && !g._mistBoss.dead) {
      const t = g._mistBoss.hitDistance(origin, dir, maxDist);
      if (t < bestT) { bestT = t; best = g._mistBoss; }
    }
    if (!best) return;
    if (best === g._mistBoss) {
      g._attackMob(best); this._flashHit(best.dead); return;
    }
    const result = best.takeDamage?.(5);
    this._flashHit(!!result?.dead);
    if (best === g._dragon && result?.dead) g._onDragonDefeated?.();
    else if (result?.dead && result.drops) {
      for (const d of result.drops) g.inventory.add(d, 1);
      g._updateHotbar();
    } else if (best.hp != null) {
      g._showSaveToast?.(`${best.kind || '目标'} ${Math.max(0, best.hp)} HP`);
    }
  }

  trace(msg) {
    if (msg.dimension !== this.game.dimension) return;
    const start = new THREE.Vector3(...msg.origin);
    const end = start.clone().addScaledVector(new THREE.Vector3(...msg.direction), msg.distance);
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffc107,
      transparent: true,
      opacity: 0.85,
    });
    const line = new THREE.Line(geo, mat);
    this.game.scene.add(line);
    this.traces.push({ line, mat, until: performance.now() + 70 });
  }

  tick() {
    const g = this.game;
    const active = g._controlsActive();

    this.panel.style.display = active ? 'flex' : 'none';
    this.gun.visible = active && this.armed && g.player.hp > 0;

    // 枪复位
    this.gun.position.z += (this._gunBase.z - this.gun.position.z) * 0.28;
    this.gun.rotation.x *= 0.75;
    if (this.muzzle.material.opacity > 0) {
      this.muzzle.material.opacity *= 0.65;
      this.muzzle.scale.multiplyScalar(0.85);
    }

    // 未射击时散射回收
    if (!this.held) this._spread = Math.max(0, this._spread - 0.025);

    const now = performance.now();
    if (now > this._hitUntil) this.hitMark.classList.remove('show', 'kill');

    // 准星扩散视觉
    const cross = document.getElementById('crosshair');
    if (cross) {
      const s = 1 + this._spread * 0.8;
      cross.style.transform = `translate(-50%, -50%) scale(${s})`;
    }

    this.status.textContent =
      g.player.hp <= 0
        ? `已阵亡 · ${Math.max(1, Math.ceil((this.deadUntil - Date.now()) / 1000))} 秒后重生`
        : this.armed
          ? 'AK · 按住开火 · Shift 冲刺 · Q 收枪'
          : 'Q 装备 AK · 可对战 / 打怪';
    if (g._fallbackActive) this.status.textContent += ' · 右键拖视角';

    if (!active) this.held = false;
    if (active && this.held) this.shoot();

    if (g._online && g.player.hp !== this.lastHp) {
      g.net._send({ t: 'vitals', delta: g.player.hp - this.lastHp });
      this.lastHp = g.player.hp;
    }

    if (!g._online && !g._dead && g.player.hp <= 0) {
      if (!this.deadUntil) {
        this.deadUntil = Date.now() + 3000;
        this.held = false;
      }
      if (Date.now() >= this.deadUntil) {
        const sp = g._starterPortalPos;
        this.receive({
          id: g.net.id,
          hp: 20,
          respawn: true,
          x: sp?.x ?? 7.5,
          y: (sp?.y ?? 19),
          z: (sp?.z ?? 4) + 3.5,
          dimension: 'overworld',
        });
        this.deadUntil = 0;
      }
    }

    for (let i = this.traces.length - 1; i >= 0; i--) {
      const { line, mat, until } = this.traces[i];
      if (performance.now() < until) {
        if (mat) mat.opacity *= 0.88;
        continue;
      }
      g.scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
      this.traces.splice(i, 1);
    }
  }
}
