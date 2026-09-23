/**
 * 像素方块世界 - 体素引擎核心模块
 * 包含：方块定义、纹理图集、区块管理、世界生成、Coze 文字立墙
 */

import * as THREE from 'three';
import { SimplexNoise } from './noise.js?v=groundfix9';
import { selectAdDecals, createAdTexture } from './ad-decals.js';

/* ============================================
   常量与配置
   ============================================ */
export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 48;
export const RENDER_DISTANCE = 4;
export const MOBILE_RENDER_DISTANCE = 4;
export const SEA_LEVEL = 20;

export const Dim = {
  OVERWORLD: 'overworld',
  NETHER: 'nether',
  END: 'end',
};

export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent)
    || ('ontouchstart' in window && window.innerWidth < 1024);
}

export function getRenderDistance() {
  return isMobileDevice() ? MOBILE_RENDER_DISTANCE : RENDER_DISTANCE;
}

export const BlockType = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  WATER: 7,
  COZE_CYAN: 8,
  COAL_ORE: 9,
  IRON_ORE: 10,
  OBSIDIAN: 11,    // 黑曜石 · 地狱门
  NETHERRACK: 12,  // 地狱岩
  PORTAL: 13,      // 传送门（可穿过）
  END_STONE: 14,   // 末地石
  PLANKS: 15,      // 木板 · 造房子
};

export const BlockNames = {
  [BlockType.GRASS]: '草地',
  [BlockType.DIRT]: '泥土',
  [BlockType.STONE]: '石头',
  [BlockType.SAND]: '沙子',
  [BlockType.WOOD]: '木头',
  [BlockType.LEAVES]: '树叶',
  [BlockType.WATER]: '水',
  [BlockType.COZE_CYAN]: '青色',
  [BlockType.COAL_ORE]: '煤矿',
  [BlockType.IRON_ORE]: '铁矿',
  [BlockType.OBSIDIAN]: '黑曜石',
  [BlockType.NETHERRACK]: '地狱岩',
  [BlockType.PORTAL]: '传送门',
  [BlockType.END_STONE]: '末地石',
  [BlockType.PLANKS]: '木板',
};

const NON_SOLID = new Set([BlockType.AIR, BlockType.WATER, BlockType.PORTAL]);
export const isSolid = (type) => !NON_SOLID.has(type);

/* ============================================
   纹理图集系统
   每个方块面使用16x16像素贴图，排列在图集中
   ============================================ */
const TEX_SIZE = 16;
const ATLAS_COLS = 8;
const ATLAS_ROWS = 3; // 24 槽
const ATLAS_W = TEX_SIZE * ATLAS_COLS;
const ATLAS_H = TEX_SIZE * ATLAS_ROWS;

const TEX = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD_SIDE: 5,
  WOOD_TOP: 6,
  LEAVES: 7,
  WATER: 8,
  COZE_CYAN: 9,
  COAL_ORE: 10,
  IRON_ORE: 11,
  OBSIDIAN: 12,
  NETHERRACK: 13,
  PORTAL: 14,
  END_STONE: 15,
  PLANKS: 16,
};

const BLOCK_TEXTURES = {
  [BlockType.GRASS]:      { top: TEX.GRASS_TOP,    side: TEX.GRASS_SIDE, bottom: TEX.DIRT },
  [BlockType.DIRT]:       { top: TEX.DIRT,         side: TEX.DIRT,       bottom: TEX.DIRT },
  [BlockType.STONE]:      { top: TEX.STONE,        side: TEX.STONE,      bottom: TEX.STONE },
  [BlockType.SAND]:       { top: TEX.SAND,         side: TEX.SAND,       bottom: TEX.SAND },
  [BlockType.WOOD]:       { top: TEX.WOOD_TOP,     side: TEX.WOOD_SIDE,  bottom: TEX.WOOD_TOP },
  [BlockType.LEAVES]:     { top: TEX.LEAVES,       side: TEX.LEAVES,     bottom: TEX.LEAVES },
  [BlockType.WATER]:      { top: TEX.WATER,        side: TEX.WATER,      bottom: TEX.WATER },
  [BlockType.COZE_CYAN]:  { top: TEX.COZE_CYAN,    side: TEX.COZE_CYAN,  bottom: TEX.COZE_CYAN },
  [BlockType.COAL_ORE]:   { top: TEX.COAL_ORE,     side: TEX.COAL_ORE,   bottom: TEX.COAL_ORE },
  [BlockType.IRON_ORE]:   { top: TEX.IRON_ORE,     side: TEX.IRON_ORE,   bottom: TEX.IRON_ORE },
  [BlockType.OBSIDIAN]:   { top: TEX.OBSIDIAN,     side: TEX.OBSIDIAN,   bottom: TEX.OBSIDIAN },
  [BlockType.NETHERRACK]: { top: TEX.NETHERRACK,   side: TEX.NETHERRACK, bottom: TEX.NETHERRACK },
  [BlockType.PORTAL]:     { top: TEX.PORTAL,       side: TEX.PORTAL,     bottom: TEX.PORTAL },
  [BlockType.END_STONE]:  { top: TEX.END_STONE,    side: TEX.END_STONE,  bottom: TEX.END_STONE },
  [BlockType.PLANKS]:     { top: TEX.PLANKS,       side: TEX.PLANKS,     bottom: TEX.PLANKS },
};

