/**
 * 传送门：黑曜石框 + 紫色内芯（可穿过）
 * 框规格（简化 MC）：内空宽 2、高 3；外圈黑曜石
 */
import { BlockType } from './voxel.js?v=mistboss4';

/** 在准星附近尝试点燃传送门，成功返回 {axis,x,y,z} */
export function tryLightPortal(world, tx, ty, tz) {
  for (const axis of ['x', 'z']) {
    for (let dy = -4; dy <= 1; dy++) {
      for (let d = -3; d <= 0; d++) {
        const ox = axis === 'x' ? tx + d : tx;
        const oz = axis === 'z' ? tz + d : tz;
        const oy = ty + dy;
        if (isValidFrame(world, axis, ox, oy, oz)) {
          fillPortal(world, axis, ox, oy, oz);
          return { axis, x: ox, y: oy, z: oz };
        }
      }
    }
  }
  return null;
}

function frameBlocks(axis, ox, oy, oz) {
  const cells = [];
  if (axis === 'x') {
    // 门面朝 ±Z：沿 X 宽、Y 高，固定 Z
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x <= 3; x++) {
        const isEdge = y === 0 || y === 4 || x === 0 || x === 3;
        cells.push([ox + x, oy + y, oz, isEdge]);
      }
    }
  } else {
    for (let y = 0; y <= 4; y++) {
      for (let z = 0; z <= 3; z++) {
        const isEdge = y === 0 || y === 4 || z === 0 || z === 3;
        cells.push([ox, oy + y, oz + z, isEdge]);
      }
    }
  }
  return cells;
}

function isValidFrame(world, axis, ox, oy, oz) {
  for (const [x, y, z, isEdge] of frameBlocks(axis, ox, oy, oz)) {
    const b = world.getBlock(x, y, z);
    if (isEdge) {
      if (b !== BlockType.OBSIDIAN) return false;
    } else if (b !== BlockType.AIR && b !== BlockType.PORTAL) {
      return false;
    }
  }
  return true;
}

function fillPortal(world, axis, ox, oy, oz) {
  for (const [x, y, z, isEdge] of frameBlocks(axis, ox, oy, oz)) {
    if (!isEdge) world.setBlock(x, y, z, BlockType.PORTAL);
  }
}

/**
 * 身体多个采样点是否在紫色门内（避免只踩到边缘判失败）
 */
export function standingInPortal(world, px, py, pz) {
  const samples = [
    [0, 0.1, 0], [0, 0.9, 0], [0, 1.4, 0],
    [0.25, 0.5, 0], [-0.25, 0.5, 0],
    [0, 0.5, 0.25], [0, 0.5, -0.25],
  ];
  for (const [dx, dy, dz] of samples) {
    const bx = Math.floor(px + dx);
    const by = Math.floor(py + dy);
    const bz = Math.floor(pz + dz);
    if (world.getBlock(bx, by, bz) === BlockType.PORTAL) return true;
  }
  return false;
}

/**
 * 在地面上建造已点燃地狱门，并清出前后通道
 * @returns {{x,y,z,axis}} 建议站立/出口坐标（门内中心）
 */
export function spawnReturnPortal(world, cx, cy, cz, axis = 'x') {
  const ox = Math.floor(cx) - 1;
  const oy = Math.floor(cy);
  const oz = Math.floor(cz);
  const dim = world.dimension || 'overworld';
  const floor =
    dim === 'nether' ? BlockType.NETHERRACK
      : dim === 'end' ? BlockType.END_STONE
        : BlockType.GRASS;

  // 门框下方铺实心，避免悬空
  if (axis === 'x') {
    for (let x = ox; x <= ox + 3; x++) {
      world.setBlock(x, oy, oz, BlockType.OBSIDIAN);
      for (let y = oy + 1; y <= oy + 4; y++) {
        world.setBlock(x, y, oz, BlockType.AIR);
      }
    }
  } else {
    for (let z = oz; z <= oz + 3; z++) {
      world.setBlock(ox, oy, z, BlockType.OBSIDIAN);
      for (let y = oy + 1; y <= oy + 4; y++) {
        world.setBlock(ox, y, z, BlockType.AIR);
      }
    }
  }

  for (const [x, y, z, isEdge] of frameBlocks(axis, ox, oy, oz)) {
    world.setBlock(x, y, z, isEdge ? BlockType.OBSIDIAN : BlockType.PORTAL);
  }

  // 清出前后 2 格通道，玩家能走进紫色
  if (axis === 'x') {
    for (const dz of [-2, -1, 1, 2]) {
      for (let x = ox + 1; x <= ox + 2; x++) {
        for (let y = oy + 1; y <= oy + 3; y++) {
          world.setBlock(x, y, oz + dz, BlockType.AIR);
        }
        world.setBlock(x, oy, oz + dz, floor);
      }
    }
    return { x: ox + 1.5, y: oy + 1, z: oz + 0.5, axis };
  }

  for (const dx of [-2, -1, 1, 2]) {
    for (let z = oz + 1; z <= oz + 2; z++) {
      for (let y = oy + 1; y <= oy + 3; y++) {
        world.setBlock(ox + dx, y, z, BlockType.AIR);
      }
      world.setBlock(ox + dx, oy, z, floor);
    }
  }
  return { x: ox + 0.5, y: oy + 1, z: oz + 1.5, axis };
}
