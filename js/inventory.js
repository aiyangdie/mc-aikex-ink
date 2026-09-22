/**
 * 生存背包：9 格热栏，有数量；放置消耗，挖掘/击杀掉落增加
 */
const MAX_STACK = 64;

export class Inventory {
  constructor(size = 9) {
    this.size = size;
    /** @type {({type:number,count:number}|null)[]} */
    this.slots = Array.from({ length: size }, () => null);
  }

  /** 新手物资：建材 + 黑曜石够搭一座门 */
  giveStarter() {
    this.clear();
    this.add(2, 32);   // DIRT
    this.add(5, 24);   // WOOD
    this.add(15, 16);  // PLANKS
    this.add(3, 16);   // STONE
    this.add(11, 14);  // OBSIDIAN · 地狱门框
    this.add(108, 8);  // BOMB · 炸弹
  }

  clear() {
    for (let i = 0; i < this.size; i++) this.slots[i] = null;
  }

  get(slot) {
    return this.slots[slot] || null;
  }

  /** @returns {number} 实际放入数量 */
  add(type, count = 1) {
    type = type | 0;
    count = count | 0;
    if (type <= 0 || count <= 0) return 0;
    let left = count;

    for (const s of this.slots) {
      if (!s || s.type !== type || s.count >= MAX_STACK) continue;
      const space = MAX_STACK - s.count;
      const n = Math.min(space, left);
      s.count += n;
      left -= n;
      if (!left) return count;
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(MAX_STACK, left);
      this.slots[i] = { type, count: n };
      left -= n;
    }
    return count - left;
  }

  /** 从指定格取出；不够返回 false */
  consume(slot, n = 1) {
    const s = this.slots[slot];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[slot] = null;
    return true;
  }

  selectedType(slot) {
    const s = this.slots[slot];
    return s ? s.type : 0;
  }

  toJSON() {
    return this.slots.map((s) => (s ? [s.type, s.count] : null));
  }

  fromJSON(arr) {
    this.clear();
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < this.size && i < arr.length; i++) {
      const row = arr[i];
      if (!row || !Array.isArray(row)) continue;
      const type = row[0] | 0;
      const count = row[1] | 0;
      if (type > 0 && count > 0) this.slots[i] = { type, count: Math.min(MAX_STACK, count) };
    }
  }
}

export { MAX_STACK };
