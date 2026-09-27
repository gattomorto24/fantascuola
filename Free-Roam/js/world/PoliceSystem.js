import * as THREE from 'three';

const validPose = (pose) => pose && [pose.x, pose.y, pose.z, pose.yaw].every(Number.isFinite);

export class PoliceSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.units = new Map();
    this.boxes = [];
    this.materials = [];
    this.lastContactAt = 0;
    this.body = this.material(0xe5e9ed);
    this.dark = this.material(0x1b2937);
    this.red = this.material(0xf02d35);
    this.blue = this.material(0x2368e9);
  }

  material(color) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    this.materials.push(material);
    return material;
  }

  box(root, size, position, material) {
    const geometry = new THREE.BoxGeometry(...size);
    this.boxes.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    root.add(mesh);
  }

  create(id, pose) {
    const root = new THREE.Group();
    root.name = 'PoliceCar';
    this.box(root, [1.8, 0.6, 3.6], [0, 0.65, 0], this.body);
    this.box(root, [1.45, 0.55, 1.8], [0, 1.18, -0.15], this.dark);
    this.box(root, [1.45, 0.08, 1.55], [0, 1.49, -0.15], this.body);
    this.box(root, [0.55, 0.12, 0.3], [-0.32, 1.61, -0.15], this.red);
    this.box(root, [0.55, 0.12, 0.3], [0.32, 1.61, -0.15], this.blue);
    for (const x of [-0.88, 0.88]) {
      for (const z of [-1.1, 1.1]) this.box(root, [0.23, 0.58, 0.58], [x, 0.32, z], this.dark);
    }
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.y = pose.yaw;
    this.scene.add(root);
    const unit = { id, root, pose: { ...pose }, targetPose: null, lastSeen: Date.now() };
    this.units.set(id, unit);
    return unit;
  }

  remove(id) {
    const unit = this.units.get(id);
    if (!unit) return;
    this.scene.remove(unit.root);
    unit.root.clear();
    this.units.delete(id);
  }

  updateLocal(id, stars, position, yaw, delta) {
    if (!stars) { this.remove(id); return null; }
    let unit = this.units.get(id);
    if (!unit) {
      unit = this.create(id, { x: position.x - Math.sin(yaw) * 12,
        y: position.y, z: position.z - Math.cos(yaw) * 12, yaw });
    }
    const dx = position.x - unit.pose.x;
    const dz = position.z - unit.pose.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 2.1) {
      const step = Math.min(distance - 2.1, (5.5 + stars * 1.8) * Math.min(delta, 0.05));
      const direction = new THREE.Vector3(dx / distance * step, 0, dz / distance * step);
      const next = this.world.resolveHorizontalMovement(unit.root.position, direction, 0.9, 1.4);
      unit.pose.x = next.x;
      unit.pose.z = next.z;
      const ground = this.world.groundHeightAt(next.x, next.z, unit.pose.y, 1.1, 3);
      if (Number.isFinite(ground)) unit.pose.y = ground;
      unit.pose.yaw = Math.atan2(dx, dz);
    }
    unit.root.position.set(unit.pose.x, unit.pose.y, unit.pose.z);
    unit.root.rotation.y = unit.pose.yaw;
    unit.lastSeen = Date.now();
    return { ...unit.pose };
  }

  receive(snapshot) {
    if (!snapshot?.playerId) return;
    if (!(snapshot.wanted > 0) || !validPose(snapshot.policePose)) {
      this.remove(snapshot.playerId);
      return;
    }
    const unit = this.units.get(snapshot.playerId) || this.create(snapshot.playerId, snapshot.policePose);
    unit.targetPose = { ...snapshot.policePose };
    unit.lastSeen = Date.now();
  }

  updateRemote(delta, localPlayerId) {
    for (const [id, unit] of this.units) {
      if (id === localPlayerId) continue;
      if (Date.now() - unit.lastSeen > 6000) { this.remove(id); continue; }
      const target = unit.targetPose;
      if (!target) continue;
      const alpha = 1 - Math.exp(-9 * delta);
      unit.root.position.lerp(new THREE.Vector3(target.x, target.y, target.z), alpha);
      unit.root.rotation.y += Math.atan2(Math.sin(target.yaw - unit.root.rotation.y),
        Math.cos(target.yaw - unit.root.rotation.y)) * alpha;
    }
  }

  touchesLocal(id, position, now = Date.now()) {
    const unit = this.units.get(id);
    if (!unit || now - this.lastContactAt < 1500) return false;
    if (Math.abs(unit.pose.y - position.y) > 2.4
      || Math.hypot(unit.pose.x - position.x, unit.pose.z - position.z) > 2.7) return false;
    this.lastContactAt = now;
    return true;
  }

  poseOf(id) { return this.units.get(id)?.pose || null; }

  dispose() {
    for (const id of [...this.units.keys()]) this.remove(id);
    for (const geometry of this.boxes) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