/** 伪随机数生成器（基于坐标，用于纹理像素变化） */
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xff) / 255;
}

/** 在 canvas 上绘制单个16x16纹理 */
function drawTexture(ctx, index, drawFn) {
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  const x = col * TEX_SIZE;
  const y = row * TEX_SIZE;
  ctx.save();
  ctx.translate(x, y);
  drawFn(ctx);
  ctx.restore();
}

/** 填充基础色并添加噪声像素 */
function fillNoisy(ctx, baseR, baseG, baseB, noiseAmount = 20) {
  for (let py = 0; py < TEX_SIZE; py++) {
    for (let px = 0; px < TEX_SIZE; px++) {
      const n = (hash(px, py) - 0.5) * noiseAmount;
      const r = Math.max(0, Math.min(255, baseR + n));
      const g = Math.max(0, Math.min(255, baseG + n));
      const b = Math.max(0, Math.min(255, baseB + n));
      ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

/** 创建纹理图集 Canvas */
function createAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 草地顶部 - 绿色带深绿斑点
  drawTexture(ctx, TEX.GRASS_TOP, (c) => {
    fillNoisy(c, 90, 160, 50, 30);
  });

  // 草地侧面 - 上部绿色，下部泥土色
  drawTexture(ctx, TEX.GRASS_SIDE, (c) => {
    fillNoisy(c, 134, 96, 67, 20);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const n = (hash(px + 100, py + 100) - 0.5) * 30;
        const g = Math.max(0, Math.min(255, 140 + n));
        c.fillStyle = `rgb(${(70+n/2)|0},${g|0},${(40+n/3)|0})`;
        c.fillRect(px, py, 1, 1);
      }
    }
  });

  // 泥土
  drawTexture(ctx, TEX.DIRT, (c) => { fillNoisy(c, 134, 96, 67, 25); });

  // 石头
  drawTexture(ctx, TEX.STONE, (c) => {
    fillNoisy(c, 128, 128, 128, 25);
    for (let i = 0; i < 4; i++) {
      const sx = (hash(i, 42) * 14) | 0;
      const sy = (hash(i, 73) * 14) | 0;
      c.fillStyle = 'rgba(80,80,80,0.6)';
      c.fillRect(sx, sy, 2, 1);
      c.fillRect(sx + 1, sy + 1, 1, 1);
    }
  });

  // 沙子
  drawTexture(ctx, TEX.SAND, (c) => { fillNoisy(c, 220, 200, 130, 20); });

  // 木头侧面
  drawTexture(ctx, TEX.WOOD_SIDE, (c) => {
    fillNoisy(c, 120, 80, 50, 15);
    for (let px = 0; px < TEX_SIZE; px++) {
      if (hash(px, 999) > 0.6) {
        for (let py = 0; py < TEX_SIZE; py++) {
          c.fillStyle = 'rgba(80,55,30,0.4)';
          c.fillRect(px, py, 1, 1);
        }
      }
    }
  });

  // 木头顶部 - 年轮
  drawTexture(ctx, TEX.WOOD_TOP, (c) => {
    fillNoisy(c, 160, 120, 70, 15);
    const cx = 8, cy = 8;
    for (let py = 0; py < TEX_SIZE; py++) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
        if ((dist | 0) % 3 === 0) {
          c.fillStyle = 'rgba(90,60,30,0.5)';
          c.fillRect(px, py, 1, 1);
        }
      }
    }
  });

  // 树叶
  drawTexture(ctx, TEX.LEAVES, (c) => {
    for (let py = 0; py < TEX_SIZE; py++) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const n = hash(px + 50, py + 50);
        if (n > 0.15) {
          const v = 30 + (hash(px, py) * 40) | 0;
          c.fillStyle = `rgb(${(30+n*20)|0},${(100+v)|0},${(30+n*10)|0})`;
          c.fillRect(px, py, 1, 1);
        }
      }
    }
  });

  // 水
  drawTexture(ctx, TEX.WATER, (c) => {
    fillNoisy(c, 50, 130, 220, 15);
    for (let py = 2; py < TEX_SIZE; py += 4) {
      for (let px = 0; px < TEX_SIZE; px++) {
        const offset = ((hash(py, px + 200) * 3) | 0) - 1;
        const bx = px + offset;
        if (bx >= 0 && bx < TEX_SIZE) {
          c.fillStyle = 'rgba(80,170,255,0.4)';
          c.fillRect(bx, py, 1, 1);
        }
      }
    }
  });

  // === Coze 品牌粉色纹理 (#F46B95) ===
  drawTexture(ctx, TEX.COZE_CYAN, (c) => {
    fillNoisy(c, 244, 107, 149, 10);
  });

  // 煤矿：深灰石底 + 黑斑
  drawTexture(ctx, TEX.COAL_ORE, (c) => {
    fillNoisy(c, 110, 110, 110, 20);
    for (let i = 0; i < 10; i++) {
      const sx = (hash(i + 3, 11) * 13) | 0;
      const sy = (hash(i + 7, 19) * 13) | 0;
      c.fillStyle = 'rgb(20,20,20)';
      c.fillRect(sx, sy, 2, 2);
    }
  });

  // 铁矿：灰底 + 橙褐斑
  drawTexture(ctx, TEX.IRON_ORE, (c) => {
    fillNoisy(c, 130, 130, 128, 18);
    for (let i = 0; i < 8; i++) {
      const sx = (hash(i + 2, 21) * 13) | 0;
      const sy = (hash(i + 5, 33) * 13) | 0;
      c.fillStyle = 'rgb(180,120,80)';
      c.fillRect(sx, sy, 2, 2);
    }
  });

  drawTexture(ctx, TEX.OBSIDIAN, (c) => {
    fillNoisy(c, 20, 12, 35, 12);
    for (let i = 0; i < 6; i++) {
      c.fillStyle = 'rgb(40,20,60)';
      c.fillRect((hash(i, 1) * 14) | 0, (hash(i, 2) * 14) | 0, 2, 2);
    }
  });

  drawTexture(ctx, TEX.NETHERRACK, (c) => {
    fillNoisy(c, 110, 40, 40, 25);
  });

  drawTexture(ctx, TEX.PORTAL, (c) => {
    fillNoisy(c, 80, 20, 160, 30);
    for (let py = 0; py < TEX_SIZE; py += 2) {
      c.fillStyle = 'rgba(180,80,255,0.5)';
      c.fillRect(0, py, TEX_SIZE, 1);
    }
  });

  drawTexture(ctx, TEX.END_STONE, (c) => {
    fillNoisy(c, 200, 195, 150, 18);
  });

  drawTexture(ctx, TEX.PLANKS, (c) => {
    fillNoisy(c, 170, 130, 70, 12);
    for (let py = 0; py < TEX_SIZE; py += 4) {
      c.fillStyle = 'rgba(100,70,30,0.35)';
      c.fillRect(0, py, TEX_SIZE, 1);
    }
  });

  return canvas;
}

