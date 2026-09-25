/** Bounded spherical crater, room-authoritative and applied only after capacity preflight. */
export function craterCells(origin,radius=12,height=48){
 if(!origin||![origin.x,origin.y,origin.z].every(Number.isFinite))return [];
 const cells=[];
 const cx=Math.floor(origin.x),cy=Math.floor(origin.y),cz=Math.floor(origin.z);
 for(let x=Math.max(-4096,cx-radius);x<=Math.min(4096,cx+radius);x++)
 for(let z=Math.max(-4096,cz-radius);z<=Math.min(4096,cz+radius);z++)
 for(let y=Math.max(0,cy-radius);y<=Math.min(height-1,cy+radius);y++)
  if((x-origin.x)**2+(z-origin.z)**2+(y-origin.y)**2<=radius**2)cells.push([x,y,z,0]);
 return cells;
}
export function validNukeOrigin(origin){
 return origin&&[origin.x,origin.y,origin.z].every(Number.isFinite)&&
  Math.abs(origin.x)<=4096&&Math.abs(origin.z)<=4096&&origin.y>=0&&origin.y<48;
}
// Internal settlement API: impact comes from server simulation, never a network payload.
export function resolveNuke(room,caster,now=Date.now(),impact){
 if(!room||!caster||!Number.isFinite(now)||!impact||
   !['overworld','nether','end'].includes(impact.dimension)||!validNukeOrigin(impact.origin))return null;
 const pending=room.nukeProjectile;
 const reserved=pending&&pending.ownerId===caster.id&&pending.startedAt===room.lastNukeAt;
 if(!reserved&&(!caster.active||!(caster.hp>0)||![...room.peers.values()].includes(caster)||
   (room.lastNukeAt&&now-room.lastNukeAt<300_000)))return null;
 const dimension=impact.dimension,origin={...impact.origin};
 const edits=craterCells(origin);
 if(!edits.length||!room.terrain.applyBatch(edits,dimension))return null;
 if(!reserved)room.lastNukeAt=now;
 room.terrainRevision++;
 for(const peer of room.peers.values()){
  if(peer.id===caster.id)peer.protectedUntil=Math.max(peer.protectedUntil||0,now+3000);
  else {peer.hp=0;peer.manualRespawn=true;peer.deadUntil=0;}
 }
 for(const mob of room.mobs.values()){mob.alive=false;mob.hp=0;}
 room.mobs.clear();room.dragonKilled=true;room.boss.kill(now);room.touch();
 return {casterId:caster.id,dimension,origin,sequence:room.terrainRevision,edits};
}
