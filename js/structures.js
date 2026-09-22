/**
 * 管理结构预设：地狱门 / 小木屋 / 末地平台
 */
import { BlockType } from './voxel.js?v=animalfix8';
import { spawnReturnPortal } from './portals.js?v=animalfix8';

export function buildStructure(world, id, cx, cy, cz) {
  const x = Math.floor(cx);
  const y = Math.floor(cy);
  const z = Math.floor(cz);
  if (id === 'nether_portal') {
    spawnReturnPortal(world, x, y, z, 'x');
    return true;
  }
  if (id === 'cabin') {
    // 5x5 木板小屋 + 屋顶
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        world.setBlock(x + dx, y, z + dz, BlockType.PLANKS);
        if (dx === 0 || dx === 4 || dz === 0 || dz === 4) {
          world.setBlock(x + dx, y + 1, z + dz, BlockType.PLANKS);
          world.setBlock(x + dx, y + 2, z + dz, BlockType.PLANKS);
        }
        world.setBlock(x + dx, y + 3, z + dz, BlockType.WOOD);
      }
    }
    // 门洞
    world.setBlock(x + 2, y + 1, z, BlockType.AIR);
    world.setBlock(x + 2, y + 2, z, BlockType.AIR);
    return true;
  }
  if (id === 'end_pad') {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        world.setBlock(x + dx, y, z + dz, BlockType.END_STONE);
      }
    }
    return true;
  }
  return false;
}
