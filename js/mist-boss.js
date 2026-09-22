import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BossCombat } from './boss-combat.js';
import { findStandY, hasLineOfSight } from './boss-navigation.js';

/** The original Mist Archives heroine rig, with an added local sword animation. */
export class MistBoss {
  constructor(scene, world, position, hp = 1500) {
    this.scene = scene;
    this.world = world;
    this.kind = 'mist-boss';
    this.position = new THREE.Vector3(position.x, position.y, position.z);
    this.combat = new BossCombat(hp);
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    scene.add(this.group);
    this.ready = false;
    this.disposed = false;
    this.hurtTimer = 0;
    this.actions = {};
    this.materials = [];
  }
  get hp() { return this.combat.hp; }
  get maxHp() { return this.combat.maxHp; }
  get dead() { return this.combat.dead; }

  async load() {
    const gltf = await new GLTFLoader().loadAsync(new URL('../assets/models/mist-heroine.glb', import.meta.url).href);
    this.installModel(gltf);
    if (this.disposed) this.dispose(); // navigation/session changed while loading
  }

  installModel(gltf) {
    this.model = gltf.scene;
    this.group.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const idle = gltf.animations.find(a => a.name === 'idle');
    const run = gltf.animations.find(a => a.name === 'run');
    if (!idle || !run) throw new Error('主人公模型缺少 idle/run 动画');
    this.actions.idle = this.mixer.clipAction(idle);
    this.actions.run = this.mixer.clipAction(run);
    this.actions.idle.play();
    this.mixer.update(0);
    this.model.rotation.y = -Math.PI / 2; // source faces -X; actor forward is +Z
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 2.1 / size.y;
    this.model.scale.multiplyScalar(scale);
    const center = bounds.getCenter(new THREE.Vector3());
    // The source scene includes authoring offsets; center the rendered rig on
    // its collision body without changing the user's chosen facing direction.
    this.model.position.x -= (center.x - this.group.position.x) * scale;
    this.model.position.z -= (center.z - this.group.position.z) * scale;
    this.model.position.y -= (bounds.min.y - this.group.position.y) * scale;
    // GLB 的原点和视觉脚底不完全一致，缩放后再做一次世界坐标对齐。
    this.group.updateMatrixWorld(true);
    const grounded = new THREE.Box3().setFromObject(this.model);
    this.model.position.y += this.group.position.y - grounded.min.y;
    this.group.updateMatrixWorld(true);
    const bone = name => {
      let result;
      this.model.traverse(o => { if (o.isBone && o.name.replace(/[^a-zA-Z0-9]/g,'') === name) result = o; });
      return result;
    };
    const arm = bone('upperarmR'), forearm = bone('forearmR'), hand = bone('handR');
    if (!arm || !forearm || !hand) throw new Error('主人公模型缺少右臂骨骼');

    // Hold the existing idle pose while the two real arm bones execute a swing.
    const tracks = idle.tracks.map(track => {
      const copy = track.clone(), stride = track.getValueSize();
      copy.times = new Float32Array([0, .8]);
      copy.values = new Float32Array([...track.values.slice(0,stride), ...track.values.slice(0,stride)]);
      return copy;
    });
    for (const [joint, poses] of [
      [arm, [[0,0,0],[-1.8,0,-.45],[.7,0,.3],[0,0,0]]],
      [forearm, [[0,0,0],[-.7,0,0],[.2,0,0],[0,0,0]]],
    ]) {
      const track = tracks.find(t => t.name === `${joint.name}.quaternion`);
      const base = track ? new THREE.Quaternion().fromArray(track.values) : joint.quaternion.clone();
      const values = poses.flatMap(p => base.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p))).toArray());
      const added = new THREE.QuaternionKeyframeTrack(`${joint.name}.quaternion`,[0,.25,.4,.8],values);
      if (track) tracks[tracks.indexOf(track)] = added; else tracks.push(added);
    }
    this.actions.slash = this.mixer.clipAction(new THREE.AnimationClip('slash',.8,tracks));
    this.actions.slash.setLoop(THREE.LoopOnce,1);
    this.actions.slash.clampWhenFinished = true;
    this.currentAction = this.actions.idle;

    this.sword = new THREE.Group();
    this.sword.name = 'BossSword';
    const steel = new THREE.MeshStandardMaterial({color:0xdbe5ed,metalness:.65,roughness:.35});
    const grip = new THREE.Mesh(new THREE.BoxGeometry(.045,.16,.045),new THREE.MeshStandardMaterial({color:0x342624}));
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.075,.7,.025),steel);
    blade.position.y = .42;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(.22,.035,.055),steel);
    guard.position.y = .075;
    this.sword.add(grip,blade,guard);
    hand.add(this.sword);
    this.model.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false; // animated skirts/limbs leave the bind-pose bounds
        for (const mat of [].concat(o.material || [])) if (mat.emissive) {
          this.materials.push({mat, emissive:mat.emissive.clone()});
        }
      }
    });
    this.ready = true;
    if (this._netState) this.applyNetState(this._netState);
  }

  play(name, restart = false) {
    const next = this.actions[name];
    if (!next || (next === this.currentAction && !restart)) return;
    this.currentAction?.fadeOut(.12);
    next.reset().setEffectiveWeight(1).fadeIn(.12).play();
    this.currentAction = next;
  }

  hitDistance(origin, direction, maxDistance) {
    if (!this.ready || this.dead || this.disposed) return Infinity;
    const box = new THREE.Box3(
      new THREE.Vector3(this.position.x-.45,this.position.y,this.position.z-.45),
      new THREE.Vector3(this.position.x+.45,this.position.y+2.1,this.position.z+.45));
    const hit = new THREE.Ray(origin,direction).intersectBox(box,new THREE.Vector3());
    const distance = hit ? origin.distanceTo(hit) : Infinity;
    return distance <= maxDistance ? distance : Infinity;
  }

  takeDamage(amount) {
    this.combat.takeDamage(amount);
    this.hurtTimer = .2;
    return {dead:this.dead,drops:[]};
  }

  applyNetState(state) {
    if (!state || ![state.x,state.y,state.z,state.hp].every(Number.isFinite)) return;
    if (state.hp < this.hp) this.hurtTimer = .2;
    this.netDriven = true;
    this._netState = state;
    this.combat.hp = Math.max(0,Math.min(1500,state.hp));
    this.combat.dead = this.combat.hp === 0;
    this.combat.state = state.state;
    this._netTarget = new THREE.Vector3(state.x,state.y,state.z);
    if (!this.ready) return;
    if (state.state === 'attack') {
      if (state.attackId !== this._seenAttack) {
        this._seenAttack = state.attackId;
        this.play('slash',true);
        this.actions.slash.time = Math.max(0,Math.min(.79,state.attackTime || 0));
      }
    } else this.play(state.state === 'run' ? 'run' : 'idle');
  }

  update(dt, player) {
    if (!this.ready || this.dead || this.disposed) return 0;
    dt = Math.min(dt,.05);
    if (this.netDriven) {
      this.position.lerp(this._netTarget,Math.min(1,dt*15));
      this.group.position.copy(this.position);
      this.group.rotation.y = this._netState.yaw || 0;
      this.mixer.update(dt);
      return 0; // Damage only arrives via the server's vitals message.
    }
    const dx = player.position.x-this.position.x, dz = player.position.z-this.position.z;
    const distance = Math.hypot(dx,dz);
    const visible = distance < 32 && hasLineOfSight(this.world,this.position,player.position);
    const result = this.combat.step(dt,{distance,height:player.position.y-this.position.y,
      visible,playerAlive:player.hp>0,invulnerable:player.invuln>0});
    if (visible && distance > .01 && this.combat.state !== 'attack') this.group.rotation.y = Math.atan2(dx,dz);
    if (result.move) {
      const angle = Math.atan2(dx,dz), step = 3.4*dt;
      // Try direct pursuit, then a small side step. This is not full maze pathfinding.
      for (const offset of [0,.65,-.65,1.2,-1.2]) {
        const x=this.position.x+Math.sin(angle+offset)*step, z=this.position.z+Math.cos(angle+offset)*step;
        const y=findStandY(this.world,x,z,this.position.y);
        if (y !== null) { this.position.set(x,y,z); break; }
      }
    }
    if (result.attackStarted) {
      this.group.rotation.y = Math.atan2(dx,dz);
      this.play('slash',true);
    } else if (this.combat.state !== 'attack') this.play(this.combat.state === 'run' ? 'run' : 'idle');
    this.mixer.update(dt);
    this.group.position.copy(this.position);
    this.hurtTimer=Math.max(0,this.hurtTimer-dt);
    for (const {mat,emissive} of this.materials) mat.emissive.copy(this.hurtTimer>0 ? new THREE.Color(.5,0,0) : emissive);
    return result.hit;
  }

  toJSON() { return {hp:this.hp,x:this.position.x,y:this.position.y,z:this.position.z}; }

  dispose() {
    this.disposed = true;
    this.ready = false;
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    const resources = new Set();
    this.group.traverse(o => {
      if (o.geometry) resources.add(o.geometry);
      for (const mat of [].concat(o.material || [])) {
        resources.add(mat);
        for (const value of Object.values(mat)) if (value?.isTexture) resources.add(value);
      }
    });
    for (const resource of resources) resource.dispose();
    this.group.clear();
    this.scene.remove(this.group);
  }
}
