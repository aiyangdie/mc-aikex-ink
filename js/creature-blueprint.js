export const CREATURE_LIMITS = Object.freeze({
  parts: 16,
  bytes: 8192,
  hp: [1, 100],
  speed: [0.2, 4],
  body: [0.35, 2.5],
  physicalExtent: 5,
  skillRange: [1, 8],
  skillDamage: [1, 8],
  skillCooldown: [0.5, 10],
  roomCreatures: 12,
  templates: 500,
});

export const CREATURE_PART_TYPES = Object.freeze(['body', 'head', 'leg', 'tail', 'horn']);
export const CREATURE_BEHAVIORS = Object.freeze(['wander', 'shy', 'aggressive']);
export const CREATURE_SKILLS = Object.freeze(['melee', 'dash', 'shield']);

export function createDefaultCreatureBlueprint() {
  return {
    version: 1,
    name: '苔原漫游者',
    body: { width: 0.9, height: 1.1, depth: 0.7 },
    hp: 12,
    speed: 1.2,
    color: '#78905B',
    behavior: 'wander',
    parts: [
      { type: 'body', x: 0, y: 0.45, z: 0, width: 1, height: 0.7, depth: 0.8, color: '#78905B' },
      { type: 'head', x: 0, y: 0.9, z: 0.42, width: 0.55, height: 0.48, depth: 0.52, color: '#D5C66A' },
      { type: 'leg', x: -0.28, y: 0.12, z: -0.2, width: 0.2, height: 0.36, depth: 0.2, color: '#4F5E42' },
      { type: 'leg', x: 0.28, y: 0.12, z: -0.2, width: 0.2, height: 0.36, depth: 0.2, color: '#4F5E42' },
      { type: 'leg', x: -0.28, y: 0.12, z: 0.24, width: 0.2, height: 0.36, depth: 0.2, color: '#4F5E42' },
      { type: 'leg', x: 0.28, y: 0.12, z: 0.24, width: 0.2, height: 0.36, depth: 0.2, color: '#4F5E42' },
    ],
    skills: [],
  };
}

function finiteInRange(value, [min, max]) {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function normalizeCreatureBlueprint(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '生物模板格式无效' };
  }
  let bytes;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    return { ok: false, error: '生物模板无法序列化' };
  }
  if (bytes > CREATURE_LIMITS.bytes) return { ok: false, error: '生物模板超过 8 KiB 限制' };
  if (input.version !== 1) return { ok: false, error: '不支持的生物模板版本' };
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 24) {
    return { ok: false, error: '名称需为 1–24 个字符' };
  }
  if (!input.body || typeof input.body !== 'object') return { ok: false, error: '缺少身体尺寸' };
  for (const key of ['width', 'height', 'depth']) {
    if (!finiteInRange(input.body[key], CREATURE_LIMITS.body)) return { ok: false, error: `身体${key}需在 0.35–2.5 之间` };
  }
  if (!finiteInRange(input.hp, CREATURE_LIMITS.hp)) return { ok: false, error: '生命值需在 1–100 之间' };
  if (!finiteInRange(input.speed, CREATURE_LIMITS.speed)) return { ok: false, error: '移动速度需在 0.2–4 之间' };
  if (!/^#[0-9a-f]{6}$/i.test(input.color || '')) return { ok: false, error: '主色需使用六位十六进制颜色' };
  if (!CREATURE_BEHAVIORS.includes(input.behavior)) return { ok: false, error: '未知的行为类型' };
  if (!Array.isArray(input.parts) || input.parts.length < 1 || input.parts.length > CREATURE_LIMITS.parts) {
    return { ok: false, error: `身体部件需为 1–${CREATURE_LIMITS.parts} 个` };
  }
  const parts = [];
  for (const part of input.parts) {
    if (!part || !CREATURE_PART_TYPES.includes(part.type)) return { ok: false, error: '包含不支持的身体部件' };
    if (!/^#[0-9a-f]{6}$/i.test(part.color || '')) return { ok: false, error: '部件颜色无效' };
    const normalized = { type: part.type, color: part.color.toUpperCase() };
    for (const axis of ['x', 'y', 'z']) {
      if (!finiteInRange(part[axis], [-1.5, 1.5])) return { ok: false, error: `部件坐标 ${axis} 超出范围` };
      normalized[axis] = part[axis];
    }
    for (const size of ['width', 'height', 'depth']) {
      if (!finiteInRange(part[size], [0.08, 2])) return { ok: false, error: `部件尺寸 ${size} 超出范围` };
      normalized[size] = part[size];
    }
    parts.push(normalized);
  }
  if (!Array.isArray(input.skills) || input.skills.length > 3) return { ok: false, error: '技能最多配置 3 个' };
  const skills = [];
  const skillTypes = new Set();
  for (const skill of input.skills) {
    if (!skill || !CREATURE_SKILLS.includes(skill.type)) return { ok: false, error: '包含不支持的技能' };
    if (skillTypes.has(skill.type)) return { ok: false, error: '同一技能只能配置一次' };
    skillTypes.add(skill.type);
    const range = skill.range ?? 2;
    const damage = skill.damage ?? 2;
    const cooldown = skill.cooldown ?? 2;
    if (!finiteInRange(range, CREATURE_LIMITS.skillRange)) return { ok: false, error: '技能范围需在 1–8 之间' };
    if (!finiteInRange(damage, CREATURE_LIMITS.skillDamage)) return { ok: false, error: '技能伤害需在 1–8 之间' };
    if (!finiteInRange(cooldown, CREATURE_LIMITS.skillCooldown)) return { ok: false, error: '技能冷却需在 0.5–10 秒之间' };
    skills.push({ type: skill.type, range, damage, cooldown });
  }
  const value = {
    version: 1,
    name: input.name.trim(),
    body: { width: input.body.width, height: input.body.height, depth: input.body.depth },
    hp: input.hp,
    speed: input.speed,
    color: input.color.toUpperCase(),
    behavior: input.behavior,
    parts,
    skills,
  };
  const bounds = creatureCollisionBounds(value);
  if (bounds.width > CREATURE_LIMITS.physicalExtent || bounds.height > CREATURE_LIMITS.physicalExtent) {
    return { ok: false, error: '部件组合超出生物碰撞体安全尺寸' };
  }
  return { ok: true, value };
}

export function creatureCollisionBounds(creature) {
  const { body, parts } = creature;
  let halfWidth = Math.max(body.width, body.depth) / 2;
  let height = body.height;
  for (const part of parts) {
    halfWidth = Math.max(
      halfWidth,
      Math.abs(part.x * body.width) + (part.width * body.width) / 2,
      Math.abs(part.z * body.depth) + (part.depth * body.depth) / 2,
    );
    height = Math.max(height, (part.y + part.height / 2) * body.height);
  }
  return { width: halfWidth * 2, height };
}
