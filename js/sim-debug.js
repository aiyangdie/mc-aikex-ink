/**
 * Client-only world-sim debug overlay (F3). Uses three.js for helpers.
 */
import * as THREE from 'three';

export class SimDebug {
  constructor(scene) {
    this.scene = scene;
    this.enabled = false;
    this.group = new THREE.Group();
    this.group.name = 'simDebug';
    this.scene.add(this.group);
    this._boxMat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
    this._pathMat = new THREE.LineBasicMaterial({ color: 0xffcc00 });
    this._hud = null;
    this._ensureHud();
  }

  _ensureHud() {
    if (this._hud) return;
    const el = document.createElement('div');
    el.id = 'simDebugHud';
    el.style.cssText =
      'display:none;position:fixed;left:8px;bottom:8px;z-index:40;' +
      'background:rgba(0,0,0,.65);color:#9f9;font:12px/1.4 monospace;' +
      'padding:8px 10px;border-radius:4px;pointer-events:none;max-width:360px;';
    document.body.appendChild(el);
    this._hud = el;
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.group.visible = this.enabled;
    if (this._hud) this._hud.style.display = this.enabled ? 'block' : 'none';
    if (!this.enabled) this.clear();
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  clear() {
    while (this.group.children.length) {
      const c = this.group.children.pop();
      c.geometry?.dispose?.();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose?.();
      }
    }
    if (this._hud) this._hud.textContent = '';
  }

  _wireBox(w, h, d) {
    const hw = w / 2;
    const pts = [
      [-hw, 0, -hw], [hw, 0, -hw], [hw, 0, hw], [-hw, 0, hw], [-hw, 0, -hw],
      [-hw, h, -hw], [hw, h, -hw], [hw, h, hw], [-hw, h, hw], [-hw, h, -hw],
      [hw, h, -hw], [hw, 0, -hw], [hw, 0, hw], [hw, h, hw], [-hw, h, hw], [-hw, 0, hw],
    ];
    const arr = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      arr[i * 3] = pts[i][0];
      arr[i * 3 + 1] = pts[i][1];
      arr[i * 3 + 2] = pts[i][2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return new THREE.Line(geo, this._boxMat);
  }

  /**
   * @param {object[]} mobs Critter-like: position, collisionWidth/Height, state?, stuckTime?, _brain?
   * @param {{x,y,z}} playerPos
   * @param {object|null} boss optional mist boss
   */
  update(mobs, playerPos, boss = null) {
    if (!this.enabled) return;
    this.clear();
    this.group.visible = true;

    let nearest = null;
    let best = Infinity;
    const list = [...(mobs || [])];
    if (boss && !boss.dead && boss.position) list.push(boss);

    for (const m of list) {
      if (m.dead) continue;
      const p = m.position;
      if (!p) continue;
      const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      if (d < best) {
        best = d;
        nearest = m;
      }
    }
    if (!nearest) {
      if (this._hud) this._hud.textContent = 'simDebug: no mob nearby';
      return;
    }

    const p = nearest.position;
    const w = nearest.collisionWidth || 0.9;
    const h = nearest.collisionHeight || (nearest.kind === 'mist-boss' ? 2.1 : 1);
    const box = this._wireBox(w, h, w);
    box.position.set(p.x, p.y, p.z);
    this.group.add(box);

    const brain = nearest._brain;
    const path = brain?.path || nearest._navPath || [];
    if (path.length) {
      const pts = [new THREE.Vector3(p.x, p.y + 0.2, p.z)];
      for (const n of path) pts.push(new THREE.Vector3(n.x, n.y + 0.2, n.z));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.group.add(new THREE.Line(geo, this._pathMat));
    }

    const state = nearest.state || brain?.state || nearest.combat?.state || '?';
    const stuck = brain?.stuckTime ?? nearest._stuckTime ?? 0;
    const standY = p.y;
    const goal = brain?.goal;
    if (this._hud) {
      this._hud.innerHTML =
        `<b>simDebug F3</b><br>` +
        `id: ${nearest.id || nearest.kind || '?'}  state: ${state}<br>` +
        `pos: ${p.x.toFixed(2)}, ${standY.toFixed(2)}, ${p.z.toFixed(2)}  standY: ${standY.toFixed(2)}<br>` +
        `stuck: ${stuck.toFixed(2)}s  path: ${path.length}` +
        (goal ? `<br>goal: ${goal.x.toFixed(1)}, ${goal.z.toFixed(1)}` : '');
    }
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
    this._boxMat.dispose();
    this._pathMat.dispose();
    if (this._hud?.parentNode) this._hud.parentNode.removeChild(this._hud);
    this._hud = null;
  }
}
