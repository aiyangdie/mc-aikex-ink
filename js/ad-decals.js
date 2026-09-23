/** Deterministic, visual adverts attached to exposed voxel faces. */
import * as THREE from 'three';

export const AD_TEXT = '激情大戏：spb.biily.top';
export const AD_MAX_PER_CHUNK = 3;
const ELIGIBLE = new Set([1, 2, 3, 4, 11, 12, 14, 15]);
const FACES = [[0,1,0],[0,0,1],[0,0,-1],[1,0,0],[-1,0,0]];

function hash(value) {
  let h = 2166136261;
  for (let i=0;i<value.length;i++) { h ^= value.charCodeAt(i); h = Math.imul(h,16777619); }
  return h >>> 0;
}

/** Coordinates and face are world-space; selection needs no DOM. */
export function selectAdDecals({seed,dimension,cx,cz,getBlock,maxPerChunk=AD_MAX_PER_CHUNK}) {
  const candidates=[];
  const x0=cx*16,z0=cz*16;
  for(let y=1;y<48;y++) for(let z=z0;z<z0+16;z++) for(let x=x0;x<x0+16;x++) {
    if(!ELIGIBLE.has(getBlock(x,y,z))) continue;
    const score=hash(String(seed)+'|'+dimension+'|'+x+'|'+y+'|'+z);
    if(score % 103 > 2) continue;
    for(const face of FACES) {
      const neighbor=getBlock(x+face[0],y+face[1],z+face[2]);
      if(neighbor!==0 && neighbor!==7 && neighbor!==13) continue;
      candidates.push({x,y,z,face,score:hash(String(score)+'|'+face.join(','))});
      break;
    }
  }
  candidates.sort((a,b)=>a.score-b.score || a.y-b.y || a.z-b.z || a.x-b.x);
  return candidates.slice(0,Math.max(0,Math.min(AD_MAX_PER_CHUNK,maxPerChunk))).map(({score,...ad})=>ad);
}

/** One high-resolution texture shared by all chunks in a World. */
export function createAdTexture() {
  const canvas=document.createElement('canvas');
  canvas.width=1024;canvas.height=512;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#111b25';ctx.fillRect(0,0,1024,512);
  ctx.strokeStyle='#ffd05a';ctx.lineWidth=18;ctx.strokeRect(16,16,992,480);
  ctx.fillStyle='#ffd05a';ctx.fillRect(36,36,952,8);
  ctx.textAlign='center';ctx.textBaseline='middle';
  const [headline,domain]=AD_TEXT.split('：');
  ctx.fillStyle='#fff8df';
  ctx.font='bold 122px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(headline+'：',512,195,920);
  ctx.fillStyle='#ffd05a';
  ctx.font='bold 83px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(domain,512,360,940);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.magFilter=THREE.NearestFilter;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;
  return texture;
}
