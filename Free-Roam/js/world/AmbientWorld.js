import * as THREE from 'three';
import { createPixelAvatar } from '../avatars/PixelAvatarRenderer.js';
import { MOVING_CARS, PARKED_CARS, PEDESTRIANS, sampleRoute } from './AmbientMapData.js?v=ambient-v1';

const GLASS = '#263d48';
const RUBBER = '#1b1d20';
const CHROME = '#a8adb0';

export class AmbientWorld {
  constructor(scene, collision, { isMobile = false, tileReady = () => true } = {}) {
    this.scene = scene;
    this.collision = collision;
    this.tileReady = tileReady;
    this.radius = isMobile ? 37 : 75;
    this.active = new Map();
    this.geometries = new Map();
    this.materials = new Map();
    this.cullElapsed = Infinity;
    this.disposed = false;
  }

  geometry(width, height, depth) {
    const key = `${width}:${height}:${depth}`;
    if (!this.geometries.has(key)) this.geometries.set(key, new THREE.BoxGeometry(width, height, depth));
    return this.geometries.get(key);
  }

  material(color, metalness = 0.04) {
    const key = `${color}:${metalness}`;
    if (!this.materials.has(key)) {
      this.materials.set(key, new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.68 }));
    }
    return this.materials.get(key);
  }

  box(root, size, position, color, metalness = 0.04) {
    const mesh = new THREE.Mesh(this.geometry(...size), this.material(color, metalness));
    mesh.position.set(...position);
    root.add(mesh);
    return mesh;
  }

  makeCar(paint) {
    const root = new THREE.Group();
    root.name = 'AmbientCar';
    if (!this.geometries.has('tire')) this.geometries.set('tire', new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10));
    if (!this.geometries.has('hub')) this.geometries.set('hub', new THREE.CylinderGeometry(0.14, 0.14, 0.025, 10));
    const body = this.box(root, [1.78, 0.58, 3.65], [0, 0.69, 0], paint, 0.17);
    this.box(root, [1.46, 0.58, 1.85], [0, 1.18, -0.24], GLASS, 0.18);
    this.box(root, [1.48, 0.08, 1.68], [0, 1.52, -0.24], paint, 0.17);
    this.box(root, [1.82, 0.18, 0.18], [0, 0.44, 1.87], '#293036');
    this.box(root, [1.82, 0.18, 0.18], [0, 0.44, -1.87], '#293036');
    for (const side of [-1, 1]) {
      for (const axle of [-1.12, 1.12]) {
        const tire = new THREE.Mesh(this.geometries.get('tire'), this.material(RUBBER));
        tire.rotation.z = Math.PI / 2;
        tire.position.set(side * 0.91, 0.34, axle);
        root.add(tire);
        const hub = new THREE.Mesh(this.geometries.get('hub'), this.material(CHROME, 0.42));
        hub.rotation.z = Math.PI / 2;
        hub.position.set(side * 1.03, 0.34, axle);
        root.add(hub);
      }
      this.box(root, [0.28, 0.13, 0.07], [side * 0.61, 0.69, 1.85], '#efe8ce');
      this.box(root, [0.28, 0.13, 0.07], [side * 0.61, 0.69, -1.85], '#b83834');
      this.box(root, [0.11, 0.17, 0.28], [side * 0.84, 1.16, 0.25], paint, 0.17);
    }
    return { root, collider: body };
  }

  makePedestrian(config) {
    const visual = createPixelAvatar(config);
    const root = new THREE.Group();
    root.name = 'AmbientPedestrian';
    visual.object.scale.setScalar(0.5);
    root.add(visual.object);
    return { root, visual };
  }

  activate(definition, kind, pose) {
    const instance = kind === 'pedestrian'
      ? this.makePedestrian(definition.avatar)
      : this.makeCar(definition.paint);
    instance.kind = kind;
    instance.root.position.set(pose.x, pose.y, pose.z);
    instance.root.rotation.y = pose.yaw + (kind === 'pedestrian' ? Math.PI : 0);
    this.scene.add(instance.root);
    instance.root.updateMatrixWorld(true);
    if (kind === 'parked') this.collision.add(instance.collider);
    this.active.set(definition.id, instance);
  }

  deactivate(id) {
    const instance = this.active.get(id);
    if (!instance) return;
    if (instance.kind === 'parked') this.collision.remove(instance.collider);
    this.scene.remove(instance.root);
    instance.root.clear();
    this.active.delete(id);
  }

  update(delta, playerPosition, timeMs = Date.now()) {
    if (this.disposed) return;
    this.cullElapsed += delta;
    const recull = this.cullElapsed >= 0.22;
    if (recull) this.cullElapsed = 0;
    const radiusSq = this.radius * this.radius;

    const visit = (definition, kind, pose) => {
      if (!pose) return;
      if (recull) {
        const dx = pose.x - playerPosition.x;
        const dz = pose.z - playerPosition.z;
        const needed = dx * dx + dz * dz <= radiusSq && this.tileReady(pose.x, pose.z);
        if (needed && !this.active.has(definition.id)) this.activate(definition, kind, pose);
        else if (!needed && this.active.has(definition.id)) this.deactivate(definition.id);
      }
      const instance = this.active.get(definition.id);
      if (!instance || kind === 'parked') return;
      instance.root.position.set(pose.x, pose.y, pose.z);
      instance.root.rotation.y = pose.yaw + (kind === 'pedestrian' ? Math.PI : 0);
      if (kind === 'pedestrian') instance.visual.update(delta, 'Walking');
    };

    for (const item of PARKED_CARS) {
      visit(item, 'parked', { x: item.position[0], y: item.position[1], z: item.position[2], yaw: item.yaw });
    }
    for (const item of MOVING_CARS) visit(item, 'moving', sampleRoute(item.path, item.speed, item.phase, timeMs));
    for (const item of PEDESTRIANS) visit(item, 'pedestrian', sampleRoute(item.path, item.speed, item.phase, timeMs, true));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.active.keys()]) this.deactivate(id);
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}
