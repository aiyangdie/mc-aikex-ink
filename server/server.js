/**
 * mc.aikex.ink 联机 WebSocket 服务
 *
 * 方案（权威在服务端，浏览器只收发）：
 * 1. 建房 create → 房间码 + 初始 edits（可带本地差分）
 * 2. 加入 join / 列表 GET /api/rooms
 * 3. 玩：block / move 广播；sync 拉权威快照（防房主「等待进房」时状态过期）
 * 4. 落盘 data/rooms.json（进程重启不丢房间差分；仍非 SQL）
 */
'use strict';

const http = require('http');
const combat = require('./combat.cjs');
const { Spells } = require('./mage.cjs');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

async function main() {
const { RoomBoss, CollisionWorld } = await import('./room-boss.mjs');
const { isSolid } = await import('../js/voxel.js');
const { getFoodHeal } = await import('../js/items.js');
const { buildMobDrops } = await import('../js/loot.js');
const PORT = Number(process.env.PORT || 3040);
const HOST = process.env.HOST || '127.0.0.1';
const OWNER_KEY = process.env.MC_OWNER_KEY || 'aikex-mc-2026';
if (!process.env.MC_OWNER_KEY) {
  console.warn('[mc] WARN: MC_OWNER_KEY unset — using insecure default. Set it in ecosystem.config.cjs');
}
const SEED = 12345;
const MAX_PLAYERS = 8;
const MAX_ROOMS = 64;
const MAX_EDITS = 60000;
const MOVE_MIN_MS = 50;
const EMPTY_GRACE_MS = 120_000;
const DATA_DIR = process.env.MC_DATA_DIR || path.join(__dirname, 'data');
const PERSIST_PATH = path.join(DATA_DIR, 'rooms.json');
const ADMINS_PATH = path.join(DATA_DIR, 'admins.json');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const ADMIN_LOG_PATH = path.join(DATA_DIR, 'admin.log');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = [0xe57373, 0x64b5f6, 0x81c784, 0xffb74d, 0xba68c8, 0x4dd0e1, 0xfff176, 0xf06292];

function genCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** @type {Map<string, Room>} */
const rooms = new Map();
let persistTimer = null;
let mobIdSeq = 1;

function nextMobId() {
  return `M${(mobIdSeq++).toString(36)}`;
}

class Mob {
  constructor(kind, x, y, z) {
    this.id = nextMobId();
    this.kind = kind; // scout | heavy
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = Math.random() * Math.PI * 2;
    const HP = { pig:8,cow:12,chicken:4,duck:5,deer:10,horse:16,donkey:14,scout:10,heavy:20,dragon:200 };
    this.maxHp = HP[kind] || 8;
    this.hp = this.maxHp;
    this.speed = kind === 'heavy' ? 0.8 : 1.2;
    this.dir = Math.random() * Math.PI * 2;
    this.alive = true;
    this.stuckTime = 0;
    this.width = { pig:.8,cow:.95,chicken:.45,duck:.5,deer:.7,horse:.9,donkey:.85,scout:.7,heavy:.9,dragon:1.2 }[kind] || .8;
    this.height = { pig:.85,cow:1.15,chicken:.55,duck:.55,deer:1.2,horse:1.4,donkey:1.25,scout:1,heavy:1.2,dragon:2 }[kind] || 1;
  }

  toJSON() {
    return {
      id: this.id, kind: this.kind,
      x: +this.x.toFixed(2), y: +this.y.toFixed(2), z: +this.z.toFixed(2),
      yaw: +this.yaw.toFixed(3), hp: this.hp, maxHp: this.maxHp,
    };
  }

  _groundY(world, x, z) {
    for (let y = 46; y >= 0; y--) {
      if (isSolid(world.getBlock(Math.floor(x), y, Math.floor(z)))
          && !isSolid(world.getBlock(Math.floor(x), y + 1, Math.floor(z)))
          && !isSolid(world.getBlock(Math.floor(x), y + 2, Math.floor(z)))) return y + 1;
    }
    return null;
  }

  _canOccupy(world, x, y, z) {
    const half = this.width * 0.5;
    const minX = Math.floor(x - half + 0.08), maxX = Math.floor(x + half - 0.08);
    const minZ = Math.floor(z - half + 0.08), maxZ = Math.floor(z + half - 0.08);
    const minY = Math.floor(y + 0.05), maxY = Math.floor(y + this.height - 0.05);
    for (let bx = minX; bx <= maxX; bx++) for (let bz = minZ; bz <= maxZ; bz++) {
      for (let by = minY; by <= maxY; by++) if (isSolid(world.getBlock(bx, by, bz))) return false;
    }
    return true;
  }

  tick(dt, world) {
    if (!this.alive) return;
    if (Math.random() < dt * 0.4) this.dir += (Math.random() - 0.5) * 1.2;
    // 圈在出生点附近
    const cx = 5.4, cz = 22.6;
    const dx = this.x - cx, dz = this.z - cz;
    if (dx * dx + dz * dz > 28 * 28) {
      this.dir = Math.atan2(cz - this.z, cx - this.x);
    }
    const offsets = [0, .55, -.55, 1.1, -1.1, Math.PI];
    let moved = false;
    const step = this.speed * Math.min(dt, .2);
    for (const offset of offsets) {
      const angle = this.dir + offset;
      const x = this.x + Math.cos(angle) * step;
      const z = this.z + Math.sin(angle) * step;
      const y = this._groundY(world, x, z);
      if (y === null || Math.abs(y - this.y) > 1.05 || !this._canOccupy(world, x, y, z)) continue;
      this.x = x; this.y = y; this.z = z; this.dir = angle; moved = true; this.stuckTime = 0; break;
    }
    if (!moved) {
      this.stuckTime += dt;
      this.dir += 0.8 + Math.random() * 1.4;
      if (this.stuckTime > 2) {
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 2;
          const x = this.x + Math.cos(a) * r, z = this.z + Math.sin(a) * r, y = this._groundY(world, x, z);
          if (y !== null && Math.abs(y - this.y) <= 1.05 && this._canOccupy(world, x, y, z)) {
            this.x = x; this.y = y; this.z = z; this.dir = a; this.stuckTime = 0; break;
          }
        }
      }
    }
    this.yaw = this.dir;
  }
}

