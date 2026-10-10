'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CreatureCatalog } = require('./creature-catalog.cjs');

function validation(input) {
  return input && input.name ? { ok: true, value: { name: input.name } } : { ok: false, error: '无效模板' };
}

test('catalog keeps tokens private, authorizes edits, and survives reload', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creature-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'templates.json');
  const catalog = new CreatureCatalog(file, validation, 2);
  const created = catalog.create({ name: '星苔' });
  assert.ok(created.token);
  assert.equal(catalog.list()[0].token, undefined);
  assert.equal(JSON.stringify(fs.readFileSync(file, 'utf8')).includes(created.token), false);
  assert.equal(catalog.update(created.template.id, 'wrong-token', { name: '伪造' }).status, 403);
  assert.equal(catalog.update(created.template.id, created.token, { name: '星苔改' }).template.blueprint.name, '星苔改');
  const reloaded = new CreatureCatalog(file, validation, 2);
  assert.equal(reloaded.get(created.template.id).blueprint.name, '星苔改');
  assert.equal(reloaded.delete(created.template.id, created.token).ok, true);
});

test('catalog enforces maximum entries and refuses corrupt persisted data', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creature-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'templates.json');
  const catalog = new CreatureCatalog(file, validation, 1);
  catalog.create({ name: '一号' });
  assert.match(catalog.create({ name: '二号' }).error, /已满/);
  fs.writeFileSync(file, '{');
  assert.throws(() => new CreatureCatalog(file, validation), /无法读取/);
});
