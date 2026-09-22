/**
 * 击杀掉落表（客户端 / 服务端共用，勿依赖 three）
 * items: 物品 typeId 列表；coins: 额外金币数量
 */
import { ItemType, isFood, getItemName } from './items.js';

export const MOB_LOOT = {
  pig:     { items: [ItemType.PORK, ItemType.PORK], coins: 2 },
  cow:     { items: [ItemType.BEEF, ItemType.BEEF], coins: 3 },
  chicken: { items: [ItemType.CHICKEN], coins: 1 },
  duck:    { items: [ItemType.DUCK], coins: 1 },
  deer:    { items: [ItemType.VENISON, ItemType.VENISON], coins: 3 },
  horse:   { items: [ItemType.HORSE_MEAT, ItemType.HORSE_MEAT], coins: 4 },
  donkey:  { items: [ItemType.DONKEY_MEAT, ItemType.DONKEY_MEAT], coins: 3 },
  scout:   { items: [12, 12], coins: 5 }, // NETHERRACK
  heavy:   { items: [10, 3], coins: 4 },
};

/** @returns {number[]} 含肉类 + 金币 typeId */
export function buildMobDrops(kind) {
  const L = MOB_LOOT[kind] || { items: [ItemType.PORK], coins: 1 };
  const out = [...(L.items || [])];
  const n = Math.max(0, L.coins | 0);
  for (let i = 0; i < n; i++) out.push(ItemType.COIN);
  return out;
}

/** 汇总掉落文案：{ label, foodType, coins, counts } */
export function summarizeDrops(drops) {
  const counts = new Map();
  for (const t of drops || []) {
    const id = t | 0;
    if (id <= 0) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const parts = [];
  let foodType = 0;
  let coins = 0;
  for (const [type, n] of counts) {
    if (type === ItemType.COIN) {
      coins = n;
      parts.push(`金币×${n}`);
      continue;
    }
    const name = getItemName(type) || `物品${type}`;
    parts.push(n > 1 ? `${name}×${n}` : name);
    if (!foodType && isFood(type)) foodType = type;
  }
  return { label: parts.join(' · ') || '无', foodType, coins, counts };
}
