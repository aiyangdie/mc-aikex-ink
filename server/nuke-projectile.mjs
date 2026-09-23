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
export function stepNukeProjectile(room,p,dt,now=Date.now()){
 if(!p||room.nukeProjectile!==p||!Number.isFinite(dt)||dt<=0||!Number.isFinite(now)||now<p.startedAt)return null;
 const world=collisionFor(room,p.dimension);
 // Small time slices bound movement below a voxel, including delayed ticks.
 let remaining=Math.min(dt,MAX_SECONDS-p.elapsed);
 while(remaining>1e-9){
  const h=Math.min(remaining,.005);
  const next={x:p.x+p.vx*h,y:p.y+p.vy*h-GRAVITY*h*h/2,z:p.z+p.vz*h};
  if(!validNukeOrigin(next))return settle(room,p,now);
  Object.assign(p,next);p.vy-=GRAVITY*h;p.elapsed+=h;remaining-=h;
  if(isSolid(world.getBlock(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))))return settle(room,p,now);
 }
 if(p.elapsed>=MAX_SECONDS-1e-9||now-p.startedAt>=MAX_SECONDS*1000)return settle(room,p,now);
 return {status:'flying'};
}
