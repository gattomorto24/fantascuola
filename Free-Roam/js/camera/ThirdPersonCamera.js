import * as THREE from 'three';
const target = new THREE.Vector3();
const desired = new THREE.Vector3();
export class ThirdPersonCamera {
  constructor(camera, config) { this.camera = camera; this.config = config; this.yaw = 0; this.pitch = 0.38; this.distance = config.distance; this.initialized = false; this.aimBlend = 0; this.driveBlend = 0; this.baseFov = camera.fov; }
  update(delta, input, playerPosition) {
    const c = this.config;
    this.yaw -= input.cameraX * c.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.cameraY * c.sensitivity, c.minPitch, c.maxPitch);
    this.distance = THREE.MathUtils.clamp(this.distance + input.zoom * c.zoomStep, c.minDistance, c.maxDistance);
    const blendTarget = input.aiming ? 1 : 0;
    this.aimBlend += (blendTarget - this.aimBlend) * (this.initialized ? 1 - Math.exp(-12 * delta) : 1);
    this.driveBlend += ((input.driving ? 1 : 0) - this.driveBlend) * (this.initialized ? 1 - Math.exp(-8 * delta) : 1);
    const effectiveDistance = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.distance, 2.65, this.aimBlend), 6.5, this.driveBlend);
    target.copy(playerPosition);
    target.y += c.lookHeight + 0.12 * this.aimBlend + 0.7 * this.driveBlend;
    target.x += Math.cos(this.yaw) * 0.52 * this.aimBlend;
    target.z -= Math.sin(this.yaw) * 0.52 * this.aimBlend;
    const horizontal = Math.cos(this.pitch) * effectiveDistance;
    desired.set(target.x + Math.sin(this.yaw) * horizontal, target.y + Math.sin(this.pitch) * effectiveDistance, target.z + Math.cos(this.yaw) * horizontal);
    // desired is the hook for future camera collision/raycast adjustment.
    this.camera.position.lerp(desired, this.initialized ? 1 - Math.exp(-c.smoothing * delta) : 1);
    this.initialized = true;
    this.camera.lookAt(target);
    const fov = THREE.MathUtils.lerp(this.baseFov, 53, this.aimBlend);
    if (Math.abs(this.camera.fov - fov) > 0.02) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
