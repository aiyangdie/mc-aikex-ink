import test from 'node:test';
import assert from 'node:assert/strict';
let RoomBoss, CollisionWorld;
try {({RoomBoss,CollisionWorld}=await import('../server/room-boss.mjs'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const flat={getBlock:(x,y,z)=>y<=18?3:0};
const peer=(id,x=0,z=1)=>({id,x,y:19,z,hp:20,active:true,dimension:'overworld',invuln:0,lastBossHit:-Infinity});
test('all players hit one shared Boss; range, cadence and dimension enforced',()=>{
 assert.ok(RoomBoss,'authoritative room Boss is missing');
 const b=new RoomBoss(flat,{x:0,y:19,z:0}); const a=peer('a'), c=peer('b');
 assert.equal(b.hit(a,1000),true);assert.equal(b.hit(c,1000),true);assert.equal(b.hp,1490);
 assert.equal(b.hit(a,1100),false);assert.equal(b.hit(peer('far',30),1200),false);
 assert.equal(b.hit({...peer('nether'),dimension:'nether'},1300),false);
 assert.equal(b.hp,1490);
});
test('only nearest living active player takes four 5-HP hits; no extra damage after death',()=>{
 assert.ok(RoomBoss,'authoritative room Boss is missing');
 const b=new RoomBoss(flat,{x:0,y:19,z:0});const a=peer('a'),c=peer('b',0,30), lobby=peer('lobby',0,.1);lobby.active=false;
 const events=[];for(let i=0;i<110;i++)events.push(...b.tick(.05,[a,c,lobby]));
 assert.equal(a.hp,0);assert.equal(c.hp,20);assert.equal(lobby.hp,20);
 assert.deepEqual(events.filter(e=>e.id==='a').map(e=>e.hp),[15,10,5,0]);
});
test('snapshot roundtrip preserves wounds and defeat instead of respawning on rejoin',()=>{
 assert.ok(RoomBoss,'authoritative room Boss is missing');
 const b=new RoomBoss(flat,{x:0,y:19,z:0});b.hit(peer('a'),1000);
 const resumed=new RoomBoss(flat,b.snapshot());assert.equal(resumed.hp,1495);
 resumed.combat.takeDamage(1495);
 const dead=new RoomBoss(flat,resumed.snapshot());assert.equal(dead.hp,0);assert.equal(dead.hit(peer('a'),2000),false);
 assert.deepEqual(dead.tick(.05,[peer('a')]),[]);
});
test('server uses real world terrain and respects newly edited walls',()=>{
 assert.ok(CollisionWorld,'server collision world is missing');
 const edits=new Map(),w=new CollisionWorld(12345,edits);
 assert.equal(w.getBlock(5,18,8),1);assert.equal(w.getBlock(5,19,8),0);
 edits.set('5,19,8',3);assert.equal(w.getBlock(5,19,8),3);
 edits.set('5,19,8',0);assert.equal(w.getBlock(5,19,8),0);
});
test('Boss respects PvP respawn protection and marks lethal damage as manual respawn',()=>{
 const b=new RoomBoss(flat,{x:0,y:19,z:0}),p=peer('a');p.protectedUntil=Date.now()+10000;
 for(let i=0;i<40;i++)b.tick(.05,[p]);assert.equal(p.hp,20);
 p.protectedUntil=0;p.hp=5;
 for(let i=0;i<40;i++)b.tick(.05,[p]);assert.equal(p.hp,0);assert.equal(p.manualRespawn,true);
});
test('AK ray can hit Boss but not through world terrain or from another dimension',()=>{
 const b=new RoomBoss(flat,{x:0,y:19,z:0}),p=peer('a',0,10),shot={direction:[0,0,-1],distance:80};
 assert.ok(b.rayDistance,'Boss ray intersection missing');
 assert.ok(b.rayDistance(p,shot)<10);
 assert.equal(b.rayDistance({...p,dimension:'nether'},shot),Infinity);
 const wall={getBlock:(x,y,z)=>y<=18||(z===5&&y<=22)?3:0};
 assert.equal(new RoomBoss(wall,{x:0,y:19,z:0}).rayDistance(p,shot),Infinity);
});
test('dead Boss revives after 60 seconds, including after snapshot restart',()=>{
 const b=new RoomBoss(flat,{x:0,y:19,z:0});
 b.kill(1000);
 assert.equal(b.hp,0);assert.equal(b.snapshot().respawnAt,61000);
 const restarted=new RoomBoss(flat,b.snapshot());
 assert.equal(restarted.maybeRespawn(60999),false);
 assert.equal(restarted.maybeRespawn(61000),true);
 assert.equal(restarted.hp,1500);assert.equal(restarted.snapshot().respawnAt,null);
 assert.equal(restarted.maybeRespawn(61001),false);
});
