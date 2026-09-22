/**
 * 物品（非方块）：肉类等；type >= 100
 */
export const ItemType = {
  PORK: 100,       // 猪肉
  BEEF: 101,       // 牛肉
  CHICKEN: 102,    // 鸡肉
  VENISON: 103,    // 鹿肉
  HORSE_MEAT: 104, // 马肉
  DONKEY_MEAT: 105,// 驴肉
  DUCK: 106,       // 鸭肉
  DRAGON_MEAT: 107,// 龙肉
  BOMB: 108,       // 炸弹 · 炸房子
};

export const ItemNames = {
  [ItemType.PORK]: '猪肉',
  [ItemType.BEEF]: '牛肉',
  [ItemType.CHICKEN]: '鸡肉',
  [ItemType.VENISON]: '鹿肉',
  [ItemType.HORSE_MEAT]: '马肉',
  [ItemType.DONKEY_MEAT]: '驴肉',
  [ItemType.DUCK]: '鸭肉',
  [ItemType.DRAGON_MEAT]: '龙肉',
  [ItemType.BOMB]: '炸弹',
};

export const ItemColors = {
  [ItemType.PORK]: '#e891a0',
  [ItemType.BEEF]: '#a04040',
  [ItemType.CHICKEN]: '#f0d080',
  [ItemType.VENISON]: '#8b4513',
  [ItemType.HORSE_MEAT]: '#c07050',
  [ItemType.DONKEY_MEAT]: '#9a7b4f',
  [ItemType.DUCK]: '#d4a574',
  [ItemType.DRAGON_MEAT]: '#9c27b0',
  [ItemType.BOMB]: '#c62828',
};

/** 食用回血量 */
export const FoodHeal = {
  [ItemType.PORK]: 4,
  [ItemType.BEEF]: 5,
  [ItemType.CHICKEN]: 3,
  [ItemType.VENISON]: 5,
  [ItemType.HORSE_MEAT]: 4,
  [ItemType.DONKEY_MEAT]: 4,
  [ItemType.DUCK]: 3,
  [ItemType.DRAGON_MEAT]: 10,
};

export function isItem(type) {
  return (type | 0) >= 100;
}

export function isFood(type) {
  return FoodHeal[type | 0] != null;
}

export function getItemName(type) {
  return ItemNames[type] || null;
}

export function getItemColor(type) {
  return ItemColors[type] || '#ff00ff';
}

export function getFoodHeal(type) {
  return FoodHeal[type] || 0;
}