/** 创建 Three.js 纹理 */
export function createBlockTexture() {
  const canvas = createAtlasCanvas();
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}

/** 获取方块预览颜色（用于物品栏显示） */
export function getBlockColor(type) {
  const colors = {
    [BlockType.GRASS]:      '#5a9e32',
    [BlockType.DIRT]:       '#866043',
    [BlockType.STONE]:      '#808080',
    [BlockType.SAND]:       '#dccc82',
    [BlockType.WOOD]:       '#78503a',
    [BlockType.LEAVES]:     '#2d6e1e',
    [BlockType.WATER]:      '#3388dd',
    [BlockType.COZE_CYAN]:  '#F46B95',
    [BlockType.COAL_ORE]:   '#2a2a2a',
    [BlockType.IRON_ORE]:   '#b47850',
    [BlockType.OBSIDIAN]:   '#1a0a28',
    [BlockType.NETHERRACK]: '#6e2828',
    [BlockType.PORTAL]:     '#7b1fa2',
    [BlockType.END_STONE]:  '#c8c396',
    [BlockType.PLANKS]:     '#aa8246',
  };
  return colors[type] || '#ff00ff';
}

/** 破坏方块时掉落（null = 无掉落） */
export function getBreakDrop(type) {
  if (type === BlockType.AIR || type === BlockType.WATER || type === BlockType.COZE_CYAN) return null;
  if (type === BlockType.PORTAL) return null;
  if (type === BlockType.LEAVES) return Math.random() < 0.12 ? BlockType.WOOD : null;
  if (type === BlockType.GRASS) return BlockType.DIRT;
  return type;
}

/** 获取纹理图集中某个纹理索引的UV范围 */
function getTexUV(texIndex) {
  const col = texIndex % ATLAS_COLS;
  const row = Math.floor(texIndex / ATLAS_COLS);
  const u0 = col / ATLAS_COLS;
  const u1 = (col + 1) / ATLAS_COLS;
  const v0 = row / ATLAS_ROWS;
  const v1 = (row + 1) / ATLAS_ROWS;
  return { u0, v0, u1, v1 };
}

/* ============================================
   六个面的几何定义
   ============================================ */
const FACES = [
  { dir: [1, 0, 0], face: 'side', corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [1, 1, 0], uv: [0, 1] },
    { pos: [1, 1, 1], uv: [1, 1] }, { pos: [1, 0, 1], uv: [1, 0] },
  ]},
  { dir: [-1, 0, 0], face: 'side', corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [0, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [1, 0] },
  ]},
  { dir: [0, 1, 0], face: 'top', corners: [
    { pos: [0, 1, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [0, 1] },
    { pos: [1, 1, 1], uv: [1, 1] }, { pos: [1, 1, 0], uv: [1, 0] },
  ]},
  { dir: [0, -1, 0], face: 'bottom', corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [0, 0, 0], uv: [0, 1] },
    { pos: [1, 0, 0], uv: [1, 1] }, { pos: [1, 0, 1], uv: [1, 0] },
  ]},
  { dir: [0, 0, 1], face: 'side', corners: [
    { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] },
  ]},
  { dir: [0, 0, -1], face: 'side', corners: [
    { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 0], uv: [0, 1] },
    { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] },
  ]},
];

