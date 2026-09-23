import * as THREE from 'three';

function model(hand = false) {
  const group = new THREE.Group();
  const part = (geometry, color, y) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color, depthTest: !hand, fog: !hand}));
    mesh.position.y = y;
    if (hand) mesh.renderOrder = 1000;
    group.add(mesh);
  };
  part(new THREE.CylinderGeometry(.13,.13,.42,8),0x687846,0);
  part(new THREE.ConeGeometry(.13,.18,8),0xe3bb4b,.30);
  part(new THREE.BoxGeometry(.36,.12,.06),0x343c2d,-.23);
  part(new THREE.BoxGeometry(.06,.12,.36),0x343c2d,-.23);
  part(new THREE.CylinderGeometry(.135,.135,.09,8),0xe3bb4b,.04);
  group.rotation.x = -Math.PI / 2;
  return group;
}
function release(mesh) {
  mesh.removeFromParent();
  mesh.traverse(part => {part.geometry?.dispose();part.material?.dispose();});
}

/** Presentation only: never predicts collision, damage or terrain edits. */
export class NukeVisual {
  constructor(scene,camera) {
    this.scene=scene;this.projectiles=new Map();
    this.hand=model(true);this.hand.scale.setScalar(.55);this.hand.position.set(.24,-.20,-.65);this.hand.visible=false;
    camera.add(this.hand);if(!camera.parent)scene.add(camera);
  }
  receive(message) {
    if(message.phase==='end') {
      const entry=this.projectiles.get(message.id);
      if(entry)release(entry.mesh);
      this.projectiles.delete(message.id);return;
    }
    if(!message.id||![message.x,message.y,message.z].every(Number.isFinite))return;
    let entry=this.projectiles.get(message.id);
    if(!entry) {
      const mesh=model();mesh.position.set(message.x,message.y,message.z);this.scene.add(mesh);
      entry={mesh,target:mesh.position.clone(),dimension:message.dimension};this.projectiles.set(message.id,entry);
    }
    entry.dimension=message.dimension;entry.target.set(message.x,message.y,message.z);
  }
  tick(dt,dimension,equipped) {
    this.hand.visible=equipped;
    for(const {mesh,target,dimension:dim} of this.projectiles.values()) {
      mesh.visible=dim===dimension;mesh.position.lerp(target,1-Math.exp(-Math.max(0,dt)*16));
    }
  }
  clear() {
    for(const {mesh} of this.projectiles.values())release(mesh);
    this.projectiles.clear();this.hand.visible=false;
  }
  dispose() {this.clear();release(this.hand);}
}
