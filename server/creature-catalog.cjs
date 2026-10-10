'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class CreatureCatalog {
  constructor(filePath, validateBlueprint, maxTemplates = 500) {
    this.filePath = filePath;
    this.validateBlueprint = validateBlueprint;
    this.maxTemplates = maxTemplates;
    this.entries = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      throw new Error(`生物模板目录无法读取：${error.message}`);
    }
    if (!data || data.version !== 1 || !Array.isArray(data.templates)) {
      throw new Error('生物模板目录格式无效，请备份并修复 server/data/creature-templates.json');
    }
    if (data.templates.length > this.maxTemplates) throw new Error('生物模板目录超过数量上限');
    for (const row of data.templates) {
      const normalized = this.validateBlueprint(row?.blueprint);
      if (!row || typeof row.id !== 'string' || typeof row.tokenHash !== 'string' ||
          !normalized.ok || this.entries.has(row.id)) {
        throw new Error('生物模板目录包含无效或重复记录');
      }
      this.entries.set(row.id, {
        id: row.id,
        blueprint: normalized.value,
        tokenHash: row.tokenHash,
        createdAt: Number.isFinite(row.createdAt) ? row.createdAt : Date.now(),
        updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : Date.now(),
      });
    }
  }

  list() {
    return [...this.entries.values()].map(({ id, blueprint, createdAt, updatedAt }) => ({
      id, blueprint, createdAt, updatedAt,
    }));
  }

  get(id) {
    const row = this.entries.get(id);
    return row ? { id: row.id, blueprint: row.blueprint, createdAt: row.createdAt, updatedAt: row.updatedAt } : null;
  }

  create(input) {
    const validation = this.validateBlueprint(input);
    if (!validation.ok) return { error: validation.error };
    if (this.entries.size >= this.maxTemplates) return { error: '共享模板目录已满' };
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.entries.set(id, {
      id,
      blueprint: validation.value,
      tokenHash: this.hashToken(token),
      createdAt: now,
      updatedAt: now,
    });
    try { this.persist(); }
    catch (error) { this.entries.delete(id); throw error; }
    return { template: this.get(id), token };
  }

  update(id, token, input) {
    const row = this.entries.get(id);
    if (!row || !this.authorized(row, token)) return { error: '没有此模板的管理权限', status: 403 };
    const validation = this.validateBlueprint(input);
    if (!validation.ok) return { error: validation.error, status: 400 };
    const previous = { blueprint: row.blueprint, updatedAt: row.updatedAt };
    row.blueprint = validation.value;
    row.updatedAt = Date.now();
    try { this.persist(); }
    catch (error) {
      row.blueprint = previous.blueprint;
      row.updatedAt = previous.updatedAt;
      throw error;
    }
    return { template: this.get(id) };
  }

  delete(id, token) {
    const row = this.entries.get(id);
    if (!row || !this.authorized(row, token)) return { error: '没有此模板的管理权限', status: 403 };
    this.entries.delete(id);
    try { this.persist(); }
    catch (error) { this.entries.set(id, row); throw error; }
    return { ok: true };
  }

  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  authorized(row, token) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 100) return false;
    const actual = Buffer.from(this.hashToken(token), 'hex');
    const expected = Buffer.from(row.tokenHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  persist() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify({
        version: 1,
        templates: [...this.entries.values()],
      }), { mode: 0o600 });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch { /* preserve the original write error */ }
      throw new Error(`生物模板保存失败：${error.message}`);
    }
  }
}

module.exports = { CreatureCatalog };