/* ============================================
   区块类 (Chunk)
   ============================================ */
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    this.mesh = null;
    this.waterMesh = null;
    this.adMesh = null;
    this.adEntries = [];
    this.adConfig = null;
    this.dirty = true;
  }

  getBlock(lx, ly, lz) {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) {
      return BlockType.AIR;
    }
    return this.blocks[lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE];
  }

  setBlock(lx, ly, lz, type) {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_HEIGHT) return;
    this.blocks[lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE] = type;
    this.dirty = true;
  }

  buildMesh(getWorldBlock, material, waterMaterial) {
    let hasSolid = false;
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.blocks[i] !== 0) { hasSolid = true; break; }
    }
    if (!hasSolid) {
      this._disposeMesh();
      this.dirty = false;
      return;
    }

    const wx0 = this.cx * CHUNK_SIZE;
    const wz0 = this.cz * CHUNK_SIZE;

    const sPositions = [];
    const sNormals = [];
    const sUvs = [];
    const sIndices = [];
    let sVc = 0;

    const wPositions = [];
    const wNormals = [];
    const wUvs = [];
    const wIndices = [];
    let wVc = 0;

    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const blockType = this.getBlock(lx, ly, lz);
          if (blockType === BlockType.AIR) continue;

          const texMapping = BLOCK_TEXTURES[blockType];
          if (!texMapping) continue;

          const isWater = blockType === BlockType.WATER;
          let positions, normals, uvs, indices, vertexCount;
          if (isWater) {
            positions = wPositions; normals = wNormals; uvs = wUvs; indices = wIndices; vertexCount = wVc;
          } else {
            positions = sPositions; normals = sNormals; uvs = sUvs; indices = sIndices; vertexCount = sVc;
          }

          for (const face of FACES) {
            const nx = lx + face.dir[0];
            const ny = ly + face.dir[1];
            const nz = lz + face.dir[2];

            let neighborType;
            if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE && ny >= 0 && ny < CHUNK_HEIGHT) {
              neighborType = this.getBlock(nx, ny, nz);
            } else {
              neighborType = getWorldBlock(wx0 + nx, ny, wz0 + nz);
            }

            if (neighborType !== BlockType.AIR && neighborType !== BlockType.WATER && neighborType !== BlockType.PORTAL) continue;

            const texIdx = texMapping[face.face];
            const { u0, v0, u1, v1 } = getTexUV(texIdx);

            for (const corner of face.corners) {
              positions.push(lx + corner.pos[0], ly + corner.pos[1], lz + corner.pos[2]);
              normals.push(face.dir[0], face.dir[1], face.dir[2]);
              uvs.push(u0 + corner.uv[0] * (u1 - u0), v0 + corner.uv[1] * (v1 - v0));
            }

            indices.push(
              vertexCount, vertexCount + 1, vertexCount + 2,
              vertexCount, vertexCount + 2, vertexCount + 3
            );
            vertexCount += 4;
          }

          if (isWater) { wVc = vertexCount; } else { sVc = vertexCount; }
        }
      }
    }

    this._disposeMesh();

    if (sPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(sPositions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(sNormals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(sUvs, 2));
      geo.setIndex(sIndices);
      geo.computeBoundingSphere();
      this.mesh = new THREE.Mesh(geo, material);
      this.mesh.position.set(wx0, 0, wz0);
    }

    if (wPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wPositions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(wNormals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(wUvs, 2));
      geo.setIndex(wIndices);
      geo.computeBoundingSphere();
      this.waterMesh = new THREE.Mesh(geo, waterMaterial);
      this.waterMesh.position.set(wx0, 0, wz0);
    }

    this._buildDecals(getWorldBlock);
    this.dirty = false;
  }

  _buildDecals(getWorldBlock) {
    if (!this.adConfig?.material) return;
    this.adEntries = selectAdDecals({
      seed: this.adConfig.seed, dimension: this.adConfig.dimension(),
      cx: this.cx, cz: this.cz, getBlock: (x,y,z) => {
        const lx=x-this.cx*CHUNK_SIZE, lz=z-this.cz*CHUNK_SIZE;
        return lx>=0&&lx<CHUNK_SIZE&&lz>=0&&lz<CHUNK_SIZE ? this.getBlock(lx,y,lz) : getWorldBlock(x,y,z);
      },
    });
    if (!this.adEntries.length) return;
    const positions=[], normals=[], uvs=[], indices=[];
    for (const ad of this.adEntries) {
      const [nx,ny,nz]=ad.face;
      const center=[ad.x+.5+nx*.506, ad.y+.5+ny*.506, ad.z+.5+nz*.506];
      const right=ny ? [1,0,0] : nx ? [0,0,-nx] : [nz,0,0];
      const up=ny ? [0,0,-1] : [0,1,0];
      const base=positions.length/3;
      for (const [u,v] of [[0,0],[1,0],[1,1],[0,1]]) {
        positions.push(...center.map((c,i)=>c+(u-.5)*.94*right[i]+(v-.5)*.78*up[i]));
        normals.push(nx,ny,nz);uvs.push(u,v);
      }
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);
    this.adMesh=new THREE.Mesh(geometry,this.adConfig.material);
  }

  _disposeDecals() {
    if (this.adMesh) {
      this.adMesh.geometry.dispose();
      if (this.adMesh.parent) this.adMesh.parent.remove(this.adMesh);
      this.adMesh=null;
    }
    this.adEntries=[];
  }

  _disposeMesh() {
    this._disposeDecals();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh = null;
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      if (this.waterMesh.parent) this.waterMesh.parent.remove(this.waterMesh);
      this.waterMesh = null;
    }
  }

  dispose() {
    this._disposeMesh();
  }
}

