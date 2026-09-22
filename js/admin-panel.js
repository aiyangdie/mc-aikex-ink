/**
 * 管理面板：传送 / 给物 / 刷怪 / 飞行 / 授权 / 自定义目录
 * 打开：按 `（反引号）
 */
import { apiUrl } from './config.js?v=groundfix9';

const AUTH_KEY = 'voxel-admin-key';
const AUTH_TOKEN = 'voxel-admin-token';

export class AdminPanel {
  /**
   * @param {object} game Game 实例
   */
  constructor(game) {
    this.game = game;
    this.role = null; // owner | admin | null
    this.catalog = null;
    this.el = null;
    this.open = false;
    this._build();
    this._bindKeys();
    this.reloadCatalog();
  }

  get authed() {
    return this.role === 'owner' || this.role === 'admin' || this.role === 'room-owner';
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'adminPanel';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="admin-card" id="adminCard">
        <header class="admin-head">
          <b>管理面板</b>
          <span id="adminRoleBadge" class="admin-badge">未登录</span>
          <button type="button" class="game-btn tiny" id="adminClose">关闭</button>
        </header>

        <section class="admin-sec" id="adminLoginSec">
          <label>站长密钥 / 管理员令牌</label>
          <div class="admin-row">
            <input type="password" id="adminKeyInput" class="online-input" placeholder="MC_OWNER_KEY 或 token" autocomplete="off" />
            <button type="button" class="game-btn primary" id="adminLoginBtn">登录</button>
          </div>
          <p class="admin-hint">按 \` 开关面板 · 单机密钥即可；联机需服务端校验</p>
        </section>

        <div id="adminBody" style="display:none">
          <section class="admin-sec">
            <h3>传送</h3>
            <div class="admin-row">
              <input type="number" id="adminX" class="online-input tiny-num" placeholder="X" step="1" />
              <input type="number" id="adminY" class="online-input tiny-num" placeholder="Y" step="1" />
              <input type="number" id="adminZ" class="online-input tiny-num" placeholder="Z" step="1" />
              <select id="adminDim" class="online-input">
                <option value="overworld">主世界</option>
                <option value="nether">地狱</option>
                <option value="end">末地</option>
              </select>
              <button type="button" class="game-btn primary" id="adminTpBtn">传送</button>
            </div>
            <div class="admin-row wrap">
              <button type="button" class="game-btn tiny" data-preset="spawn">出生点</button>
              <button type="button" class="game-btn tiny" data-preset="portal">地狱门</button>
              <button type="button" class="game-btn tiny" data-preset="nether">地狱中央</button>
              <button type="button" class="game-btn tiny" data-preset="end">末地中心</button>
              <button type="button" class="game-btn tiny" id="adminHereBtn">填当前坐标</button>
            </div>
          </section>

          <section class="admin-sec">
            <h3>给物 / 状态</h3>
            <div class="admin-row">
              <select id="adminItem" class="online-input"></select>
              <input type="number" id="adminItemCount" class="online-input tiny-num" value="16" min="1" max="64" />
              <button type="button" class="game-btn" id="adminGiveBtn">给予</button>
              <button type="button" class="game-btn" id="adminHealBtn">满血</button>
              <button type="button" class="game-btn" id="adminFlyBtn">飞行开关</button>
            </div>
          </section>

          <section class="admin-sec" id="adminRoomSec">
            <h3>房间管理</h3>
            <div class="admin-row">
              <select id="adminTarget" class="online-input">
                <option value="">选择玩家</option>
              </select>
              <button type="button" class="game-btn primary" id="adminLock1Btn">锁定 1 秒</button>
              <button type="button" class="game-btn" id="adminLock5Btn">锁定 5 秒</button>
            </div>
            <div class="admin-row">
              <button type="button" class="game-btn" id="adminGiveTargetBtn">赠送上方道具</button>
              <button type="button" class="game-btn" id="adminHealTargetBtn">目标满血</button>
              <button type="button" class="game-btn tiny ghost" id="adminRefreshTargetsBtn">刷新玩家</button>
            </div>
            <div id="adminTargetHint" class="admin-hint">房主可以管理当前房间玩家，所有操作由服务器校验。</div>
          </section>

          <section class="admin-sec">
            <h3>刷实体 / 结构</h3>
            <div class="admin-row">
              <select id="adminMob" class="online-input"></select>
              <input type="number" id="adminMobCount" class="online-input tiny-num" value="1" min="1" max="8" />
              <button type="button" class="game-btn primary" id="adminSpawnBtn">准星处生成</button>
            </div>
            <div class="admin-row">
              <select id="adminStruct" class="online-input"></select>
              <button type="button" class="game-btn" id="adminStructBtn">脚下生成结构</button>
              <button type="button" class="game-btn" id="adminClearMobsBtn">清空附近生物</button>
            </div>
          </section>

          <section class="admin-sec" id="adminCatalogSec">
            <h3>自定义内容（写入目录）</h3>
            <div class="admin-row wrap">
              <input type="text" id="catId" class="online-input" placeholder="id 如 wolf" maxlength="24" />
              <input type="text" id="catLabel" class="online-input" placeholder="显示名" maxlength="24" />
              <select id="catKind" class="online-input">
                <option value="pig">基于猪</option>
                <option value="cow">基于牛</option>
                <option value="chicken">基于鸡</option>
                <option value="deer">基于鹿</option>
                <option value="horse">基于马</option>
                <option value="scout">基于地狱机</option>
                <option value="dragon">基于龙</option>
              </select>
              <button type="button" class="game-btn" id="adminCatAddBtn">添加到目录</button>
            </div>
            <p class="admin-hint">自定义 = 配置驱动现有模型；不支持上传模型</p>
          </section>

          <section class="admin-sec" id="adminOpSec">
            <h3>权限（仅站长）</h3>
            <div class="admin-row">
              <input type="text" id="adminOpName" class="online-input" placeholder="玩家昵称" maxlength="12" />
              <button type="button" class="game-btn primary" id="adminOpGrantBtn">设为管理员</button>
              <button type="button" class="game-btn" id="adminOpRevokeBtn">收回</button>
            </div>
            <div id="adminOpList" class="admin-op-list"></div>
            <div id="adminPeerList" class="admin-op-list"></div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    this.el = el;

    el.querySelector('#adminClose').onclick = () => this.setOpen(false);
    el.querySelector('#adminLoginBtn').onclick = () => this.login();
    el.querySelector('#adminTpBtn').onclick = () => this.doTp();
    el.querySelector('#adminHereBtn').onclick = () => this.fillHere();
    el.querySelector('#adminGiveBtn').onclick = () => this.doGive();
    el.querySelector('#adminGiveTargetBtn').onclick = () => this.doTargetGive();
    el.querySelector('#adminHealTargetBtn').onclick = () => this.doTargetCommand('heal');
    el.querySelector('#adminLock1Btn').onclick = () => this.doTargetCommand('lock', 1000);
    el.querySelector('#adminLock5Btn').onclick = () => this.doTargetCommand('lock', 5000);
    el.querySelector('#adminRefreshTargetsBtn').onclick = () => this.refreshTargets();
    el.querySelector('#adminHealBtn').onclick = () => this.game.adminHeal?.();
    el.querySelector('#adminFlyBtn').onclick = () => this.game.adminToggleFly?.();
    el.querySelector('#adminSpawnBtn').onclick = () => this.doSpawn();
    el.querySelector('#adminStructBtn').onclick = () => this.doStruct();
    el.querySelector('#adminClearMobsBtn').onclick = () => this.game.adminClearMobs?.();
    el.querySelector('#adminCatAddBtn').onclick = () => this.doCatalogAdd();
    el.querySelector('#adminOpGrantBtn').onclick = () => this.doOp(true);
    el.querySelector('#adminOpRevokeBtn').onclick = () => this.doOp(false);

    el.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = () => this.doPreset(btn.dataset.preset);
    });

    // 阻止面板内按键影响游戏
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Backquote') return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
        if (!this.open) return;
      }
      e.preventDefault();
      this.setOpen(!this.open);
    });
  }

  setOpen(v) {
    this.open = !!v;
    this.el.style.display = this.open ? 'flex' : 'none';
    if (this.open) {
      this.fillHere();
      this.refreshOpList();
      this.refreshTargets();
      // 打开时解除指针锁以便操作面板
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  async reloadCatalog() {
    try {
      const r = await fetch(apiUrl(`/api/catalog?t=${Date.now()}`), { cache: 'no-store' });
      if (r.ok) this.catalog = await r.json();
    } catch { /* */ }
    if (!this.catalog) {
      this.catalog = {
        mobs: [
          { id: 'pig', label: '猪', kind: 'pig' },
          { id: 'dragon', label: '末影龙', kind: 'dragon' },
        ],
        items: [
          { id: 'dirt', label: '泥土', typeId: 2 },
          { id: 'obsidian', label: '黑曜石', typeId: 11 },
        ],
        structures: [
          { id: 'nether_portal', label: '地狱门' },
          { id: 'cabin', label: '小木屋' },
        ],
      };
    }
    this._fillSelects();
  }

  _fillSelects() {
    const mobSel = this.el.querySelector('#adminMob');
    const itemSel = this.el.querySelector('#adminItem');
    const stSel = this.el.querySelector('#adminStruct');
    mobSel.innerHTML = (this.catalog.mobs || []).map((m) =>
      `<option value="${m.kind || m.id}">${m.label || m.id}</option>`).join('');
    itemSel.innerHTML = (this.catalog.items || []).map((m) =>
      `<option value="${m.typeId}">${m.label || m.id}</option>`).join('');
    stSel.innerHTML = (this.catalog.structures || []).map((m) =>
      `<option value="${m.id}">${m.label || m.id}</option>`).join('');
  }

  async login() {
    const key = (this.el.querySelector('#adminKeyInput').value || '').trim();
    if (!key) {
      this.game._showSaveToast?.('请输入密钥');
      return;
    }
    try { localStorage.setItem(AUTH_KEY, key); } catch { /* */ }

    // 一律向服务器鉴权；失败则拒绝（不再默认 owner）
    const net = this.game.net;
    if (!net) {
      this.game._showSaveToast?.('网络模块不可用');
      return;
    }
    let role = null;
    try {
      await net.connect();
      const res = await net.adminAuth(key, this.game._playerName?.() || '');
      role = res.role || null;
      if (!role) {
        this.role = null;
        this._setAuthedUI();
        this.game._showSaveToast?.('密钥无效');
        return;
      }
      if (res.token) {
        try { localStorage.setItem(AUTH_TOKEN, res.token); } catch { /* */ }
      }
      this.refreshOpList(res.admins);
    } catch (err) {
      console.warn('[admin] auth fail', err);
      this.role = null;
      this._setAuthedUI();
      this.game._showSaveToast?.('鉴权失败，请检查密钥与网络');
      return;
    }
    this.role = role;
    this._setAuthedUI();
    this.game._showSaveToast?.(`已登录：${role}`);
  }

  async autoRoomOwner() {
    if (this.authed || !this.game._online || !this.game.net) return;
    try {
      const res = await this.game.net.adminAuth('room-owner', this.game._playerName?.() || '');
      if (res?.role !== 'room-owner') return;
      this.role = res.role;
      this._setAuthedUI();
      this.refreshTargets(res.targets);
      this.game._showSaveToast?.('你是本房房主，管理权限已开启（按 `）');
    } catch { /* 普通加入者不应看到鉴权错误 */ }
  }

  tryAutoLogin() {
    try {
      const key = localStorage.getItem(AUTH_KEY);
      if (key) {
        this.el.querySelector('#adminKeyInput').value = key;
      }
    } catch { /* */ }
  }

  _setAuthedUI() {
    const badge = this.el.querySelector('#adminRoleBadge');
    const body = this.el.querySelector('#adminBody');
    const opSec = this.el.querySelector('#adminOpSec');
    const catSec = this.el.querySelector('#adminCatalogSec');
    if (this.authed) {
      badge.textContent = this.role;
      badge.className = 'admin-badge ok';
      body.style.display = 'block';
      opSec.style.display = this.role === 'owner' ? 'block' : 'none';
      this.el.querySelector('#adminRoomSec').style.display = this.role === 'room-owner' ? 'block' : 'none';
      catSec.style.display = this.role === 'owner' || this.role === 'admin' ? 'block' : 'none';
    } else {
      badge.textContent = '未登录';
      badge.className = 'admin-badge';
      body.style.display = 'none';
      this.el.querySelector('#adminRoomSec').style.display = 'none';
    }
  }

  fillHere() {
    const p = this.game.player?.position;
    if (!p) return;
    this.el.querySelector('#adminX').value = p.x.toFixed(1);
    this.el.querySelector('#adminY').value = p.y.toFixed(1);
    this.el.querySelector('#adminZ').value = p.z.toFixed(1);
    this.el.querySelector('#adminDim').value = this.game.dimension || 'overworld';
  }

  doTp() {
    if (!this.authed) return;
    const x = +this.el.querySelector('#adminX').value;
    const y = +this.el.querySelector('#adminY').value;
    const z = +this.el.querySelector('#adminZ').value;
    const dim = this.el.querySelector('#adminDim').value;
    this.game.adminTeleport?.(x, y, z, dim);
  }

  doPreset(name) {
    if (!this.authed) return;
    const map = {
      spawn: { x: 7.5, y: 19, z: 8.5, dim: 'overworld' },
      portal: { x: 7.5, y: 19, z: 5.5, dim: 'overworld' },
      nether: { x: 21.5, y: 15, z: 9.5, dim: 'nether' },
      end: { x: 0, y: 24, z: 0, dim: 'end' },
    };
    const p = map[name];
    if (!p) return;
    this.el.querySelector('#adminX').value = p.x;
    this.el.querySelector('#adminY').value = p.y;
    this.el.querySelector('#adminZ').value = p.z;
    this.el.querySelector('#adminDim').value = p.dim;
    this.game.adminTeleport?.(p.x, p.y, p.z, p.dim);
  }

  doGive() {
    if (!this.authed) return;
    const typeId = +this.el.querySelector('#adminItem').value;
    const n = Math.max(1, Math.min(64, +this.el.querySelector('#adminItemCount').value || 1));
    this.game.adminGive?.(typeId, n);
  }

  async doTargetCommand(cmd, duration = 0) {
    if (this.role !== 'room-owner') return;
    const target = this.el.querySelector('#adminTarget').value;
    if (!target) { this.game._showSaveToast?.('先选择玩家'); return; }
    try {
      const res = await this.game.net.adminCmd({ cmd, target, duration });
      this.refreshTargets(res?.targets);
      this.game._showSaveToast?.(cmd === 'lock' ? '已锁定玩家' : '已为玩家满血');
    } catch (err) { this.game._showSaveToast?.(err.message || String(err)); }
  }

  async doTargetGive() {
    if (this.role !== 'room-owner') return;
    const target = this.el.querySelector('#adminTarget').value;
    const typeId = +this.el.querySelector('#adminItem').value;
    const count = Math.max(1, Math.min(64, +this.el.querySelector('#adminItemCount').value || 1));
    if (!target) { this.game._showSaveToast?.('先选择玩家'); return; }
    try {
      const res = await this.game.net.adminCmd({ cmd: 'give', target, typeId, count });
      this.refreshTargets(res?.targets);
      this.game._showSaveToast?.('道具已送达');
    } catch (err) { this.game._showSaveToast?.(err.message || String(err)); }
  }

  async refreshTargets(targets) {
    if (this.role !== 'room-owner' || !this.game.net?.room) return;
    try {
      if (!targets) {
        const res = await this.game.net.adminCmd({ cmd: 'targets' });
        targets = res?.targets;
      }
      const select = this.el.querySelector('#adminTarget');
      const old = select.value;
      select.innerHTML = '<option value="">选择玩家</option>';
      for (const p of targets || []) {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.name}${p.host ? ' · 房主' : ''} · HP ${p.hp}`;
        select.appendChild(option);
      }
      if ([...select.options].some((o) => o.value === old)) select.value = old;
    } catch { /* 房间尚未进入游戏 */ }
  }

  doSpawn() {
    if (!this.authed) return;
    const kind = this.el.querySelector('#adminMob').value;
    const count = Math.max(1, Math.min(8, +this.el.querySelector('#adminMobCount').value || 1));
    this.game.adminSpawn?.(kind, count);
    if (this.game._online && this.game.net?.room) {
      this.game.net.adminCmd?.({ cmd: 'spawn', kind, count });
    }
  }

  doStruct() {
    if (!this.authed) return;
    const id = this.el.querySelector('#adminStruct').value;
    this.game.adminBuild?.(id);
  }

  async doCatalogAdd() {
    if (!this.authed) return;
    const id = (this.el.querySelector('#catId').value || '').trim().slice(0, 24);
    const label = (this.el.querySelector('#catLabel').value || '').trim().slice(0, 24);
    const kind = this.el.querySelector('#catKind').value;
    if (!id || !label) {
      this.game._showSaveToast?.('填写 id 与名称');
      return;
    }
    const entry = { id, label, kind, type: kind === 'dragon' ? 'boss' : 'mob' };
    try {
      await this.game.net?.connect?.();
      const key = localStorage.getItem(AUTH_KEY) || '';
      const res = await this.game.net.adminCmd({ cmd: 'catalog_add', entry, key });
      if (res?.catalog) this.catalog = res.catalog;
      else {
        this.catalog.mobs = this.catalog.mobs || [];
        this.catalog.mobs.push(entry);
      }
      this._fillSelects();
      this.game._showSaveToast?.(`已添加 ${label}`);
    } catch (err) {
      // 单机本地追加
      this.catalog.mobs = this.catalog.mobs || [];
      if (!this.catalog.mobs.find((m) => m.id === id)) this.catalog.mobs.push(entry);
      this._fillSelects();
      this.game._showSaveToast?.(`本地已添加 ${label}（联机需服务端）`);
    }
  }

  async doOp(grant) {
    if (this.role !== 'owner') return;
    const name = (this.el.querySelector('#adminOpName').value || '').trim().slice(0, 12);
    if (!name) return;
    try {
      await this.game.net?.connect?.();
      const key = localStorage.getItem(AUTH_KEY) || '';
      const res = await this.game.net.adminCmd({
        cmd: grant ? 'op_grant' : 'op_revoke',
        name,
        key,
      });
      this.refreshOpList(res?.admins);
      this.game._showSaveToast?.(grant ? `已授权 ${name}` : `已收回 ${name}`);
    } catch (err) {
      this.game._showSaveToast?.(err.message || String(err));
    }
  }

  async refreshOpList(admins) {
    const box = this.el.querySelector('#adminOpList');
    const peers = this.el.querySelector('#adminPeerList');
    if (admins) {
      box.innerHTML = '<b>全局管理员</b><br>' + (admins.length
        ? admins.map((a) => `${a.name} <code>${(a.token || '').slice(0, 8)}…</code>`).join('<br>')
        : '（空）');
    } else if (this.role === 'owner') {
      try {
        const key = localStorage.getItem(AUTH_KEY) || '';
        await this.game.net?.connect?.();
        const res = await this.game.net.adminCmd({ cmd: 'op_list', key });
        this.refreshOpList(res?.admins || []);
      } catch { box.innerHTML = ''; }
    }
    // 当前房间成员快捷填入
    const names = [];
    if (this.game.remotes?.map) {
      for (const e of this.game.remotes.map.values()) {
        if (e.label?.textContent) names.push(e.label.textContent);
      }
    }
    peers.innerHTML = names.length
      ? '<b>房间内</b><br>' + names.map((n) =>
        `<button type="button" class="game-btn tiny peer-fill" data-name="${n}">${n}</button>`).join(' ')
      : '';
    peers.querySelectorAll('.peer-fill').forEach((b) => {
      b.onclick = () => { this.el.querySelector('#adminOpName').value = b.dataset.name; };
    });
  }
}