class Room {
  constructor(code, title, hostName) {
    this.code = code;
    this.seed = SEED;
    this.title = title;
    this.hostName = hostName;
    this.hostId = null;
    this.edits = new Map();
    this.peers = new Map();
    this.mobs = new Map();
    this.spells = new Spells();
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.emptyAt = 0;
    this._spawnMobs();
    this.collision = new CollisionWorld(this.seed, this.edits);
    this.boss = new RoomBoss(this.collision);
  }

  _spawnMobs() {
    const baseY = 18;
    this.mobs.clear();
    const kinds = ['pig','cow','chicken','duck','deer','horse','donkey','pig','cow','deer'];
    for (const kind of kinds) {
      const a = Math.random() * Math.PI * 2;
      const d = 5 + Math.random() * 16;
      const m = new Mob(kind, 5.4 + Math.cos(a) * d, baseY, 22.6 + Math.sin(a) * d);
      this.mobs.set(m.id, m);
    }
  }

  mobsArray() {
    return [...this.mobs.values()].filter((m) => m.alive).map((m) => m.toJSON());
  }

  hitMob(id, dmg, byId) {
    const m = this.mobs.get(id);
    if (!m || !m.alive) return null;
    m.hp -= Math.max(1, Math.min(10, dmg | 0 || 3));
    this.touch();
    if (m.hp <= 0) {
      m.alive = false;
      m.hp = 0;
      this.mobs.delete(id);
      return { die: true, mob: m.toJSON(), by: byId };
    }
    return { die: false, mob: { ...m.toJSON(), hurt: true }, by: byId };
  }

  tickMobs(dt) {
    for (const m of this.mobs.values()) m.tick(dt, this.collision);
  }

  touch() {
    this.lastActive = Date.now();
    schedulePersist();
  }

  editsArray() {
    const arr = [];
    for (const [k, t] of this.edits) {
      const p = k.split(',');
      if (p.length !== 3) continue;
      arr.push(+p[0], +p[1], +p[2], t | 0);
    }
    return arr;
  }

