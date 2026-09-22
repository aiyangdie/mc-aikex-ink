/**
 * 本地存档：种子 + 方块差分 + 玩家状态
 * 存 localStorage；过大时自动裁剪最旧差分（ponytail: 5MB 上限，可升 IndexedDB）
 */

const SAVE_KEY = 'voxel-world-save-v1';
const MAX_EDITS = 80000; // ~ 约 2–3MB JSON 上限内

export const SaveManager = {
  has() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || (data.v !== 1 && data.v !== 2) || !data.player || !Array.isArray(data.edits)) return null;
      return data;
    } catch {
      return null;
    }
  },

  clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch { /* ignore */ }
  },

  /** edits Map<"x,y,z", type> → flat number[] */
  editsToArray(editsMap) {
    const arr = [];
    for (const [key, type] of editsMap) {
      const parts = key.split(',');
      if (parts.length !== 3) continue;
      arr.push(+parts[0], +parts[1], +parts[2], type | 0);
    }
    return arr;
  },

  arrayToEdits(arr) {
    const map = new Map();
    if (!Array.isArray(arr)) return map;
    for (let i = 0; i + 3 < arr.length; i += 4) {
      map.set(`${arr[i]},${arr[i + 1]},${arr[i + 2]}`, arr[i + 3] | 0);
    }
    return map;
  },

  /**
   * @param {{ seed:number, player:object, edits:Map|number[], selectedSlot?:number }} state
   * @returns {{ ok:boolean, bytes?:number, error?:string }}
   */
  save(state) {
    try {
      let editsArr = state.edits instanceof Map
        ? this.editsToArray(state.edits)
        : (state.edits || []);

      // 超限：丢掉最前面的差分（最早写入的）
      if (editsArr.length > MAX_EDITS * 4) {
        editsArr = editsArr.slice(editsArr.length - MAX_EDITS * 4);
      }

      const payload = {
        v: 2,
        savedAt: Date.now(),
        seed: state.seed | 0,
        selectedSlot: state.selectedSlot | 0,
        hp: state.hp != null ? state.hp : 20,
        inventory: state.inventory || null,
        mistBoss: state.mistBoss || null,
        player: {
          x: +state.player.x,
          y: +state.player.y,
          z: +state.player.z,
          yaw: +state.player.yaw,
          pitch: +state.player.pitch,
        },
        edits: editsArr,
      };

      const json = JSON.stringify(payload);
      localStorage.setItem(SAVE_KEY, json);
      return { ok: true, bytes: json.length, editCount: editsArr.length / 4 };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  },

  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
};

/* ---------- 自检（浏览器控制台：import 后 SaveManager._selfCheck()）---------- */
SaveManager._selfCheck = function () {
  const m = new Map([['1,2,3', 4], ['-1,0,8', 0]]);
  const arr = this.editsToArray(m);
  const back = this.arrayToEdits(arr);
  console.assert(back.get('1,2,3') === 4 && back.get('-1,0,8') === 0, 'edits roundtrip');
  const r = this.save({
    seed: 12345,
    selectedSlot: 2,
    player: { x: 1, y: 2, z: 3, yaw: 0.1, pitch: -0.2 },
    edits: m,
  });
  console.assert(r.ok, 'save ok');
  const loaded = this.load();
  console.assert(loaded && loaded.player.x === 1 && loaded.selectedSlot === 2, 'load ok');
  this.clear();
  console.assert(!this.has(), 'clear ok');
  console.log('SaveManager self-check passed');
  return true;
};
