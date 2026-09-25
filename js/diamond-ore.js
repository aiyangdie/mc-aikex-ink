export const DIAMOND_ORE_ID = 16;

/** Repeatable ore quota and placement, independent of chunk load order. */
function hash(value) {
  let h=2166136261;
  for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}
  return h>>>0;
}
export function selectDiamondOrePositions({seed,cx,cz,solidCount,candidates}) {
  if(!Number.isFinite(solidCount)||solidCount<=0||!Array.isArray(candidates)||!candidates.length)return [];
  const expected=solidCount/500;
  const whole=Math.floor(expected),remainder=expected-whole;
  const quota=Math.min(candidates.length,whole+(hash(`${seed}|${cx}|${cz}|quota`)/2**32<remainder?1:0));
  return candidates.map(p=>({p,score:hash(`${seed}|${p.x}|${p.y}|${p.z}|diamond`)}))
    .sort((a,b)=>a.score-b.score||a.p.y-b.p.y||a.p.z-b.p.z||a.p.x-b.p.x)
    .slice(0,quota).map(({p})=>p);
}