  applyEditsArray(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i + 3 < arr.length; i += 4) {
      if (this.edits.size >= MAX_EDITS) break;
      this.edits.set(`${arr[i] | 0},${arr[i + 1] | 0},${arr[i + 2] | 0}`, arr[i + 3] | 0);
    }
  }

  setBlock(x, y, z, b) {
    if (this.edits.size >= MAX_EDITS && !this.edits.has(`${x},${y},${z}`)) return false;
    this.edits.set(`${x | 0},${y | 0},${z | 0}`, b | 0);
    this.touch();
    return true;
  }

  playersList(exceptWs = null) {
    const list = [];
    for (const [ws, p] of this.peers) {
      if (ws === exceptWs) continue;
      list.push({
        ...combat.state(p), name: p.name, color: p.color, host: !!p.isHost,
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      });
    }
    return list;
  }

  adminTargets() {
    return [...this.peers.values()].map((p) => ({
      id: p.id, name: p.name, hp: p.hp, maxHp: 20,
      dimension: p.dimension, host: !!p.isHost,
    }));
  }

  playerNames() {
    return [...this.peers.values()].map((p) => p.name);
  }

  snapshotFor(ws) {
    return {
      t: 'sync',
      boss: this.boss.snapshot(),

      spells: this.spells.snapshot(Date.now()),

      self: this.peers.has(ws) ? combat.state(this.peers.get(ws)) : null,
      room: this.code,
      title: this.title,
      seed: this.seed,
      edits: this.editsArray(),
      players: this.playersList(ws),
      playersCount: this.peers.size,
      mobs: this.mobsArray(),
    };
  }

  peerState(peer) {
    if (!peer) return null;
    return {hp:peer.hp,x:peer.x,y:peer.y,z:peer.z,dimension:peer.dimension};
  }

  broadcast(obj, exceptWs = null) {
    const raw = JSON.stringify(obj);
    for (const [ws] of this.peers) {
      if (ws === exceptWs) continue;
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  toPublic() {
    return {
      code: this.code,
      title: this.title,
      host: this.hostName,
      players: this.peers.size,
      max: MAX_PLAYERS,
      names: this.playerNames(),
      edits: this.edits.size,
      full: this.peers.size >= MAX_PLAYERS,
      createdAt: this.createdAt,
      ageSec: Math.floor((Date.now() - this.createdAt) / 1000),
    };
  }

  toPersist() {
    return {
      code: this.code,
      title: this.title,
      hostName: this.hostName,
      boss: this.boss.snapshot(),
      seed: this.seed,
      edits: this.editsArray(),
      createdAt: this.createdAt,
      lastActive: this.lastActive,
    };
  }

  static fromPersist(row) {
    const room = new Room(row.code, row.title || row.code, row.hostName || 'Host');
    room.seed = row.seed | 0 || SEED;
    room.createdAt = row.createdAt || Date.now();
    room.lastActive = row.lastActive || Date.now();
    room.applyEditsArray(row.edits);
    room.collision = new CollisionWorld(room.seed, room.edits);
    room.boss = new RoomBoss(room.collision, row.boss || undefined);
    room.emptyAt = Date.now(); // 重启后无人，走宽限
    return room;
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 800);
}

function persistNow() {
  try {
    const dir = path.dirname(PERSIST_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      v: 1,
      savedAt: Date.now(),
      rooms: [...rooms.values()].map((r) => r.toPersist()),
    };
    const tmp = PERSIST_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, PERSIST_PATH);
  } catch (err) {
    console.error('[mc-ws] persist fail', err.message);
  }
}

function loadPersist() {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf8'));
    if (!raw || !Array.isArray(raw.rooms)) return;
    for (const row of raw.rooms) {
      if (!row || !row.code) continue;
      if (rooms.size >= MAX_ROOMS) break;
      if (rooms.has(row.code)) continue;
      rooms.set(row.code, Room.fromPersist(row));
    }
    console.log(`[mc-ws] loaded ${rooms.size} rooms from disk`);
  } catch (err) {
    console.error('[mc-ws] load persist fail', err.message);
  }
}

