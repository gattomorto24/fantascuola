import * as THREE from 'three';
const target = new THREE.Vector3();
const desired = new THREE.Vector3();
export class ThirdPersonCamera {
  constructor(camera, config) { this.camera = camera; this.config = config; this.yaw = 0; this.pitch = 0.38; this.distance = config.distance; this.initialized = false; }
  update(delta, input, playerPosition) {
    const c = this.config;
    this.yaw -= input.cameraX * c.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.cameraY * c.sensitivity, c.minPitch, c.maxPitch);
    this.distance = THREE.MathUtils.clamp(this.distance + input.zoom * c.zoomStep, c.minDistance, c.maxDistance);
    target.copy(playerPosition); target.y += c.lookHeight;
    const horizontal = Math.cos(this.pitch) * this.distance;
    desired.set(target.x + Math.sin(this.yaw) * horizontal, target.y + Math.sin(this.pitch) * this.distance, target.z + Math.cos(this.yaw) * horizontal);
    // desired is the hook for future camera collision/raycast adjustment.
    this.camera.position.lerp(desired, this.initialized ? 1 - Math.exp(-c.smoothing * delta) : 1);
    this.initialized = true;
    this.camera.lookAt(target);
  }
}
