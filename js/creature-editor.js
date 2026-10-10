import { apiUrl } from './config.js';
import {
  createDefaultCreatureBlueprint,
  normalizeCreatureBlueprint,
  CREATURE_PART_TYPES,
  CREATURE_BEHAVIORS,
  CREATURE_SKILLS,
} from './creature-blueprint.js';

const TOKEN_KEY = 'voxel-creature-owner-tokens-v1';
const partNames = { body: '躯干', head: '头部', leg: '肢体', tail: '尾部', horn: '角冠' };
const behaviorNames = { wander: '巡游', shy: '受惊逃跑', aggressive: '主动追逐' };
const skillNames = { melee: '近身击打', dash: '冲撞', shield: '短时护盾' };

export class CreatureEditor {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('creatureLab');
    this.blueprint = createDefaultCreatureBlueprint();
    this.templates = [];
    this.currentId = null;
    this.selectedPart = 0;
    this.selectedSkill = 0;
    this.dirty = false;
    this.sessionTokens = {};
    this.opened = false;
    if (!this.root) return;
    this.bind();
    document.getElementById('btnCreatureLab')?.addEventListener('click', () => this.open());
  }

  bind() {
    this.root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.action === 'close') this.close();
      if (button.dataset.action === 'new') this.newBlueprint();
      if (button.dataset.action === 'add-part') this.addPart(button.dataset.part);
      if (button.dataset.action === 'remove-part') this.removePart();
      if (button.dataset.action === 'remove-skill') this.removeSkill();
      if (button.dataset.action === 'save') this.save();
      if (button.dataset.action === 'deploy') this.deploy();
      if (button.dataset.action === 'delete') this.deleteTemplate();
      if (button.dataset.templateId) this.loadTemplate(button.dataset.templateId);
      if (button.dataset.skill) this.toggleSkill(button.dataset.skill);
      if (button.dataset.partIndex != null) {
        this.selectedPart = Number(button.dataset.partIndex);
        this.render();
      }
    });
    this.root.addEventListener('input', event => this.updateField(event.target));
    this.root.addEventListener('change', event => this.updateField(event.target));
  }

  async open() {
    const pausedInGame = this.game.ui.pauseScreen.style.display === 'flex';
    if (!this.root || (!this.game.isRunning && !pausedInGame) || this.game._dead) return;
    this.opened = true;
    this.game._creatureLabOpen = true;
    this.game._fallbackActive = false;
    if (this.game.isMobile) this.game.isRunning = false;
    this.game.player.keys = {};
    if (this.game.combat) this.game.combat.held = false;
    if (this.game._online) this.game.net.sendPause();
    if (document.pointerLockElement === this.game.canvas) document.exitPointerLock();
    this.game.ui.pauseScreen.style.display = 'none';
    this.game._showGameUI(false);
    this.root.hidden = false;
    this.render();
    try {
      const response = await fetch(apiUrl('/api/creatures'), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.templates)) {
        throw new Error(data.error || `模板目录请求失败 (${response.status})`);
      }
      this.templates = data.templates;
      this.renderTemplates();
    } catch (error) {
      this.setStatus(`无法载入服务器模板：${error.message}`);
    }
    this.root.querySelector('[name="creature-name"]')?.focus();
  }

  close() {
    this.opened = false;
    this.game._creatureLabOpen = false;
    this.root.hidden = true;
    this.game.player.keys = {};
    this.game.ui.pauseScreen.style.display = 'flex';
    this.game._showGameUI(false);
  }

  newBlueprint() {
    this.blueprint = createDefaultCreatureBlueprint();
    this.currentId = null;
    this.selectedPart = 0;
    this.dirty = false;
    this.render();
    this.setStatus('新标本已就绪。调整形态后发布为共享模板。');
  }

  addPart(type) {
    if (!CREATURE_PART_TYPES.includes(type) || this.blueprint.parts.length >= 16) return;
    const defaults = {
      body: [0, 0.55, 0, 0.85, 0.62, 0.7],
      head: [0, 1, 0.42, 0.48, 0.45, 0.45],
      leg: [0.28, 0.16, 0, 0.18, 0.36, 0.18],
      tail: [0, 0.48, -0.7, 0.24, 0.18, 0.42],
      horn: [0, 1.35, 0.42, 0.12, 0.38, 0.12],
    }[type];
    const [x, y, z, width, height, depth] = defaults;
    this.blueprint.parts.push({ type, x, y, z, width, height, depth, color: this.blueprint.color });
    this.dirty = true;
    this.selectedPart = this.blueprint.parts.length - 1;
    this.render();
  }

  removePart() {
    if (this.blueprint.parts.length <= 1) return;
    this.blueprint.parts.splice(this.selectedPart, 1);
    this.dirty = true;
    this.selectedPart = Math.max(0, this.selectedPart - 1);
    this.render();
  }

  toggleSkill(type) {
    if (!CREATURE_SKILLS.includes(type)) return;
    const index = this.blueprint.skills.findIndex(skill => skill.type === type);
    if (index >= 0) this.selectedSkill = index;
    else if (this.blueprint.skills.length < 3) {
      this.blueprint.skills.push({ type, range: 2, damage: 2, cooldown: 2 });
      this.selectedSkill = this.blueprint.skills.length - 1;
      this.dirty = true;
    }
    this.render();
  }

  removeSkill() {
    if (!this.blueprint.skills.length) return;
    this.blueprint.skills.splice(this.selectedSkill, 1);
    this.dirty = true;
    this.selectedSkill = Math.max(0, this.selectedSkill - 1);
    this.render();
  }

  updateField(field) {
    if (!field?.name) return;
    const value = field.type === 'number' ? Number(field.value) : field.value;
    if (field.name === 'creature-name') this.blueprint.name = value;
    else if (field.name === 'behavior') this.blueprint.behavior = value;
    else if (field.name === 'color') {
      this.blueprint.color = value.toUpperCase();
      this.blueprint.parts.forEach(part => { if (part.type === 'body') part.color = this.blueprint.color; });
    } else if (field.name.startsWith('body-')) this.blueprint.body[field.name.slice(5)] = value;
    else if (field.name === 'hp') this.blueprint.hp = value;
    else if (field.name === 'speed') this.blueprint.speed = value;
    else if (field.name.startsWith('skill-')) {
      const skill = this.blueprint.skills[this.selectedSkill];
      if (skill) skill[field.name.slice(6)] = value;
    }
    else if (field.name === 'part-color') {
      if (this.blueprint.parts[this.selectedPart]) this.blueprint.parts[this.selectedPart].color = value.toUpperCase();
    }
    else if (field.name.startsWith('part-')) {
      const [, axis] = field.name.split('-');
      if (this.blueprint.parts[this.selectedPart]) this.blueprint.parts[this.selectedPart][axis] = value;
    }
    this.dirty = true;
    this.renderPreview();
  }

  async loadTemplate(id) {
    const template = this.templates.find(row => row.id === id);
    if (!template) return;
    this.currentId = id;
    this.blueprint = structuredClone(template.blueprint);
    this.dirty = false;
    this.selectedPart = 0;
    this.render();
    this.setStatus(`已载入「${this.blueprint.name}」；可调整后另存为新模板。`);
  }

  getTokens() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...parsed, ...this.sessionTokens }
        : { ...this.sessionTokens };
    } catch (error) {
      this.setStatus(`本机管理凭证无法读取；旧模板不可管理，但仍可发布新模板。${error.message}`);
      return { ...this.sessionTokens };
    }
  }

  async save() {
    const validation = normalizeCreatureBlueprint(this.blueprint);
    if (!validation.ok) {
      this.setStatus(validation.error);
      return;
    }
    try {
      const tokens = this.getTokens();
      const token = this.currentId ? tokens[this.currentId] : null;
      const response = await fetch(apiUrl(token ? `/api/creatures/${this.currentId}` : '/api/creatures'), {
        method: token ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(validation.value),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.template) throw new Error(data.error || `保存失败 (${response.status})`);
      if (data.token) {
        this.sessionTokens[data.template.id] = data.token;
        tokens[data.template.id] = data.token;
        try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); }
        catch { this.setStatus('模板已保存，但浏览器无法保存管理凭证；请先勿关闭此页。'); }
      }
      this.currentId = data.template.id;
      this.blueprint = data.template.blueprint;
      this.dirty = false;
      this.templates = [data.template, ...this.templates.filter(row => row.id !== data.template.id)];
      this.render();
      if (!this.root.querySelector('[data-status]').textContent.includes('无法保存管理凭证')) {
        this.setStatus('模板已保存到服务器共享目录。');
      }
    } catch (error) {
      this.setStatus(error.message);
    }
  }

  async deleteTemplate() {
    if (!this.currentId) return;
    try {
      const tokens = this.getTokens();
      const token = tokens[this.currentId];
      if (!token) throw new Error('只有创建者浏览器可以删除此模板');
      const response = await fetch(apiUrl(`/api/creatures/${this.currentId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `删除失败 (${response.status})`);
      delete tokens[this.currentId];
      delete this.sessionTokens[this.currentId];
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); } catch { /* deletion already succeeded on the server */ }
      this.templates = this.templates.filter(row => row.id !== this.currentId);
      this.newBlueprint();
      this.renderTemplates();
      this.setStatus('模板已从服务器目录删除。');
    } catch (error) {
      this.setStatus(error.message);
    }
  }

  deploy() {
    const validation = normalizeCreatureBlueprint(this.blueprint);
    if (!validation.ok) {
      this.setStatus(validation.error);
      return;
    }
    if (!this.currentId) {
      this.setStatus('请先将生物保存为服务器模板，再部署到世界。');
      return;
    }
    if (this.dirty) {
      this.setStatus('模板有未保存的改动；先保存，再部署更新后的版本。');
      return;
    }
    if (this.game._online) {
      this.game.net.sendCreatureSpawn(this.currentId);
      this.setStatus('部署请求已发送，等待房间服务器确认。');
      return;
    }
    const position = this.game.findCreaturePlacement();
    if (!position) {
      this.setStatus('附近没有安全的落脚位置，请移动后重试。');
      return;
    }
    this.game.animalManager.spawnCustom(validation.value, position.x, position.y, position.z);
    this.setStatus(`「${validation.value.name}」已放入当前世界。`);
  }

  renderTemplates() {
    const list = this.root.querySelector('[data-template-list]');
    if (!list) return;
    list.replaceChildren();
    if (!this.templates.length) {
      const empty = document.createElement('p');
      empty.className = 'specimen-empty';
      empty.textContent = '目录里还没有标本。拼好形态后，发布第一份共享模板。';
      list.append(empty);
      return;
    }
    for (const template of this.templates) {
      const row = document.createElement('div');
      row.className = `specimen-row${template.id === this.currentId ? ' selected' : ''}`;
      const load = document.createElement('button');
      load.type = 'button';
      load.dataset.templateId = template.id;
      load.textContent = template.blueprint.name;
      const marker = document.createElement('span');
      marker.className = 'specimen-marker';
      marker.style.backgroundColor = template.blueprint.color;
      row.append(marker, load);
      list.append(row);
    }
  }

  render() {
    const root = this.root;
    root.querySelector('[name="creature-name"]').value = this.blueprint.name;
    root.querySelector('[name="color"]').value = this.blueprint.color;
    root.querySelector('[name="hp"]').value = this.blueprint.hp;
    root.querySelector('[name="speed"]').value = this.blueprint.speed;
    root.querySelector('[name="behavior"]').value = this.blueprint.behavior;
    for (const dimension of ['width', 'height', 'depth']) {
      root.querySelector(`[name="body-${dimension}"]`).value = this.blueprint.body[dimension];
    }
    this.renderParts();
    this.renderSkills();
    this.renderPreview();
    this.renderTemplates();
    let owner = false;
    try { owner = !!this.currentId && !!this.getTokens()[this.currentId]; }
    catch (error) { this.setStatus(error.message); }
    root.querySelector('[data-action="delete"]').hidden = !owner;
    root.querySelector('[data-action="save"]').textContent = owner ? '保存修改' : '发布新模板';
    root.querySelector('[data-action="deploy"]').disabled = !this.currentId || this.dirty;
  }

  renderParts() {
    const list = this.root.querySelector('[data-part-list]');
    list.replaceChildren();
    this.blueprint.parts.forEach((part, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.partIndex = String(index);
      button.className = `part-chip${index === this.selectedPart ? ' active' : ''}`;
      button.textContent = `${partNames[part.type]} · ${index + 1}`;
      list.append(button);
    });
    const part = this.blueprint.parts[this.selectedPart];
    for (const axis of ['x', 'y', 'z', 'width', 'height', 'depth']) {
      const input = this.root.querySelector(`[name="part-${axis}"]`);
      input.value = part?.[axis] ?? 0;
      input.disabled = !part;
    }
    const colorInput = this.root.querySelector('[name="part-color"]');
    colorInput.value = part?.color || this.blueprint.color;
    colorInput.disabled = !part;
    this.root.querySelector('[data-action="remove-part"]').disabled = this.blueprint.parts.length <= 1;
    this.root.querySelectorAll('[data-action="add-part"]').forEach(button => {
      button.disabled = this.blueprint.parts.length >= 16;
    });
  }

  renderSkills() {
    const list = this.root.querySelector('[data-skill-list]');
    list.replaceChildren();
    for (const skill of CREATURE_SKILLS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.skill = skill;
      const skillIndex = this.blueprint.skills.findIndex(item => item.type === skill);
      button.className = `skill-chip${skillIndex >= 0 ? ' active' : ''}${skillIndex === this.selectedSkill ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', String(skillIndex >= 0));
      button.textContent = skillNames[skill];
      list.append(button);
    }
    const skill = this.blueprint.skills[this.selectedSkill];
    for (const [field, key] of [['skill-range', 'range'], ['skill-damage', 'damage'], ['skill-cooldown', 'cooldown']]) {
      const input = this.root.querySelector(`[name="${field}"]`);
      input.value = skill?.[key] ?? '';
      input.disabled = !skill;
    }
    this.root.querySelector('[data-action="remove-skill"]').disabled = !skill;
    const behavior = this.root.querySelector('[name="behavior"]');
    behavior.replaceChildren();
    for (const key of CREATURE_BEHAVIORS) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = behaviorNames[key];
      behavior.append(option);
    }
    behavior.value = this.blueprint.behavior;
  }

  renderPreview() {
    const preview = this.root.querySelector('[data-creature-preview]');
    if (!preview) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 310 300');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${this.blueprint.name} 的形态预览`);
    const spine = document.createElementNS(ns, 'path');
    spine.setAttribute('d', 'M155 35V266');
    spine.setAttribute('stroke', '#78905B');
    spine.setAttribute('stroke-width', '2');
    spine.setAttribute('stroke-dasharray', '4 7');
    spine.setAttribute('opacity', '.6');
    svg.append(spine);
    for (const y of [35, 266]) {
      const node = document.createElementNS(ns, 'circle');
      node.setAttribute('cx', '155');
      node.setAttribute('cy', String(y));
      node.setAttribute('r', '4');
      node.setAttribute('fill', '#D5C66A');
      svg.append(node);
    }
    this.blueprint.parts.forEach((part, index) => {
      const cx = 155 + part.x * this.blueprint.body.width * 72 + part.z * this.blueprint.body.depth * 13;
      const cy = 204 - part.y * this.blueprint.body.height * 105 - part.z * this.blueprint.body.depth * 8;
      const width = part.width * this.blueprint.body.width * 70;
      const height = part.height * this.blueprint.body.height * 75;
      const shape = document.createElementNS(ns, 'rect');
      shape.setAttribute('x', String(cx - width / 2));
      shape.setAttribute('y', String(cy - height / 2));
      shape.setAttribute('width', String(width));
      shape.setAttribute('height', String(height));
      shape.setAttribute('rx', '5');
      shape.setAttribute('fill', part.color);
      shape.setAttribute('stroke', index === this.selectedPart ? '#D5C66A' : '#17211D');
      shape.setAttribute('stroke-width', index === this.selectedPart ? '4' : '2');
      svg.append(shape);
    });
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', '155');
    label.setAttribute('y', '286');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = this.blueprint.name;
    svg.append(label);
    preview.replaceChildren(svg);
  }

  setStatus(message) {
    const status = this.root.querySelector('[data-status]');
    if (status) status.textContent = message;
  }
}