function listPublicRooms() {
  return [...rooms.values()]
    .filter((r) => r.peers.size > 0)
    .sort((a, b) => b.lastActive - a.lastActive)
    .map((r) => r.toPublic());
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function leaveRoom(ws) {
  const peer = ws._peer;
  if (!peer || !peer.room) return;
  const room = peer.room;
  const wasHost = !!peer.isHost;
  room.peers.delete(ws);
  room.broadcast({ t: 'bye', id: peer.id });
  peer.room = null;
  if (room.peers.size === 0) {
    room.emptyAt = Date.now();
    console.log(`[mc-ws] room ${room.code} empty, grace ${EMPTY_GRACE_MS / 1000}s`);
    schedulePersist();
  } else if (wasHost) {
    const next = room.peers.values().next().value;
    if (next) {
      room.hostName = next.name;
      room.hostId = next.id;
      next.isHost = true;
      room.broadcast({ t: 'peer', ...combat.state(next), id: next.id, name: next.name, color: next.color, host: true });
    }
    schedulePersist();
  }
}

function findFreeCode() {
  for (let i = 0; i < 40; i++) {
    const c = genCode();
    if (!rooms.has(c)) return c;
  }
  return null;
}

function joinRoom(ws, room, name) {
  if (room.peers.size >= MAX_PLAYERS) {
    send(ws, { t: 'err', msg: '房间已满（最多 8 人）' });
    return;
  }
  leaveRoom(ws);
  room.emptyAt = 0;
  const id = genId();
  const color = COLORS[room.peers.size % COLORS.length];
  const isHost = room.peers.size === 0;
  const peer = {
    id,
    name: (name || '玩家').slice(0, 12),
    color,
    ...room.collision.spawn(), yaw: 0, pitch: -0.1,
    hp:20, active:false, invuln:0, dimension:'overworld', lastBossHit:-Infinity,
    room, lastMove: 0, isHost, lockedUntil: 0,
  };
  if (isHost) room.hostId = id;
  combat.init(peer);
  ws._peer = peer;
  room.peers.set(ws, peer);
  room.touch();
  console.log(`[mc-ws] join ${room.code} as ${peer.name} (${room.peers.size}/${MAX_PLAYERS})`);

  send(ws, {
    t: 'joined',
    boss: room.boss.snapshot(),

    spells: room.spells.snapshot(Date.now()),

    self: combat.state(peer),
    room: room.code,
    title: room.title,
    id,
    seed: room.seed,
    color,
    edits: room.editsArray(),
    players: room.playersList(ws),
    mobs: room.mobsArray(),
    host: isHost,
    roomAdmin: isHost,
  });
  room.broadcast({
    t: 'peer',
    ...combat.state(peer),
    id, name: peer.name, color,
    x: peer.x, y: peer.y, z: peer.z, yaw: peer.yaw, pitch: peer.pitch, host: isHost,
  }, ws);
}

loadPersist();

function adminLog(line) {
  const row = `[${new Date().toISOString()}] ${line}\n`;
  console.log('[admin]', line);
  try { fs.appendFileSync(ADMIN_LOG_PATH, row); } catch { /* */ }
}

function loadAdmins() {
  try {
    if (!fs.existsSync(ADMINS_PATH)) return { version: 1, admins: [] };
    return JSON.parse(fs.readFileSync(ADMINS_PATH, 'utf8')) || { version: 1, admins: [] };
  } catch {
    return { version: 1, admins: [] };
  }
}

function saveAdmins(data) {
  const dir = path.dirname(ADMINS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ADMINS_PATH, JSON.stringify(data, null, 2));
}

function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch {
    return { version: 1, mobs: [], items: [], structures: [] };
  }
}

function saveCatalog(data) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(data, null, 2));
}

function genToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/** @returns {'owner'|'admin'|null} — 必须凭密钥/token，禁止仅凭昵称提权 */
function resolveRole(key, _name) {
  if (key && key === OWNER_KEY) return 'owner';
  if (!key) return null;
  const data = loadAdmins();
  const hit = (data.admins || []).find((a) => a.token === key);
  return hit ? 'admin' : null;
}

