import * as THREE from 'three';
import { Mage } from './mage.js?v=playerstats6';
import { isSolid } from './voxel.js?v=playerstats6';
import { CombatPhysics, pickRandomSpawn } from './physics.js?v=playerstats6';

/**
 * AK：联机打玩家；单机/联机本地弹道可打动物（PvE）
 * 子弹有重力与碰撞；命中击退；复活随机点
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this.armed = false;
    this.mode = 'build';
    this.mage = new Mage(game);
    this.held = false;
    this.nextShot = 0;
    this.deadUntil = 0;
    this.lastHp = game.player.hp;
    this.traces = [];
    this._spread = 0;
    this._hitUntil = 0;
    this.physics = new CombatPhysics(game);

    this.panel = document.createElement('div');
    this.panel.id = 'combatHud';
    this.panel.innerHTML =
      '<button type="button" id="equipAK">切换职业 [Q]</button>' +
      '<button type="button" id="fireAK">开火</button>' +
      '<button type="button" id="blinkMage">闪现 [Z]</button>' +
      '<button type="button" id="buildMode">建造 [B]</button>' +
      '<span id="combatStatus"></span>';
    document.body.appendChild(this.panel);
    this.status = this.panel.querySelector('#combatStatus');

    this.hitMark = document.createElement('div');
    this.hitMark.id = 'hitMarker';
    this.hitMark.innerHTML = '<i></i><i></i><i></i><i></i>';
    document.body.appendChild(this.hitMark);

    const equip = this.panel.querySelector('#equipAK');
    equip.onclick = () => this.toggle();
    this.panel.querySelector('#blinkMage').onclick = () => this.mage.blink();
    this.panel.querySelector('#buildMode').onclick = () => this.setMode('build');
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
      if (!game._controlsActive() || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === 'KeyB' && !e.repeat) this.setMode('build');
      if (e.code === 'KeyZ' && !e.repeat) {
        e.preventDefault();
        this.mage.blink();
      }
      if (e.code === 'KeyQ' && !e.repeat) this.toggle();
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

  setMode(mode) {
    if (this.game.player.hp <= 0) return;
    this.mode = mode; this.armed = mode !== 'build'; this.held = false;
    this._spread = mode === 'ak' ? .35 : 0;
    document.body.classList.toggle('combat-armed', this.armed);
    this.game._punchFov?.(mode === 'ak' ? -6 : 0);
    if (this.game._online) this.game.net._send({t:'mode',mode});
  }
  toggle() { this.setMode(this.mode === 'ak' ? 'mage' : 'ak'); }

  receive(msg) {
    const g = this.game;
    if (msg.id !== g.net.id) {
      g.remotes.upsert(msg);
      if (msg.by === g.net.id && msg.hp != null) this._flashHit(msg.hp <= 0);
      return;
    }
    if (msg.hp < g.player.hp) {
      document.body.classList.add('combat-hurt');
      setTimeout(() => document.body.classList.remove('combat-hurt'), 220);
      g.player.addShake?.(0.04);
      g.player.viewKickP -= 0.02;
      if (msg.kx != null) {
        g.player.knockVelocity.x += msg.kx;
        g.player.knockVelocity.y += msg.ky || 3.2;
        g.player.knockVelocity.z += msg.kz;
      }
    }
    g.player.hp = msg.hp;
    this.lastHp = msg.hp;
    this.deadUntil = msg.deadUntil || 0;
    if (!msg.hp) {
      this.held = false;
      g.player.keys = {};
      document.body.classList.remove('combat-armed');
    }
    if (msg.teleport) {
      this.mage.teleport([msg.x, msg.y, msg.z]);
      if (msg.nextBlink) this.mage.nextBlink = msg.nextBlink;
    }
    if (msg.respawn) {
      document.body.classList.toggle('combat-armed', this.armed);
      const reset = () => {
        g.player.position.set(msg.x, msg.y, msg.z);
        g.player.velocity.set(0, 0, 0);
        g.player.knockVelocity.set(0, 0, 0);
        g.player._fallVy = 0;
        g.player.invuln = 3;
        g.player._wasOnGround = true;
        g._showSaveToast?.(`复活 @ ${msg.x.toFixed?.(0) ?? msg.x}, ${msg.z.toFixed?.(0) ?? msg.z}`);
      };
      if (msg.dimension && g.dimension !== msg.dimension) {
        g._switchDimension(msg.dimension).then(reset);
      } else reset();
    }
    g._updateHpHud();
  }

  _flashHit(kill) {
    this._hitUntil = performance.now() + (kill ? 280 : 120);
    this.hitMark.classList.toggle('kill', !!kill);
    this.hitMark.classList.add('show');
  }

  shoot() {
    const g = this.game;
    const now = performance.now();
    if (!this.armed || !g.isRunning || g.player.hp <= 0 || now < this.nextShot) return;
    if (this.deadUntil && Date.now() < this.deadUntil) return;
    if (this.mode === 'mage') { this.mage.cast(); return; }
    this.nextShot = now + 120;

    const p = g.player;
    const spread = 0.008 + this._spread * 0.018;
    p.viewKickP += 0.028 + Math.random() * 0.012;
    p.viewKickY += (Math.random() - 0.5) * 0.024;
    p.addShake?.(0.012);
    this._spread = Math.min(1, this._spread + 0.12);

    const dir = g.camera.getWorldDirection(new THREE.Vector3());
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

    this.gun.position.z = this._gunBase.z + 0.07;
    this.gun.rotation.x = -0.08;
    this.muzzle.material.opacity = 0.95;
    this.muzzle.scale.setScalar(1.6);

    const online = !!(g._online && g.net?.room);

    // 物理弹道：打动物 / 打龙（联机也开，PvE）；联机打玩家仍走服务器判定
    this.physics.fire(origin, dir.clone(), {
      online: false, // 本地弹道负责生物
      damage: 5,
      onHit: ({ target, dir: hitDir, damage }) => this._onBulletHit(target, hitDir, damage),
    });

    if (online) {
      g.net._send({ t: 'shoot', direction: [dir.x, dir.y, dir.z], distance });
    }

    // 短曳光（表现）
    this.trace({
      origin: [origin.x, origin.y, origin.z],
      direction: [dir.x, dir.y, dir.z],
      distance: Math.min(distance, 40),
      dimension: g.dimension,
    });
  }

  _onBulletHit(target, dir, damage) {
    const g = this.game;
    if (!target) return;
    if (target === g._mistBoss) {
      if (!g._online) g._attackMob(target); // online shot damage is server owned
      this._flashHit(target.dead); return;
    }
    // 联机生物走服务器权威，避免本地扣血后被 mobs 广播盖回
    if (g._online && g.net?.room && target._netDriven && target.id) {
      g.net.sendHit(target.id, damage);
      target.hurtTimer = 0.35;
      this._flashHit(false);
      return;
    }
    const result = target.takeDamage?.(damage, dir, 8);
    this._flashHit(!!result?.dead);
    if (target === g._dragon && result?.dead) g._onDragonDefeated?.();
    else if (result?.dead && result.drops) {
      g._onLocalMobKill?.(target, result.drops);
    } else if (target.hp != null && !target.dead) {
      const name = target.def?.name || target.kind || '目标';
      g._showSaveToast?.(`${name} ${Math.max(0, target.hp)} HP`);
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
      opacity: 0.7,
    });
    const line = new THREE.Line(geo, mat);
    this.game.scene.add(line);
    this.traces.push({ line, mat, until: performance.now() + 60 });
  }

  _doLocalRespawn() {
    const g = this.game;
    const spot = pickRandomSpawn(g.world, g.dimension);
    this.receive({
      id: g.net.id,
      hp: 20,
      respawn: true,
      x: spot.x,
      y: spot.y,
      z: spot.z,
      dimension: spot.dimension || g.dimension,
    });
    this.deadUntil = 0;
  }

  tick(dt = 0.016) {
    const g = this.game;
    const active = g._controlsActive();

    this.physics.tick(dt);

    this.panel.style.display = active ? 'flex' : 'none';
    this.mage.tick(active);
    this.panel.querySelector('#blinkMage').style.display = '';
    this.panel.querySelector('#fireAK').textContent = this.mode === 'mage' ? '火球术' : '开火';
    this.gun.visible = active && this.mode === 'ak' && g.player.hp > 0;

    this.gun.position.z += (this._gunBase.z - this.gun.position.z) * 0.28;
    this.gun.rotation.x *= 0.75;
    if (this.muzzle.material.opacity > 0) {
      this.muzzle.material.opacity *= 0.65;
      this.muzzle.scale.multiplyScalar(0.85);
    }

    if (!this.held) this._spread = Math.max(0, this._spread - 0.025);

    if (performance.now() > this._hitUntil) this.hitMark.classList.remove('show', 'kill');

    const cross = document.getElementById('crosshair');
    if (cross) {
      const s = 1 + this._spread * 0.8;
      cross.style.transform = `translate(-50%, -50%) scale(${s})`;
    }

    const blinkCd = Math.ceil(this.mage.cdLeft() / 1000);
    const blinkTxt = blinkCd > 0 ? `Z闪现 ${blinkCd}s` : 'Z闪现就绪';
    this.status.textContent =
      g.player.hp <= 0
        ? `已阵亡 · ${Math.max(1, Math.ceil((this.deadUntil - Date.now()) / 1000))} 秒后随机复活`
        : this.mode === 'mage'
          ? `法师 · 火球 · ${blinkTxt} · Q切AK · B建造`
          : this.armed
            ? `AK · ${blinkTxt} · Q切法师 · B建造`
            : `建造 · ${blinkTxt} · Q开战 · 右键炸弹`;

    if (g._fallbackActive) this.status.textContent += ' · WASD 移动 / 右键拖动视角 / Esc 暂停';
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
      if (Date.now() >= this.deadUntil) this._doLocalRespawn();
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
