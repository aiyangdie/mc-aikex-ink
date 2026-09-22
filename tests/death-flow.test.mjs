import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
// Import the game without booting WebGL. Only browser event registration is stubbed.
const elements = new Map();
function element(id){if(!elements.has(id))elements.set(id,{style:{},hidden:true,textContent:'',focus(){}});return elements.get(id);}
globalThis.window={addEventListener(){}};
globalThis.document={getElementById:element,exitPointerLock(){this.pointerLockElement=null;}};
const module=await import('../js/game.js');
const Game=module.Game;
function setup(){
  const g=Object.create(Game.prototype);
  Object.assign(g,{_dead:false,isRunning:true,isPointerLocked:true,dimension:'overworld',_respawnPoint:new THREE.Vector3(5,19,20),
    player:{hp:0,maxHp:20,position:new THREE.Vector3(1,19,2),velocity:new THREE.Vector3(1,2,3),keys:{KeyW:true},eyeHeight:1.6,invuln:0},
    camera:{position:new THREE.Vector3()},ui:{pauseScreen:element('pauseScreen')},
    _showGameUI(){},_updateHpHud(){},_updateBossHud(){},_persist(){},_requestLock(){},
    world:{getBlock:(x,y,z)=>y<=18?3:0}});
  return g;
}
test('death does not auto-heal or respawn and blocks play until respawn',()=>{
  assert.ok(Game?.prototype._showDeathScreen,'explicit death flow missing');
  const g=setup();g._showDeathScreen();
  assert.equal(g.player.hp,0);assert.equal(g._dead,true);assert.equal(g.isRunning,false);
  assert.equal(g.player.position.x,1);assert.equal(element('deathScreen').hidden,false);
  assert.deepEqual(g.player.keys,{});
});
test('respawn restores full HP, clears movement and gives grace period',()=>{
  assert.ok(Game?.prototype._respawnPlayer,'explicit respawn flow missing');
  const g=setup();g._showDeathScreen();g._respawnPlayer();
  assert.equal(g.player.hp,20);assert.equal(g._dead,false);assert.equal(g.isRunning,true);
  assert.equal(g.player.position.x,5);assert.equal(g.player.velocity.length(),0);
  assert.equal(g.player.invuln,3);assert.equal(element('deathScreen').hidden,true);
});
test('non-Boss zero-HP vitals cannot trap PvP auto-respawn in manual death screen',()=>{
 const g=setup(),handlers={};g._online=true;
 g.net={on:(name,fn)=>handlers[name]=fn,_send(){}};
 g._bindNet();
 handlers.vitals({hp:0});assert.equal(g._dead,false);
 handlers.vitals({hp:0,cause:'mist-boss'});assert.equal(g._dead,true);
});
