/**
 * 传送门几何自检（node scripts/check-portal.mjs）
 * 失败则 exit 1
 */
function frameBlocks(axis, ox, oy, oz) {
  const cells = [];
  if (axis === 'x') {
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x <= 3; x++) {
        const isEdge = y === 0 || y === 4 || x === 0 || x === 3;
        cells.push([ox + x, oy + y, oz, isEdge]);
      }
    }
  }
  return cells;
}

const cells = frameBlocks('x', 6, 18, 4);
const edges = cells.filter((c) => c[3]);
const inner = cells.filter((c) => !c[3]);
if (edges.length !== 14) throw new Error(`edge count ${edges.length} != 14`);
if (inner.length !== 6) throw new Error(`inner count ${inner.length} != 6`);
// 内芯应在 y=19..21, x=7..8, z=4
for (const [x, y, z] of inner) {
  if (z !== 4 || y < 19 || y > 21 || x < 7 || x > 8) {
    throw new Error(`bad inner ${x},${y},${z}`);
  }
}
console.log('portal geometry OK', { edges: edges.length, inner: inner.length });
