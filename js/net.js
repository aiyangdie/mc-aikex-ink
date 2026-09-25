/**
 * 联机客户端：房间码建房/加入，同步方块与玩家位置
 */
import { apiUrl, wsUrl } from './config.js?v=groundfix9';

export class NetClient {
  constructor() {
    this.ws = null;
    this.room = null;
    this.id = null;
    this.color = null;
    this.connected = false;
    this._handlers = {};
    this._moveAcc = 0;
    this._pending = null;
  }

  on(event, fn) {
    this._handlers[event] = fn;
  }

  _emit(event, data) {
    const fn = this._handlers[event];
    if (fn) fn(data);
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return Promise.resolve();
    }
    const url = wsUrl();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* */ }
        reject(new Error('连接超时'));
      }, 8000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('无法连接联机服务'));
      };
      ws.onclose = () => {
        this.connected = false;
        this.room = null;
        if (this._pending) {
          this._pending.reject(new Error('连接已断开'));
          this._pending = null;
        }
        this._emit('close');
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this._onMsg(msg);
      };
    });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  _onMsg(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'err') {
      if (this._pending) {
        this._pending.reject(new Error(msg.msg || '错误'));
        this._pending = null;
      }
      this._emit('err', msg.msg || '错误');
      return;
    }
    if (msg.t === 'joined') {
      this.room = msg.room;
      this.id = msg.id;
      this.color = msg.color;
      if (this._pending) {
        this._pending.resolve(msg);
        this._pending = null;
      }
      this._emit('joined', msg);
      return;
    }
    if (msg.t === 'sync') {
      if (this._pending) {
        this._pending.resolve(msg);
        this._pending = null;
      }
      this._emit('sync', msg);
      return;
    }
    if (['boss','vitals','respawned','combat','shot','fireball','fire','chat','nuke','nuke_projectile','nuke_granted','terrain_reset','host','blink_fail','admin_effect'].includes(msg.t)) this._emit(msg.t, msg);
    else if (msg.t === 'block') this._emit('block', msg);
    else if (msg.t === 'move') this._emit('move', msg);
    else if (msg.t === 'peer') this._emit('peer', msg);
    else if (msg.t === 'bye') this._emit('bye', msg);
    else if (msg.t === 'mob') this._emit('mob', msg);
    else if (msg.t === 'mobs') this._emit('mobs', msg);
    else if (msg.t === 'mob_die') this._emit('mob_die', msg);
    else if (msg.t === 'admin_ok') {
      if (this._pending) {
        this._pending.resolve(msg);
        this._pending = null;
      }
      this._emit('admin_ok', msg);
    }
    else if (msg.t === 'admin_spawn') this._emit('admin_spawn', msg);
  }

  async adminAuth(key, name = '') {
    await this.connect();
    return this._request({ t: 'admin_auth', key, name });
  }

  async adminCmd(payload) {
    await this.connect();
    return this._request({ t: 'admin_cmd', ...payload });
  }

  /** 拉取房间权威快照（edits + players + mobs） */
  async sync() {
    if (!this.room) throw new Error('未在房间内');
    return this._request({ t: 'sync' });
  }

  sendChat(text){if(this.room)this._send({t:'chat',text});}
  sendTerrainReset(){if(this.room)this._send({t:'terrain_reset'});}

  sendHit(id, dmg = 3) {
    if (!this.room) return;
    this._send({ t: 'hit', id, dmg: dmg | 0 });
  }

  async create(name, editsArr, title) {
    await this.connect();
    return this._request({
      t: 'create',
      name,
      title: title || undefined,
      edits: editsArr || [],
    });
  }

  async join(room, name) {
    await this.connect();
    return this._request({ t: 'join', room: String(room).toUpperCase().trim(), name });
  }

  _request(payload) {
    return new Promise((resolve, reject) => {
      if (this._pending) {
        reject(new Error('请等待上一次操作完成'));
        return;
      }
      this._pending = { resolve, reject };
      this._send(payload);
      setTimeout(() => {
        if (this._pending && this._pending.reject === reject) {
          this._pending = null;
          reject(new Error('服务器无响应'));
        }
      }, 8000);
    });
  }

  sendBlock(x, y, z, b) {
    if (!this.room) return;
    this._send({ t: 'block', x: x | 0, y: y | 0, z: z | 0, b: b | 0 });
  }

  tickMove(dt, player, dimension = 'overworld') {
    if (!this.room) return;
    this._moveAcc += dt;
    if (this._moveAcc < 0.08) return;
    this._moveAcc = 0;
    const p = player.position;
    this._send({
      t: 'move', dimension: player.dimension || 'overworld',
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3),
    });
  }

  /** 拉取公开房间列表（真实在线人） */
  static async fetchRooms() {
    const r = await fetch(apiUrl(`/api/rooms?t=${Date.now()}`), { cache: 'no-store' });
    if (!r.ok) throw new Error(`房间列表失败 HTTP ${r.status}`);
    const data = await r.json();
    if (!data || !data.ok || !Array.isArray(data.rooms)) throw new Error('房间数据异常');
    return data.rooms;
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch { /* */ }
      this.ws = null;
    }
    this.connected = false;
    this.room = null;
    this._pending = null;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this._hb = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) this._send({ t: 'ping' });
    }, 12000);
  }

  stopHeartbeat() {
    if (this._hb) {
      clearInterval(this._hb);
      this._hb = null;
    }
  }
}