function publicAdmins() {
  return (loadAdmins().admins || []).map((a) => ({
    name: a.name,
    token: a.token,
    role: 'admin',
  }));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', `http://${HOST}`).pathname;
  } catch { /* */ }

  if (pathname === '/health' || pathname === '/api/health') {
    json(res, 200, {
      ok: true,
      rooms: rooms.size,
      open: listPublicRooms().length,
      persist: PERSIST_PATH,
      admin: true,
    });
    return;
  }

  if (pathname === '/api/rooms' || pathname === '/rooms') {
    json(res, 200, {
      ok: true,
      ts: Date.now(),
      rooms: listPublicRooms(),
    });
    return;
  }

  if (pathname === '/api/catalog') {
    json(res, 200, loadCatalog());
    return;
  }

  if (process.env.MC_SERVE_STATIC === '1' && req.method === 'GET') {
    // Local development only: expose game assets, never server/data or dotfiles.
    const asset = pathname === '/' ? '/index.html' : pathname;
    if (/^\/(?:index\.html|(?:js|styles)\/[a-zA-Z0-9_-]+\.(?:js|css)|assets\/models\/mist-heroine\.glb|vendor\/three\/(?:three\.module\.js|addons\/(?:loaders\/GLTFLoader|utils\/BufferGeometryUtils)\.js))$/.test(asset)) {
      const file = path.join(__dirname, '..', asset.slice(1));
      if (fs.existsSync(file)) {
        const mime = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.glb') ? 'model/gltf-binary' : 'text/html';
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        fs.createReadStream(file).pipe(res); return;
      }
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('mc-ws');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws._peer = null;

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'ping') {
      send(ws, { t: 'pong', ts: Date.now() });
      return;
    }

    // —— 管理鉴权（可不在房间内）——
    if (msg.t === 'admin_auth') {
      const roomOwner = String(msg.key || '') === 'room-owner'
        && ws._peer?.room && ws._peer.isHost;
      const role = roomOwner ? 'room-owner' : resolveRole(String(msg.key || ''), String(msg.name || ''));
      if (!role) {
        adminLog(`auth FAIL from ${msg.name || '?'}`);
        send(ws, { t: 'err', msg: '密钥无效' });
        return;
      }
      ws._adminRole = role;
      ws._adminKey = String(msg.key || '');
      let token;
      if (role === 'admin') {
        const hit = (loadAdmins().admins || []).find((a) => a.token === msg.key);
        token = hit?.token;
      }
      adminLog(`auth OK role=${role} name=${msg.name || '-'}`);
      send(ws, {
        t: 'admin_ok',
        role,
        token,
        admins: role === 'owner' ? publicAdmins() : undefined,
        targets: role === 'room-owner' ? ws._peer.room.adminTargets() : undefined,
      });
      return;
    }

    if (msg.t === 'admin_cmd') {
      const key = String(msg.key || ws._adminKey || '');
      let role = ws._adminRole || resolveRole(key, ws._peer?.name || '');
      // 房主权限只对当前房间生效，且每条命令都重新确认房主身份。
      if (role === 'room-owner' && !ws._peer?.room?.peers?.has(ws)) role = null;
      if (role === 'room-owner' && !ws._peer.isHost) role = null;
      if (!role) {
        adminLog(`cmd DENY ${msg.cmd}`);
        send(ws, { t: 'err', msg: '无管理权限' });
        return;
      }
      ws._adminRole = role;

      const room = ws._peer?.room;
      const roomCommand = ['targets', 'lock', 'give', 'heal', 'spawn', 'clear_mobs'].includes(msg.cmd);
      if (role === 'room-owner' && !roomCommand) {
        send(ws, { t: 'err', msg: '房主管理员只能管理当前房间' });
        return;
      }

      if (msg.cmd === 'targets') {
        if (!room) { send(ws, { t: 'err', msg: '请先进入房间' }); return; }
        send(ws, { t: 'admin_ok', targets: room.adminTargets() });
        return;
      }

      if (msg.cmd === 'lock' || msg.cmd === 'heal' || msg.cmd === 'give') {
        if (!room) { send(ws, { t: 'err', msg: '请先进入房间' }); return; }
        const target = [...room.peers.values()].find((p) => p.id === String(msg.target || ''));
        if (!target) { send(ws, { t: 'err', msg: '目标玩家不存在' }); return; }
        if (msg.cmd === 'lock') {
          const duration = Math.max(1000, Math.min(10000, Number(msg.duration) || 1000));
          target.lockedUntil = Date.now() + duration;
          room.broadcast({ t: 'admin_effect', effect: 'lock', id: target.id, duration, by: ws._peer.id });
          adminLog(`lock ${target.name} ${duration}ms in ${room.code} by ${ws._peer.name}`);
        } else if (msg.cmd === 'heal') {
          target.hp = 20;
          target.deadUntil = 0;
          room.broadcast({ t: 'admin_effect', effect: 'heal', id: target.id, hp: 20, by: ws._peer.id });
          adminLog(`heal ${target.name} in ${room.code} by ${ws._peer.name}`);
        } else {
          const typeId = Math.max(0, Math.min(200, Number(msg.typeId) | 0));
          const count = Math.max(1, Math.min(64, Number(msg.count) | 0 || 1));
          room.broadcast({ t: 'admin_effect', effect: 'give', id: target.id, typeId, count, by: ws._peer.id });
          adminLog(`give ${target.name} type=${typeId} x${count} in ${room.code} by ${ws._peer.name}`);
        }
        send(ws, { t: 'admin_ok', targets: room.adminTargets() });
        return;
      }

      if (msg.cmd === 'op_list') {
        if (role !== 'owner') {
          send(ws, { t: 'err', msg: '仅站长可查看' });
          return;
        }
        send(ws, { t: 'admin_ok', admins: publicAdmins() });
        return;
      }

      if (msg.cmd === 'op_grant') {
        if (role !== 'owner') {
          send(ws, { t: 'err', msg: '仅站长可授权' });
          return;
        }
        const name = String(msg.name || '').trim().slice(0, 12);
        if (!name) {
          send(ws, { t: 'err', msg: '昵称无效' });
          return;
        }
        const data = loadAdmins();
        data.admins = data.admins || [];
        let row = data.admins.find((a) => a.name === name);
        if (!row) {
          row = { name, token: genToken(), role: 'admin', at: Date.now() };
          data.admins.push(row);
        } else {
          row.token = row.token || genToken();
        }
        saveAdmins(data);
        adminLog(`OP grant ${name} token=${row.token.slice(0, 8)}`);
        send(ws, { t: 'admin_ok', admins: publicAdmins(), granted: row });
        return;
      }

      if (msg.cmd === 'op_revoke') {
        if (role !== 'owner') {
          send(ws, { t: 'err', msg: '仅站长可收回' });
          return;
        }
        const name = String(msg.name || '').trim();
        const data = loadAdmins();
        data.admins = (data.admins || []).filter((a) => a.name !== name);
        saveAdmins(data);
        adminLog(`OP revoke ${name}`);
        send(ws, { t: 'admin_ok', admins: publicAdmins() });
        return;
      }

      if (msg.cmd === 'catalog_add') {
        const entry = msg.entry;
        if (!entry || !entry.id || !entry.label) {
          send(ws, { t: 'err', msg: '条目无效' });
          return;
        }
        const cat = loadCatalog();
        cat.mobs = cat.mobs || [];
        const i = cat.mobs.findIndex((m) => m.id === entry.id);
        if (i >= 0) cat.mobs[i] = entry;
        else cat.mobs.push(entry);
        saveCatalog(cat);
        adminLog(`catalog add ${entry.id}`);
        send(ws, { t: 'admin_ok', catalog: cat });
        return;
      }

      if (msg.cmd === 'spawn') {
        const peer = ws._peer;
        const room = peer?.room;
        if (!room) {
          send(ws, { t: 'admin_ok', note: 'local_only' });
          return;
        }
        const allowed = new Set(['pig','cow','chicken','duck','deer','horse','donkey','scout','heavy','dragon']);
        const catalog = loadCatalog();
        for (const item of catalog.mobs || []) if (item.kind) allowed.add(String(item.kind));
        const kind = String(msg.kind || 'pig');
        if (!allowed.has(kind)) { send(ws, { t: 'err', msg: '不支持的实体类型' }); return; }
        const count = Math.max(1, Math.min(8, Number(msg.count) | 0 || 1));
        // 在房内广播，让各客户端本地刷一只（位置用发起者坐标）
        room.broadcast({ t: 'admin_spawn', kind, count, x: peer.x, y: peer.y, z: peer.z, by: peer.id });
        adminLog(`spawn ${kind} x${count} in ${room.code} by ${peer.name}`);
        send(ws, { t: 'admin_ok', ok: true, targets: room.adminTargets() });
        return;
      }

      send(ws, { t: 'err', msg: `未知指令 ${msg.cmd}` });
      return;
    }

    if (msg.t === 'create') {
      if (rooms.size >= MAX_ROOMS) {
        send(ws, { t: 'err', msg: '服务器房间已满，稍后再试' });
        return;
      }
      const code = findFreeCode();
      if (!code) {
        send(ws, { t: 'err', msg: '无法分配房间码' });
        return;
      }
      const name = String(msg.name || '玩家').slice(0, 12);
      const title = String(msg.title || `${name} 的世界`).slice(0, 24);
      const room = new Room(code, title, name);
      room.applyEditsArray(msg.edits);
      rooms.set(code, room);
      console.log(`[mc-ws] create ${code} "${title}" by ${name}`);
      joinRoom(ws, room, name);
      schedulePersist();
      return;
    }

    if (msg.t === 'join') {
      const code = String(msg.room || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        send(ws, { t: 'err', msg: '房间不存在或已关闭' });
        return;
      }
      joinRoom(ws, room, msg.name);
      return;
    }

    const peer = ws._peer;
    if (!peer || !peer.room) {
      send(ws, { t: 'err', msg: '请先加入房间' });
      return;
    }
    const room = peer.room;

    if (msg.t === 'sync') {
      send(ws, room.snapshotFor(ws));
      return;
    }

    if (msg.t === 'play') {
      peer.active = true;
      send(ws, {t:'vitals',hp:peer.hp});
      send(ws, {t:'boss',boss:room.boss.snapshot()});
      return;
    }
    if (msg.t === 'respawn') {
      if (peer.hp > 0) return;
      Object.assign(peer, room.collision.spawn());
      peer.hp=20; peer.invuln=3; peer.dimension='overworld'; peer.active=true;
      peer.manualRespawn=false; peer.deadUntil=0; peer.protectedUntil=Date.now()+3000;
      send(ws,{t:'respawned',...room.peerState(peer)});
      room.broadcast({t:'combat',...combat.state(peer),respawn:true});
      return;
    }
    if (msg.t === 'player_hurt') {
      // Fall damage remains client-side like the existing voxel physics.
      // Reports can only reduce HP; never accept a client-side heal here.
      if (Number.isFinite(msg.hp)) peer.hp=Math.max(0,Math.min(peer.hp,msg.hp));
      send(ws,{t:'vitals',hp:peer.hp});
      return;
    }
    if (msg.t === 'eat') {
      // Inventory is still client-owned in the original protocol.
      // Restrict this command to known food amounts and a consumption cadence.
      const now=Date.now();
      const heal=getFoodHeal(msg.item);
      if(peer.active&&peer.hp>0&&heal&&now-(peer.lastEat||0)>500){peer.lastEat=now;peer.hp=Math.min(20,peer.hp+heal);}
      send(ws,{t:'vitals',hp:peer.hp});
      return;
    }
    if (msg.t === 'mode') {
      if (peer.hp > 0 && ['build', 'ak', 'mage'].includes(msg.mode)) peer.mode = msg.mode;
      return;
    }
    if (msg.t === 'fireball') {
      const ball = room.spells.cast(peer, msg, Date.now());
      if (ball) room.broadcast(ball);
      return;
    }
    if (msg.t === 'blink') {
      if (room.spells.blink(peer, msg, Date.now())) {
        room.broadcast({
          t: 'combat',
          ...combat.state(peer),
          teleport: true,
          nextBlink: peer.nextBlink || 0,
        });
      } else {
        send(ws, { t: 'blink_fail', nextBlink: peer.nextBlink || 0 });
      }
      return;
    }
    if (msg.t === 'shoot') {
      if (peer.mode !== 'ak') return;
      const bossDistance = room.boss.rayDistance(peer, msg);
      const shot = combat.shoot(peer, room.peers.values(),
        Number.isFinite(bossDistance) ? {...msg, distance: Math.min(msg.distance,bossDistance)} : msg, Date.now());

      if (!shot) return;
      if (Number.isFinite(bossDistance) && !shot.target && shot.distance >= bossDistance) {
        room.boss.combat.takeDamage(5); room.touch();
        room.broadcast({t:'boss',boss:room.boss.snapshot()});
      }
      room.broadcast({ t: 'shot', by: peer.id, dimension: peer.dimension,
        origin: shot.origin, direction: shot.direction, distance: shot.distance });
      if (shot.target) {
        room.broadcast({
          t: 'combat',
          ...combat.state(shot.target),
          by: peer.id,
          ...(shot.knock || {}),
        });
      }
      return;
    }
    // Environmental damage remains client simulated, as in the original game.
    if (msg.t === 'vitals') {
      const delta = Number(msg.delta);
      if (!Number.isFinite(delta) || peer.hp <= 0) return;
      if (delta < 0) combat.hurt(peer, Math.min(20, -delta), Date.now());
      else peer.hp = Math.min(20, peer.hp + Math.min(20, delta));
      room.broadcast({ t: 'combat', ...combat.state(peer) });
      return;
    }
    if (peer.hp <= 0) return;
    if (msg.t === 'hit') {
      if (msg.id === 'mist-boss') {
        if (room.boss.hit(peer)) {
          room.touch();
          room.broadcast({t:'boss',boss:room.boss.snapshot()});
        }
        return;
      }
      const result = room.hitMob(String(msg.id || ''), msg.dmg | 0 || 3, peer.id);
      if (!result) return;
      if (result.die) {
        const drops = buildMobDrops(result.mob.kind);
        room.broadcast({
          t: 'mob_die',
          id: result.mob.id,
          by: peer.id,
          kind: result.mob.kind,
          drops,
        });
      } else {
        room.broadcast({ t: 'mob', ...result.mob });
      }
      return;
    }

    if (msg.t === 'block') {
      const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0, b = msg.b | 0;
      if (y < 0 || y >= 48) return;
      if (!room.setBlock(x, y, z, b)) {
        send(ws, { t: 'err', msg: '改动过多，无法继续同步' });
        return;
      }
      room.broadcast({ t: 'block', x, y, z, b, by: peer.id }, ws);
      return;
    }

    if (msg.t === 'move') {
      const now = Date.now();
      if (peer.lockedUntil > now) {
        send(ws, { t: 'admin_effect', effect: 'lock', id: peer.id, duration: peer.lockedUntil - now });
        return;
      }
      if (now - peer.lastMove < MOVE_MIN_MS) return;
      peer.lastMove = now;
      if (!['x','y','z','yaw','pitch'].every(k=>Number.isFinite(msg[k]))) return;
      if (Math.abs(msg.x)>4096||Math.abs(msg.z)>4096||msg.y < -128||msg.y>256) return;
      peer.dimension = ['overworld','nether','end'].includes(msg.dimension) ? msg.dimension : 'overworld';
      peer.x = +msg.x || 0;
      peer.y = +msg.y || 0;
      peer.z = +msg.z || 0;
      peer.yaw = +msg.yaw || 0;
      peer.pitch = +msg.pitch || 0;
      room.touch();
      room.broadcast({
        t: 'move', ...combat.state(peer),
        x: peer.x, y: peer.y, z: peer.z, yaw: peer.yaw, pitch: peer.pitch,
      }, ws);
      return;
    }

    if (msg.t === 'name') {
      peer.name = String(msg.name || peer.name).slice(0, 12);
      if (peer.isHost) room.hostName = peer.name;
      room.broadcast({
        t: 'peer', id: peer.id, name: peer.name, color: peer.color, host: !!peer.isHost,
        x: peer.x, y: peer.y, z: peer.z, yaw: peer.yaw, pitch: peer.pitch,
      }, ws);
      schedulePersist();
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [code, room] of rooms) {
    if (room.peers.size === 0 && room.emptyAt && now - room.emptyAt > EMPTY_GRACE_MS) {
      rooms.delete(code);
      changed = true;
      console.log(`[mc-ws] GC room ${code}`);
    }
  }
  if (changed) schedulePersist();
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.ping(); } catch { /* */ }
    }
  }
}, 15_000);

