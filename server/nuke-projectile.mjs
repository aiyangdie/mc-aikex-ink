import {isSolid} from '../js/voxel.js';
import {CollisionWorld} from './room-boss.mjs';
import {resolveNuke,validNukeOrigin} from './room-nuke.mjs';
const SPEED=18,GRAVITY=16,MAX_SECONDS=3;
let nextId=0;
const worlds=new WeakMap();
function collisionFor(room,dimension){
 let cache=worlds.get(room);
 if(!cache){cache=new Map();worlds.set(room,cache);}
 const edits=room.terrain.getEdits(dimension);
 if(cache.get(dimension)?.edits!==edits)cache.set(dimension,new CollisionWorld(room.seed,edits,dimension));
 return cache.get(dimension);
}
export function beginNukeThrow(room,peer,now=Date.now()){
 if(!room||!peer||!Number.isFinite(now)||!peer.active||!(peer.hp>0)||!peer.nukeUnlocked||
  ![...room.peers.values()].includes(peer)||room.nukeProjectile||
  (room.lastNukeAt&&now-room.lastNukeAt<300_000)||!validNukeOrigin(peer)||
  ![peer.yaw,peer.pitch].every(Number.isFinite)||!['overworld','nether','end'].includes(peer.dimension))return null;
 const pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,peer.pitch));
 const p={id:`nuke-${++nextId}`,ownerId:peer.id,dimension:peer.dimension,
  x:peer.x,y:Math.min(47.999,peer.y+1.5),z:peer.z,
  vx:-Math.sin(peer.yaw)*Math.cos(pitch)*SPEED||0,vy:Math.sin(pitch)*SPEED||0,
  vz:-Math.cos(peer.yaw)*Math.cos(pitch)*SPEED||0,
  startedAt:now,elapsed:0,previousNukeAt:room.lastNukeAt};
 room.nukeProjectile=p;room.lastNukeAt=now;room.touch();
 return p;
}
function settle(room,p,now){
 const event=resolveNuke(room,{id:p.ownerId},now,{dimension:p.dimension,origin:{x:p.x,y:p.y,z:p.z}});
 if(!event){room.lastNukeAt=p.previousNukeAt;room.touch();}
 room.nukeProjectile=null;
 return event?{status:'impact',event}:{status:'rejected',reason:'terrain-rejected'};
}
// Traverse every voxel intersected by the segment, including its initial cell.
// Endpoint sampling alone misses segments clipping a voxel near an edge/corner.
function firstSolidOnSegment(world,start,end){
 const axes=['x','y','z'],delta=axes.map(a=>end[a]-start[a]);
 const cell=axes.map(a=>Math.floor(start[a]));
 const step=delta.map(Math.sign);
 const stride=delta.map(d=>d===0?Infinity:1/Math.abs(d));
 const crossing=axes.map((a,i)=>delta[i]===0?Infinity:
  (cell[i]+(step[i]>0?1:0)-start[a])/delta[i]);
 let t=0;
 while(t<=1){
  if(isSolid(world.getBlock(...cell))){
   if(t===0)return {x:start.x,y:start.y,z:start.z};
   // Nudge a boundary hit into its solid cell for stable floor-based consumers.
   return Object.fromEntries(axes.map((a,i)=>[a,
    Math.max(cell[i]+1e-9,Math.min(cell[i]+1-1e-9,start[a]+delta[i]*t))]));
  }
  t=Math.min(...crossing);
  if(t>1)break;
  // Tied crossings enter the diagonal cell directly, not zero-length side cells.
  for(let i=0;i<3;i++)if(crossing[i]===t){cell[i]+=step[i];crossing[i]+=stride[i];}
 }
 return null;
}
export function stepNukeProjectile(room,p,dt,now=Date.now()){
 if(!p||room.nukeProjectile!==p||!Number.isFinite(dt)||dt<=0||!Number.isFinite(now)||now<p.startedAt)return null;
 const world=collisionFor(room,p.dimension);
 // Small slices approximate the ballistic curve; DDA sweeps each entire segment.
 let remaining=Math.min(dt,MAX_SECONDS-p.elapsed);
 while(remaining>1e-9){
  const h=Math.min(remaining,.005);
  const next={x:p.x+p.vx*h,y:p.y+p.vy*h-GRAVITY*h*h/2,z:p.z+p.vz*h};
  const hit=firstSolidOnSegment(world,p,next);
  if(hit){Object.assign(p,hit);return settle(room,p,now);}
  if(!validNukeOrigin(next))return settle(room,p,now);
  Object.assign(p,next);p.vy-=GRAVITY*h;p.elapsed+=h;remaining-=h;
 }
 if(p.elapsed>=MAX_SECONDS-1e-9||now-p.startedAt>=MAX_SECONDS*1000)return settle(room,p,now);
 return {status:'flying'};
}