/** 远端玩家简易体素人偶 */
export class RemotePlayers {
  constructor(scene, THREE) {
    this.scene = scene;
    this.THREE = THREE;
    this.map = new Map();
    this._labelRoot = null;
    this._tmp = new THREE.Vector3();
  }

  _ensureLabelRoot() {
    if (this._labelRoot) return this._labelRoot;
    const el = document.createElement('div');
    el.id = 'remoteLabels';
    document.body.appendChild(el);
    this._labelRoot = el;
    return el;
  }

  upsert(info) {
    const THREE = this.THREE;
    let entry = this.map.get(info.id);
    if (!entry) {
      const group = new THREE.Group();
      const color = info.color || 0x4f8cff;
      const mat = (hex, rough = 0.8, metalness = 0) =>
        new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness });
      const skin = mat(0xffd0ad);
      const hair = mat(0x2a2031, 0.6);
      const cloth = mat(color);
      const clothDark = mat(0x1b2b4a);
      const trim = mat(0xffd166, 0.45, 0.15);
      const boot = mat(0x242936, 0.65);
      const white = mat(0xffffff, 0.35);

      const cube = (w, h, d, material, x, y, z = 0) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
        mesh.position.set(x, y, z);
        group.add(mesh);
        return mesh;
      };
      // 头部：发型、脸、眼睛和颈部，让玩家从远处也有清晰轮廓。
      cube(0.34, 0.12, 0.42, hair, 0, 1.82);
      cube(0.42, 0.43, 0.40, skin, 0, 1.57);
      cube(0.44, 0.12, 0.43, hair, 0, 1.79);
      cube(0.08, 0.07, 0.018, white, -0.085, 1.60, -0.211);
      cube(0.08, 0.07, 0.018, white, 0.085, 1.60, -0.211);
      cube(0.035, 0.045, 0.02, clothDark, -0.085, 1.60, -0.223);
      cube(0.035, 0.045, 0.02, clothDark, 0.085, 1.60, -0.223);
      cube(0.16, 0.12, 0.16, skin, 0, 1.31);

      // 身体：衣服、腰带、胸口徽记和披风。
      const body = cube(0.62, 0.78, 0.40, cloth, 0, 0.94);
      cube(0.66, 0.08, 0.43, trim, 0, 0.69);
      cube(0.12, 0.16, 0.025, trim, 0, 1.05, -0.215);
      const cape = cube(0.50, 0.70, 0.06, clothDark, 0, 1.00, 0.23);
      cape.rotation.x = -0.08;
      cube(0.72, 0.10, 0.46, trim, 0, 1.31);

      // 使用关节 Group 旋转，动作会自然地从肩膀/髋部开始。
      const limb = (x, y, material, leg = false) => {
        const joint = new THREE.Group();
        joint.position.set(x, y, 0);
        const part = new THREE.Mesh(
          new THREE.BoxGeometry(leg ? 0.19 : 0.17, leg ? 0.72 : 0.62, leg ? 0.20 : 0.18),
          material
      );
        part.position.y = leg ? -0.36 : -0.31;
        joint.add(part);
        group.add(joint);
        return joint;
      };
      const armL = limb(-0.40, 1.25, cloth, false);
      const armR = limb(0.40, 1.25, cloth, false);
      const legL = limb(-0.18, 0.69, clothDark, true);
      const legR = limb(0.18, 0.69, clothDark, true);
      cube(0.22, 0.12, 0.32, boot, -0.18, 0.04, -0.05);
      cube(0.22, 0.12, 0.32, boot, 0.18, 0.04, -0.05);
      cube(0.12, 0.12, 0.08, trim, -0.40, 0.98);
      cube(0.12, 0.12, 0.08, trim, 0.40, 0.98);
      this.scene.add(group);

      const avatarMaterials = [skin, hair, cloth, clothDark, trim, boot, white];

      const label = document.createElement('div');
      label.className = 'remote-label';
      label.textContent = info.name || '玩家';
      const health = document.createElement('progress');
      health.max = 20; health.value = 20; label.appendChild(health);
      this._ensureLabelRoot().appendChild(label);

      entry = {
        mesh: group, label, body, health, armL, armR, legL, legR, avatarMaterials,
        name: info.name || '玩家', hp: 20, dimension: 'overworld',
        target: { x: 0, y: 0, z: 0, yaw: 0 },
        _phase: Math.random() * Math.PI * 2,
        _idle: Math.random() * Math.PI * 2,
        _hurt: 0,
        _inited: false,
      };
      this.map.set(info.id, entry);
    }
    if (info.name) { entry.name = info.name; entry.label.firstChild.textContent = info.name; }
    if (info.hp != null) {
      if (info.hp < entry.hp) entry._hurt = 0.24;
      entry.hp = info.hp;
      entry.health.value = info.hp;
    }
    if (info.dimension) entry.dimension = info.dimension;
    if (info.respawn || info.teleport) entry._inited = false;
    if (info.color != null && entry.body?.material?.color) {
      entry.body.material.color.setHex(info.color);
    }
    if (info.x != null) {
      entry.target.x = info.x;
      entry.target.y = info.y;
      entry.target.z = info.z;
      entry.target.yaw = info.yaw || 0;
      if (!entry._inited) {
        entry.mesh.position.set(info.x, info.y, info.z);
        entry.mesh.rotation.y = info.yaw || 0;
        entry._inited = true;
      }
    }
  }

  remove(id) {
    const entry = this.map.get(id);
    if (!entry) return;
    this.scene.remove(entry.mesh);
    entry.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    entry.label?.parentNode?.removeChild(entry.label);
    this.map.delete(id);
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }

  update(dt, camera, dimension = 'overworld') {
    const THREE = this.THREE;
    for (const entry of this.map.values()) {
      const m = entry.mesh;
      const t = entry.target;
      const k = Math.min(1, dt * 12);
      m.position.x += (t.x - m.position.x) * k;
      m.position.y += (t.y - m.position.y) * k;
      m.position.z += (t.z - m.position.z) * k;
      m.rotation.y = t.yaw;
      const dx = t.x - m.position.x;
      const dz = t.z - m.position.z;
      const moving = Math.hypot(dx, dz) > 0.025;
      if (moving) entry._phase += dt * 10;
      const swing = moving ? Math.sin(entry._phase) * 0.45 : 0;
      entry.armL.rotation.x = swing;
      entry.armR.rotation.x = -swing;
      entry.legL.rotation.x = -swing;
      entry.legR.rotation.x = swing;
      entry._idle += dt * (moving ? 3 : 1.8);
      const breathing = Math.sin(entry._idle) * (moving ? 0.008 : 0.018);
      m.position.y += breathing;
      entry._hurt = Math.max(0, entry._hurt - dt);
      const flash = entry._hurt > 0;
      for (const material of entry.avatarMaterials) {
        material.emissive?.setHex(flash ? 0x8b1e2d : 0x000000);
        if (material.emissiveIntensity != null) material.emissiveIntensity = flash ? 0.8 : 0;
      }

      const v = this._tmp.set(m.position.x, m.position.y + 2.0, m.position.z);
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      m.visible = entry.hp > 0 && entry.dimension === dimension;
      if (v.z > 1 || !m.visible) {
        entry.label.style.display = 'none';
      } else {
        entry.label.style.display = 'block';
        entry.label.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
      }
    }
  }
}
