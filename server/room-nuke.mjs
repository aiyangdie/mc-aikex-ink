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
export function resolveNuke(room,caster,now=Date.now()){
 if(!room||!caster||!Number.isFinite(now)||!caster.active||caster.hp<=0||
   ![...room.peers.values()].includes(caster)||now-(room.lastNukeAt||0)<300_000&&room.lastNukeAt)return null;
 const dimension=caster.dimension||'overworld';
 const origin={x:caster.x,y:caster.y,z:caster.z};
 const edits=craterCells(origin);
 if(!edits.length||!room.terrain.applyBatch(edits,dimension))return null;
 room.lastNukeAt=now;room.terrainRevision++;
 caster.protectedUntil=Math.max(caster.protectedUntil||0,now+3000);
 for(const peer of room.peers.values())if(peer!==caster){peer.hp=0;peer.manualRespawn=true;peer.deadUntil=0;}
 for(const mob of room.mobs.values()){mob.alive=false;mob.hp=0;}
 room.mobs.clear();room.dragonKilled=true;room.boss.kill(now);room.touch();
 return {casterId:caster.id,dimension,origin,sequence:room.terrainRevision,edits};
}
