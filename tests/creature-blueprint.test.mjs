import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultCreatureBlueprint, normalizeCreatureBlueprint } from '../js/creature-blueprint.js';

test('default creature blueprint is normalized and stable', () => {
  const first = normalizeCreatureBlueprint(createDefaultCreatureBlueprint());
  assert.equal(first.ok, true);
  assert.deepEqual(normalizeCreatureBlueprint(first.value), first);
});

test('blueprint validation rejects unknown parts, non-finite stats, and oversized definitions', () => {
  const base = createDefaultCreatureBlueprint();
  assert.match(normalizeCreatureBlueprint({ ...base, parts: [{ ...base.parts[0], type: 'script' }] }).error, /部件/);
  assert.match(normalizeCreatureBlueprint({ ...base, speed: Infinity }).error, /速度/);
  assert.match(normalizeCreatureBlueprint({ ...base, parts: Array(17).fill(base.parts[0]) }).error, /部件/);
  assert.match(normalizeCreatureBlueprint({ ...base, name: '生'.repeat(9000) }).error, /8 KiB/);
});

test('skills use a bounded declarative allowlist', () => {
  const base = createDefaultCreatureBlueprint();
  assert.equal(normalizeCreatureBlueprint({ ...base, skills: [{ type: 'melee', range: 4, damage: 3, cooldown: 2 }] }).ok, true);
  assert.match(normalizeCreatureBlueprint({ ...base, skills: [{ type: 'eval', code: 'alert(1)' }] }).error, /技能/);
  assert.match(normalizeCreatureBlueprint({ ...base, skills: [{ type: 'melee', range: 99 }] }).error, /范围/);
  assert.match(normalizeCreatureBlueprint({ ...base, skills: [{ type: 'melee' }, { type: 'melee' }] }).error, /只能配置一次/);
});

test('normalization strips unknown fields and rejects body parts outside the collision envelope', () => {
  const base = createDefaultCreatureBlueprint();
  const safe = normalizeCreatureBlueprint({ ...base, body: { ...base.body, injected: true } });
  assert.equal(safe.ok, true);
  assert.equal('injected' in safe.value.body, false);
  assert.match(normalizeCreatureBlueprint({
    ...base,
    body: { width: 2.5, height: 2.5, depth: 2.5 },
    parts: [{ ...base.parts[0], x: 1.5, width: 2 }],
  }).error, /碰撞体安全尺寸/);
});