/* ============================================
   世界类 (World)
   ============================================ */
export class World {
  constructor(scene, seed = 12345) {
    this.scene = scene;
    this.seed = seed;
    this.dimension = Dim.OVERWORLD;
    this.noise = new SimplexNoise(seed);
    this.treeNoise = new SimplexNoise(seed + 777);
    this.chunks = new Map();
    this.material = null;
    this.adMaterial = null;
    this.pendingChunks = [];
    this.renderDistance = RENDER_DISTANCE;
    /** 玩家改动的方块差分 key=`wx,wy,wz` → BlockType（含 AIR） */
    this.edits = new Map();
  }

  setDimension(dim) {
    for (const chunk of this.chunks.values()) chunk._disposeDecals();
    this.dimension = dim || Dim.OVERWORLD;
    // 换维度换噪声相位，地形不同
    const base = this.seed + (dim === Dim.NETHER ? 9001 : dim === Dim.END ? 4242 : 0);
    this.noise = new SimplexNoise(base);
    this.treeNoise = new SimplexNoise(base + 777);
  }

  init() {
    if (this.adMaterial) { this.adMaterial.map.dispose(); this.adMaterial.dispose(); }
    const texture = createBlockTexture();
    this.material = new THREE.MeshLambertMaterial({
      map: texture,
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
    });
    this.adMaterial = new THREE.MeshBasicMaterial({
      map: createAdTexture(), side: THREE.FrontSide, transparent: false, depthWrite: true,
    });
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: texture,
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
    });
  }

  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  configureChunkDecals(chunk) {
    chunk.adConfig = {seed:this.seed,dimension:()=>this.dimension,material:this.adMaterial};
  }

  refreshAdjacentDecals(cx,cz) {
    for (const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const chunk=this.chunks.get(this.chunkKey(cx+dx,cz+dz));
      if (!chunk) continue;
      const attached=!!chunk.mesh?.parent;
      chunk._disposeDecals();
      chunk._buildDecals((x,y,z)=>this.getBlock(x,y,z));
      if (attached && chunk.adMesh) this.scene.add(chunk.adMesh);
    }
  }

  dispose() {
    for (const chunk of this.chunks.values()) chunk.dispose();
    this.chunks.clear();
    this.pendingChunks.length=0;
    if (this.adMaterial) {
      this.adMaterial.map?.dispose();
      this.adMaterial.dispose();
      this.adMaterial=null;
    }
    if (this.material) {
      this.material.map?.dispose();
      this.material.dispose();
      this.material=null;
    }
    if (this.waterMaterial) {
      this.waterMaterial.dispose();
      this.waterMaterial=null;
    }
  }

  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BlockType.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (!chunk) return BlockType.AIR;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.getBlock(lx, wy, lz);
  }

  setBlock(wx, wy, wz, type) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    // 记录差分（区块未加载时也保留，下次生成时回放）
    this.edits.set(`${wx},${wy},${wz}`, type);
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (!chunk) return;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk.setBlock(lx, wy, lz, type);
    chunk._disposeDecals(); // The old decal cannot linger until the next mesh rebuild.

    if (lx === 0) this._markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this._markDirty(cx + 1, cz);
    if (lz === 0) this._markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this._markDirty(cx, cz + 1);
  }

  /** 把已记录的差分应用到刚生成的区块 */
  applyEdits(chunk) {
    if (!this.edits.size) return;
    const wx0 = chunk.cx * CHUNK_SIZE;
    const wz0 = chunk.cz * CHUNK_SIZE;
    const wx1 = wx0 + CHUNK_SIZE;
    const wz1 = wz0 + CHUNK_SIZE;
    for (const [key, type] of this.edits) {
      const c1 = key.indexOf(',');
      const c2 = key.indexOf(',', c1 + 1);
      if (c1 < 0 || c2 < 0) continue;
      const wx = +key.slice(0, c1);
      const wy = +key.slice(c1 + 1, c2);
      const wz = +key.slice(c2 + 1);
      if (wx < wx0 || wx >= wx1 || wz < wz0 || wz >= wz1) continue;
      if (wy < 0 || wy >= CHUNK_HEIGHT) continue;
      chunk.setBlock(wx - wx0, wy, wz - wz0, type);
    }
  }

  _markDirty(cx, cz) {
    const chunk = this.chunks.get(this.chunkKey(cx, cz));
    if (chunk) { chunk.dirty = true; chunk._disposeDecals(); }
  }

  // ────────────── Coze 文字立墙（XY 平面，面朝南）──────────────
  // 每个字母 9×9 像素位图，立墙：row=Y(上→下), col=X(左→右)
  static LETTERS = {
    C: [[0,1,1,1,1,1,1,1,0],[1,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,1],[0,1,1,1,1,1,1,1,0]],
    o: [[0,1,1,1,1,1,1,1,0],[1,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,0,1],[0,1,1,1,1,1,1,1,0]],
    z: [[1,1,1,1,1,1,1,1,1],[0,1,0,0,0,0,0,0,0],[0,0,1,0,0,0,0,0,0],[0,0,0,1,0,0,0,0,0],[0,0,0,0,1,0,0,0,0],[0,0,0,0,0,1,0,0,0],[0,0,0,0,0,0,1,0,0],[0,0,0,0,0,0,0,1,0],[1,1,1,1,1,1,1,1,1]],
    e: [[1,1,1,1,1,1,1,1,1],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,1,1,1,1,1,1,1,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,1,1,1,1,1,1,1,1]],
  };
  static WORD = ['C','o','z','e'];
  static LETTER_SIZE = 9;
  static GAP = 2;
  static TEXT_GROUND_Y = 18;        // 沙质地面 Y（抬高4层）
  static TEXT_FLAT_RADIUS_X = 22;   // 平地 X 方向半径
  static TEXT_FLAT_RADIUS_Z = 10;   // 平地 Z 方向半径
  static TOTAL_W = 42;              // 9×4 + 2×3
  static TEXT_START_X = -21;        // -floor(42/2)
  static TEXT_BASE_Y = 19;          // 立墙底部 Y（在沙地上，跟随地面抬高）
  static TEXT_WALL_Z = 0;           // 立墙中心 Z
  static TEXT_WALL_DEPTH = 3;       // 立墙厚度

  /** 获取立墙文字方块（XY 平面） */
  _getTextBlock(wx, wy, wz) {
    // 立墙 Z 范围：中心 ± 1（3 格厚）
    const wallMinZ = World.TEXT_WALL_Z - 1;
    const wallMaxZ = World.TEXT_WALL_Z + 1;
    if (wz < wallMinZ || wz > wallMaxZ) return BlockType.AIR;

    // Y 范围：TEXT_BASE_Y ~ TEXT_BASE_Y + 8
    if (wy < World.TEXT_BASE_Y || wy > World.TEXT_BASE_Y + World.LETTER_SIZE - 1) return BlockType.AIR;

    const lx = wx - World.TEXT_START_X;
    const ly = wy - World.TEXT_BASE_Y;
    if (lx < 0 || ly < 0 || ly >= World.LETTER_SIZE) return BlockType.AIR;

    let off = 0;
    for (const ch of World.WORD) {
      if (lx >= off && lx < off + World.LETTER_SIZE) {
        return World.LETTERS[ch][ly][lx - off] ? BlockType.LEAVES : BlockType.AIR;
      }
      off += World.LETTER_SIZE + World.GAP;
    }
    return BlockType.AIR;
  }

  _isInTextZone(cx, cz) {
    const x0 = cx * CHUNK_SIZE, x1 = x0 + 15;
    const z0 = cz * CHUNK_SIZE, z1 = z0 + 15;
    const RX = World.TEXT_FLAT_RADIUS_X;
    const RZ = World.TEXT_FLAT_RADIUS_Z;
    return x1 >= -RX && x0 <= RX && z1 >= -RZ && z0 <= RZ;
  }

  generateChunkData(chunk) {
    if (this.dimension === Dim.NETHER) {
      this._genNether(chunk);
      return;
    }
    if (this.dimension === Dim.END) {
      this._genEnd(chunk);
      return;
    }
    this._genOverworld(chunk);
  }

  _genNether(chunk) {
    const { cx, cz } = chunk;
    const wx0 = cx * CHUNK_SIZE;
    const wz0 = cz * CHUNK_SIZE;
    const FLOOR = 14; // 统一地板高度，方便走门
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = wx0 + lx;
        const wz = wz0 + lz;
        const hNoise = this.noise.fbm(wx * 0.03, wz * 0.03, 3, 2.0, 0.5);
        const h = Math.floor(FLOOR + (hNoise + 1) * 3); // 14~20 缓丘
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let b = BlockType.AIR;
          if (y === 0) b = BlockType.OBSIDIAN;
          else if (y < FLOOR) b = BlockType.NETHERRACK;
          else if (y <= h) b = BlockType.NETHERRACK;
          else if (y >= CHUNK_HEIGHT - 2) b = BlockType.NETHERRACK;
          // 偶发黑曜石柱
          if (b === BlockType.AIR && y < 22 && hash(wx, wz + y * 3) > 0.988) b = BlockType.OBSIDIAN;
          chunk.setBlock(lx, y, lz, b);
        }
      }
    }
    // 中央广场：末地传送台（紫色平台）— 仅 cx=cz=0
    if (cx === 0 && cz === 0) {
      for (let x = 3; x <= 12; x++) {
        for (let z = 3; z <= 12; z++) {
          chunk.setBlock(x, FLOOR, z, BlockType.OBSIDIAN);
          for (let y = FLOOR + 1; y <= FLOOR + 4; y++) {
            chunk.setBlock(x, y, z, BlockType.AIR);
          }
        }
      }
      // 末地门：一圈末地石 + 中间传送门（站上去 → 末地）
      for (let i = 5; i <= 10; i++) {
        chunk.setBlock(i, FLOOR + 1, 5, BlockType.END_STONE);
        chunk.setBlock(i, FLOOR + 1, 10, BlockType.END_STONE);
        chunk.setBlock(5, FLOOR + 1, i, BlockType.END_STONE);
        chunk.setBlock(10, FLOOR + 1, i, BlockType.END_STONE);
      }
      for (let x = 6; x <= 9; x++) {
        for (let z = 6; z <= 9; z++) {
          chunk.setBlock(x, FLOOR + 1, z, BlockType.PORTAL);
        }
      }
    }
  }

  _genEnd(chunk) {
    const { cx, cz } = chunk;
    const wx0 = cx * CHUNK_SIZE;
    const wz0 = cz * CHUNK_SIZE;
    const dist = Math.sqrt(cx * cx + cz * cz);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = wx0 + lx;
        const wz = wz0 + lz;
        const r = Math.sqrt(wx * wx + wz * wz);
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let b = BlockType.AIR;
          // 主岛
          if (r < 28 && y >= 16 && y <= 20) b = BlockType.END_STONE;
          else if (r < 22 && y === 21) b = BlockType.END_STONE;
          // 外圈小岛
          else if (dist > 1 && dist < 4) {
            const island = this.noise.noise2D(wx * 0.08, wz * 0.08);
            if (island > 0.35 && y >= 14 && y <= 17) b = BlockType.END_STONE;
          }
          chunk.setBlock(lx, y, lz, b);
        }
      }
    }
  }

  _genOverworld(chunk) {
    const { cx, cz } = chunk;
    const wx0 = cx * CHUNK_SIZE;
    const wz0 = cz * CHUNK_SIZE;
    const GY = World.TEXT_GROUND_Y;

    // === 文字区域：沙质平地 + 青色立墙 ===
    if (this._isInTextZone(cx, cz)) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const wx = wx0 + lx;
          const wz = wz0 + lz;
          for (let y = 0; y < CHUNK_HEIGHT; y++) {
            let b;
            if (y < GY - 5)              b = BlockType.STONE;
            else if (y < GY)             b = BlockType.DIRT;
            else if (y === GY)           b = BlockType.GRASS;
            else if (y >= World.TEXT_BASE_Y && y <= World.TEXT_BASE_Y + World.LETTER_SIZE - 1) {
              b = this._getTextBlock(wx, y, wz);
            } else                       b = BlockType.AIR;
            // 深层偶有黑曜石
            if (b === BlockType.STONE && y < GY - 8 && hash(wx * 5, wz * 5 + y) > 0.97) {
              b = BlockType.OBSIDIAN;
            }
            chunk.setBlock(lx, y, lz, b);
          }
        }
      }
      return;
    }

    // === 正常地形：噪声生成 ===
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = wx0 + lx;
        const wz = wz0 + lz;

        const scale = 0.02;
        const heightNoise = this.noise.fbm(wx * scale, wz * scale, 4, 2.0, 0.5);
        const height = Math.floor((heightNoise + 1) * 0.5 * 32 + 8);
        const clampedHeight = Math.max(1, Math.min(CHUNK_HEIGHT - 1, height));

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let blockType = BlockType.AIR;

          if (y <= clampedHeight) {
            if (y === clampedHeight) {
              blockType = clampedHeight <= SEA_LEVEL ? BlockType.SAND : BlockType.GRASS;
            } else if (y > clampedHeight - 4) {
              blockType = clampedHeight <= SEA_LEVEL ? BlockType.SAND : BlockType.DIRT;
            } else {
              blockType = BlockType.STONE;
              if (y < clampedHeight - 6) {
                const oreNoise = hash(wx * 3 + y, wz * 7 + y * 2);
                if (oreNoise > 0.97) blockType = BlockType.OBSIDIAN;
                else if (oreNoise > 0.92) blockType = BlockType.COAL_ORE;
                else if (oreNoise > 0.88 && y < clampedHeight - 10) blockType = BlockType.IRON_ORE;
              }
            }
          }

          chunk.setBlock(lx, y, lz, blockType);
        }
      }
    }

    this._generateTrees(chunk);
  }

  /** 在区块中生成树木 */
  _generateTrees(chunk) {
    const { cx, cz } = chunk;
    const wx0 = cx * CHUNK_SIZE;
    const wz0 = cz * CHUNK_SIZE;

    for (let lz = 2; lz < CHUNK_SIZE - 2; lz++) {
      for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
        const wx = wx0 + lx;
        const wz = wz0 + lz;

        const treeVal = this.treeNoise.noise2D(wx * 0.5, wz * 0.5);
        if (treeVal < 0.75) continue;

        let surfaceY = -1;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          if (chunk.getBlock(lx, y, lz) === BlockType.GRASS) {
            surfaceY = y;
            break;
          }
        }
        if (surfaceY < 0 || surfaceY > CHUNK_HEIGHT - 10) continue;

        const trunkHeight = 3 + ((hash(wx, wz) * 3) | 0);
        for (let ty = 1; ty <= trunkHeight; ty++) {
          chunk.setBlock(lx, surfaceY + ty, lz, BlockType.WOOD);
        }

        const canopyY = surfaceY + trunkHeight;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
              const bx = lx + dx;
              const bz = lz + dz;
              if (bx >= 0 && bx < CHUNK_SIZE && bz >= 0 && bz < CHUNK_SIZE) {
                if (chunk.getBlock(bx, canopyY + dy, bz) === BlockType.AIR) {
                  chunk.setBlock(bx, canopyY + dy, bz, BlockType.LEAVES);
                }
              }
            }
          }
        }
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
            const bx = lx + dx;
            const bz = lz + dz;
            if (bx >= 0 && bx < CHUNK_SIZE && bz >= 0 && bz < CHUNK_SIZE) {
              if (chunk.getBlock(bx, canopyY + 2, bz) === BlockType.AIR) {
                chunk.setBlock(bx, canopyY + 2, bz, BlockType.LEAVES);
              }
            }
          }
        }
      }
    }
  }

  update(playerX, playerZ) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);

    const neededChunks = new Set();
    const rd = this.renderDistance;
    for (let dx = -rd; dx <= rd; dx++) {
      for (let dz = -rd; dz <= rd; dz++) {
        if (dx * dx + dz * dz > rd * rd) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = this.chunkKey(cx, cz);
        neededChunks.add(key);

        if (!this.chunks.has(key)) {
          this.pendingChunks.push({ cx, cz, key });
        }
      }
    }

    for (const [key, chunk] of this.chunks) {
      if (!neededChunks.has(key)) {
        if (chunk.mesh) this.scene.remove(chunk.mesh);
        if (chunk.waterMesh) this.scene.remove(chunk.waterMesh);
        chunk.dispose();
        this.chunks.delete(key);
        this._markDirty(chunk.cx-1,chunk.cz);
        this._markDirty(chunk.cx+1,chunk.cz);
        this._markDirty(chunk.cx,chunk.cz-1);
        this._markDirty(chunk.cx,chunk.cz+1);
      }
    }

    const maxPerFrame = 2;
    let processed = 0;
    while (this.pendingChunks.length > 0 && processed < maxPerFrame) {
      const { cx, cz, key } = this.pendingChunks.shift();
      if (this.chunks.has(key)) continue;

      const chunk = new Chunk(cx, cz);
      this.generateChunkData(chunk);
      this.applyEdits(chunk);
      this.configureChunkDecals(chunk);
      chunk.buildMesh((wx, wy, wz) => this.getBlock(wx, wy, wz), this.material, this.waterMaterial);
      this.chunks.set(key, chunk);
      this._markDirty(cx-1,cz);
      this._markDirty(cx+1,cz);
      this._markDirty(cx,cz-1);
      this._markDirty(cx,cz+1);

      if (chunk.mesh) this.scene.add(chunk.mesh);
      if (chunk.waterMesh) this.scene.add(chunk.waterMesh);
      if (chunk.adMesh) this.scene.add(chunk.adMesh);
      processed++;
    }

    let rebuilt = 0;
    for (const [, chunk] of this.chunks) {
      if (chunk.dirty && rebuilt < 2) {
        if (chunk.mesh) this.scene.remove(chunk.mesh);
        if (chunk.waterMesh) this.scene.remove(chunk.waterMesh);
        chunk.buildMesh((wx, wy, wz) => this.getBlock(wx, wy, wz), this.material, this.waterMaterial);
        if (chunk.mesh && !chunk.mesh.parent) this.scene.add(chunk.mesh);
        if (chunk.waterMesh && !chunk.waterMesh.parent) this.scene.add(chunk.waterMesh);
        if (chunk.adMesh && !chunk.adMesh.parent) this.scene.add(chunk.adMesh);
        rebuilt++;
      }
    }
  }

  getSurfaceHeight(wx, wz) {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(wx, y, wz))) {
        return y + 1;
      }
    }
    return SEA_LEVEL;
  }

  get pendingCount() {
    return this.pendingChunks.length;
  }
}
