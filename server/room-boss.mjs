import {World,Chunk,CHUNK_SIZE,CHUNK_HEIGHT,isSolid} from '../js/voxel.js';
import {BossCombat} from '../js/boss-combat.js';
import {findStandY,findGroundStep,hasLineOfSight} from '../js/boss-navigation.js';

// Reuse the actual generator, without WebGL/DOM. Cache only nearby base chunks;
// edits are read on every query so placed walls immediately affect pursuit/hits.
export class CollisionWorld {
  constructor(seed,edits) { this.base=new World(null,seed); this.edits=edits; }
  getBlock(x,y,z) {
    if(y<0||y>=CHUNK_HEIGHT||Math.abs(x)>4096||Math.abs(z)>4096)return 0;
    const key=`${x},${y},${z}`;
    if(this.edits.has(key))return this.edits.get(key);
    const cx=Math.floor(x/CHUNK_SIZE),cz=Math.floor(z/CHUNK_SIZE),ck=this.base.chunkKey(cx,cz);
    if(!this.base.chunks.has(ck)) {
      const chunk=new Chunk(cx,cz);this.base.generateChunkData(chunk);
      if(this.base.chunks.size>=64)this.base.chunks.delete(this.base.chunks.keys().next().value);
      this.base.chunks.set(ck,chunk);
    }
    return this.base.getBlock(x,y,z);
  }
  spawn(x=5.4,z=14.5) {
    for(let radius=0;radius<=8;radius++)for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
      for(let y=CHUNK_HEIGHT-3;y>0;y--){
        const stand=findStandY(this,x+dx,z+dz,y);
        if(stand!==null)return {x:x+dx,y:stand+.05,z:z+dz};
      }
    }
    return {x:5.4,y:19.05,z:14.5};
  }
}

export class RoomBoss {
  constructor(world,saved={x:5.4,y:19,z:5.5}) {
    this.world=world;
    this.position={x:saved.x,y:saved.y,z:saved.z};
    this.spawnPosition={...(saved.spawnPosition || this.position)};
    this.respawnAt=Number.isFinite(saved.respawnAt)?saved.respawnAt:
      saved.hp===0?Date.now()+60_000:null;
    this.combat=new BossCombat(saved.hp);
    this.yaw=saved.yaw||0;
    this.attackId=0;
    this.targetId=null;
  }
  get hp(){return this.combat.hp;}
  kill(now=Date.now()){
    if(this.respawnAt!==null)return false;
    this.combat.takeDamage(this.hp);
    if(!this.combat.dead)return false;
    this.respawnAt=now+60_000;return true;
  }
  maybeRespawn(now=Date.now()){
    if(!this.combat.dead||this.respawnAt===null||now<this.respawnAt)return false;
    this.combat=new BossCombat();this.position={...this.spawnPosition};
    this.respawnAt=null;this.targetId=null;this.attackId=0;return true;
  }
  eligible(p){return p.active&&p.hp>0&&p.dimension==='overworld';}
  hit(peer,now=Date.now()) {
    if(this.combat.dead||!this.eligible(peer)||now-(peer.lastBossHit??-Infinity)<350)return false;
    if(Math.hypot(peer.x-this.position.x,peer.y-this.position.y,peer.z-this.position.z)>7)return false;
    if(!hasLineOfSight(this.world,peer,this.position))return false;
    peer.lastBossHit=now;this.combat.takeDamage(5);if(this.combat.dead)this.kill(now);return true;
  }
  rayDistance(peer,msg) {
    const d=msg.direction;
    if(this.combat.dead||!this.eligible(peer)||!Array.isArray(d)||d.length!==3||!d.every(Number.isFinite)||!Number.isFinite(msg.distance))return Infinity;
    if(Math.abs(Math.hypot(...d)-1)>.01)return Infinity;
    const o=[peer.x,peer.y+1.62,peer.z],b=this.position;
    const lo=[b.x-.5,b.y,b.z-.5],hi=[b.x+.5,b.y+2.1,b.z+.5];
    let near=0,far=Math.min(80,Math.max(0,msg.distance));
    for(let i=0;i<3;i++) {
      if(Math.abs(d[i])<1e-8){if(o[i]<lo[i]||o[i]>hi[i])return Infinity;}
      else {const a=(lo[i]-o[i])/d[i],z=(hi[i]-o[i])/d[i];near=Math.max(near,Math.min(a,z));far=Math.min(far,Math.max(a,z));}
    }
    if(near>far)return Infinity;
    for(let t=0;t<near;t+=.1)if(isSolid(this.world.getBlock(Math.floor(o[0]+d[0]*t),Math.floor(o[1]+d[1]*t),Math.floor(o[2]+d[2]*t))))return Infinity;
    return near;
  }
  tick(dt,peers) {
    const events=[];
    for(const p of peers)p.invuln=Math.max(0,(p.invuln||0)-dt);
    if(this.combat.dead)return events;
    let target;
    if(this.combat.state==='attack')target=peers.find(p=>p.id===this.targetId&&this.eligible(p));
    else {
      let nearest=32;
      for(const p of peers) {
        if(!this.eligible(p))continue;
        const d=Math.hypot(p.x-this.position.x,p.z-this.position.z);
        if(d<nearest&&hasLineOfSight(this.world,this.position,p)){target=p;nearest=d;}
      }
    }
    if(!target){this.combat.step(dt,{playerAlive:false});return events;}
    const dx=target.x-this.position.x,dz=target.z-this.position.z;
    const result=this.combat.step(dt,{distance:Math.hypot(dx,dz),height:target.y-this.position.y,
      visible:hasLineOfSight(this.world,this.position,target),playerAlive:true,invulnerable:target.invuln>0||Date.now()<(target.protectedUntil||0)});
    if(this.combat.state!=='attack'||result.attackStarted)this.yaw=Math.atan2(dx,dz);
    if(result.attackStarted){this.attackId++;this.targetId=target.id;}
    if(result.move){
      const step=findGroundStep(this.world,this.position,target,{step:3.4*Math.min(dt,.05),maxStep:1.05});
      if(step) this.position={x:step.x,y:step.y,z:step.z};
    }
    if(result.hit){target.hp=Math.max(0,target.hp-result.hit);target.invuln=.6;if(!target.hp)target.manualRespawn=true;events.push({id:target.id,hp:target.hp,damage:result.hit,cause:'mist-boss'});}
    return events;
  }
  snapshot(){return {id:'mist-boss',kind:'mist-boss',...this.position,yaw:this.yaw,hp:this.hp,maxHp:1500,
    state:this.combat.state,attackId:this.attackId,attackTime:this.combat.attackTime,targetId:this.targetId,
    spawnPosition:this.spawnPosition,respawnAt:this.respawnAt};}
}
