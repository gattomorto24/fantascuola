import * as THREE from 'three';

const muzzlePosition = new THREE.Vector3();
const direction = new THREE.Vector3();
const midpoint = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Pistol {
  constructor(scene, playerRoot) {
    this.scene = scene;
    this.playerRoot = playerRoot;
    this.drawn = false;
    this.aiming = false;
    this.shotId = 0;
    this.shotTarget = null;
    this.shotOrigin = null;
    this.shotVictimId = null;
    this.cooldown = 0;
    this.recoil = 0;
    this.group = null;
    this.muzzle = null;
    this.effects = [];
    this.geometries = [];
    this.materials = [];
  }

  mesh(parent, geometry, material, position) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  }

  build() {
    if (this.group) return;
    const metal = new THREE.MeshStandardMaterial({ color: 0x23272d, metalness: 0.48, roughness: 0.35 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3b322e, metalness: 0.08, roughness: 0.8 });
    const sight = new THREE.MeshStandardMaterial({ color: 0x9baba9, metalness: 0.4, roughness: 0.4 });
    const flash = new THREE.MeshBasicMaterial({ color: 0xffd384, transparent: true, opacity: 0.92, depthWrite: false });
    this.materials.push(metal, grip, sight, flash);
    const box = (w, h, d) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      this.geometries.push(geometry);
      return geometry;
    };
    this.group = new THREE.Group();
    this.group.name = 'Pistol';
    this.group.position.set(0.29, 0.63, -0.31);
    this.playerRoot.add(this.group);
    this.mesh(this.group, box(0.14, 0.13, 0.37), metal, [0, 0.03, -0.19]);
    this.mesh(this.group, box(0.15, 0.055, 0.24), sight, [0, 0.105, -0.15]);
    const handle = this.mesh(this.group, box(0.115, 0.25, 0.11), grip, [0, -0.15, -0.055]);
    handle.rotation.x = -0.2;
    this.mesh(this.group, box(0.09, 0.025, 0.12), metal, [0, -0.075, -0.15]);
    this.mesh(this.group, box(0.045, 0.035, 0.045), sight, [0, 0.13, -0.32]);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.025, -0.395);
    this.group.add(this.muzzle);
    this.traceGeometry = new THREE.CylinderGeometry(0.009, 0.009, 1, 6);
    this.flashGeometry = new THREE.SphereGeometry(0.085, 8, 6);
    this.geometries.push(this.traceGeometry, this.flashGeometry);
    this.flashMaterial = flash;
    this.group.visible = this.drawn;
  }

  setDrawn(value) {
    this.drawn = Boolean(value);
    if (this.drawn) this.build();
    if (this.group) this.group.visible = this.drawn;
    if (!this.drawn) this.aiming = false;
  }

  setAiming(value) {
    this.aiming = this.drawn && Boolean(value);
  }

  fireTo(target, { local = false, origin = null, victimId = null } = {}) {
    if (!this.drawn || !Array.isArray(target) || target.length !== 3 || !target.every(Number.isFinite)) return false;
    if (local && this.cooldown > 0) return false;
    this.build();
    this.playerRoot.updateMatrixWorld(true);
    this.muzzle.getWorldPosition(muzzlePosition);
    direction.set(target[0] - muzzlePosition.x, target[1] - muzzlePosition.y, target[2] - muzzlePosition.z);
    const distance = direction.length();
    if (distance < 0.05 || distance > 100) return false;
    direction.divideScalar(distance);
    midpoint.copy(muzzlePosition).addScaledVector(direction, distance * 0.5);
    const tracer = new THREE.Mesh(this.traceGeometry, this.flashMaterial);
    tracer.position.copy(midpoint);
    tracer.quaternion.setFromUnitVectors(UP, direction);
    tracer.scale.y = distance;
    const flash = new THREE.Mesh(this.flashGeometry, this.flashMaterial);
    flash.position.copy(muzzlePosition);
    this.scene.add(tracer, flash);
    this.effects.push({ tracer, flash, remaining: 0.11 });
    this.recoil = 1;
    if (local) {
      this.cooldown = 0.18;
      this.shotId = (this.shotId + 1) % 1_000_000_000;
      this.shotTarget = [...target];
      this.shotOrigin = origin ? [...origin] : null;
      this.shotVictimId = victimId;
    }
    return true;
  }

  update(delta) {
    this.cooldown = Math.max(0, this.cooldown - delta);
    this.recoil = Math.max(0, this.recoil - delta * 8);
    if (this.group) {
      const blend = this.aiming ? 1 : 0;
      this.group.position.set(0.29 - blend * 0.08, 0.63 + blend * 0.13, -0.31 + this.recoil * 0.1);
      this.group.rotation.x = -blend * 0.12 + this.recoil * 0.16;
    }
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.remaining -= delta;
      if (effect.remaining <= 0) {
        this.scene.remove(effect.tracer, effect.flash);
        this.effects.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const effect of this.effects) this.scene.remove(effect.tracer, effect.flash);
    this.effects.length = 0;
    if (this.group) this.playerRoot.remove(this.group);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.group = null;
    this.muzzle = null;
  }
}
