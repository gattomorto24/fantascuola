import * as THREE from 'three';

const direction = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
export class PlayerController {
  constructor(player, world, config) { this.player = player; this.world = world; this.config = config; this.velocity = new THREE.Vector3(); this.grounded = true; }
  update(delta, input, cameraYaw) {
    const { player, velocity, config } = this;
    forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    right.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    direction.copy(forward).multiplyScalar(input.moveY).addScaledVector(right, input.moveX);
    if (direction.lengthSq() > 1) direction.normalize();
    const moving = direction.lengthSq() > 0;
    const speed = input.sprint ? config.runSpeed : config.walkSpeed;
    const response = 1 - Math.exp(-(moving ? config.acceleration : config.deceleration) * delta);
    velocity.x += (direction.x * speed - velocity.x) * response;
    velocity.z += (direction.z * speed - velocity.z) * response;
    if (input.jump && this.grounded) { velocity.y = config.jumpForce; this.grounded = false; }
    velocity.y -= config.gravity * delta;
    player.root.position.addScaledVector(velocity, delta);
    const ground = this.world.groundHeightAt(player.root.position.x, player.root.position.z);
    if (player.root.position.y <= ground) { player.root.position.y = ground; velocity.y = 0; this.grounded = true; }
    if (moving) {
      const desired = Math.atan2(-direction.x, -direction.z);
      const diff = Math.atan2(Math.sin(desired - player.root.rotation.y), Math.cos(desired - player.root.rotation.y));
      player.root.rotation.y += diff * Math.min(1, config.rotationSpeed * delta);
    }
    player.movementState = !this.grounded ? 'Jumping' : moving ? input.sprint ? 'Running' : 'Walking' : 'Idle';
    player.updateVisual(delta);
  }
}