// 生物 AI + 位置广播（约 5Hz）
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.peers.size === 0) continue;
    for (const peer of room.peers.values()) {
      if (!peer.manualRespawn && combat.respawn(peer, Date.now())) room.broadcast({ t: 'combat', ...combat.state(peer), respawn: true });
    }
    room.spells.tick(room.peers.values(), Date.now(), msg => room.broadcast(msg));
    room.tickMobs(0.2);
    room.broadcast({ t: 'mobs', list: room.mobsArray() });
  }
}, 200);

// Boss authority at 20 Hz; animation/position snapshots at 5 Hz.
let bossTick = 0;
setInterval(() => {
  bossTick++;
  for (const room of rooms.values()) {
    if (!room.peers.size) continue;
    const events=room.boss.tick(.05,[...room.peers.values()]);
    for (const event of events) {
      for (const [ws,peer] of room.peers) if (peer.id===event.id) {
        send(ws,{t:'vitals',...event});
        room.broadcast({t:'combat',...combat.state(peer),cause:'mist-boss'});
      }
    }
    if (bossTick%4===0) room.broadcast({t:'boss',boss:room.boss.snapshot()});
  }
},50);

process.on('SIGINT' , () => { persistNow(); process.exit(0); });
process.on('SIGTERM', () => { persistNow(); process.exit(0); });

server.listen(PORT, HOST, () => {
  console.log(`[mc-ws] http://${HOST}:${PORT}/api/rooms  ws://${HOST}:${PORT}/ws`);
  console.log(`[mc-ws] persist → ${PERSIST_PATH}`);
});

function selfCheck() {
  const r = new Room('TEST', '自检房', 'Host');
  r.setBlock(1, 2, 3, 4);
  console.assert(r.editsArray()[3] === 4, 'edits');
  console.assert(genCode().length === 4, 'code');
  console.assert(Array.isArray(listPublicRooms()), 'list');
  console.assert(r.snapshotFor(null).t === 'sync', 'sync');
  console.log('[mc-ws] self-check ok');
}
selfCheck();

}
main().catch(error => { console.error('[mc-ws] startup failed', error); process.exit(1); });
