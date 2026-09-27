import * as THREE from 'three';
import { ParkourController } from './ParkourController.js';

const direction = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const horizontalMovement = new THREE.Vector3();

export class PlayerController {
  constructor(player, world, config) {
    this.player = player;
    this.world = world;
    this.config = config;
    this.velocity = new THREE.Vector3();
    this.grounded = true;
    this.parkour = new ParkourController(this, world);
  }

  update(delta, input, cameraYaw) {
    const { player, velocity, config } = this;

    forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    right.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    direction.copy(forward).multiplyScalar(input.moveY).addScaledVector(right, input.moveX);
    if (direction.lengthSq() > 1) direction.normalize();

    if (this.parkour.update(delta, input)) return;

    const moving = direction.lengthSq() > 0;
    const speed = input.sprint ? config.runSpeed : config.walkSpeed;
    const response = 1 - Math.exp(-(moving ? config.acceleration : config.deceleration) * delta);

    velocity.x += (direction.x * speed - velocity.x) * response;
    velocity.z += (direction.z * speed - velocity.z) * response;

    if (input.jump && this.grounded) {
      velocity.y = config.jumpForce;
      this.grounded = false;
    }

    const wasGrounded = this.grounded;
    velocity.y -= config.gravity * delta;

    // Movimento X/Z separato dalla gravità: la mappa può correggere il tragitto
    // contro muri, edifici, recinzioni e altri pezzi solidi.
    horizontalMovement.set(velocity.x * delta, 0, velocity.z * delta);
    const resolved = this.world.resolveHorizontalMovement(
      player.root.position,
      horizontalMovement,
      config.radius,
      config.height,
      config.stepHeight,
    );
    player.root.position.x = resolved.x;
    player.root.position.z = resolved.z;

    player.root.position.y += velocity.y * delta;

    const ground = this.world.groundHeightAt(
      player.root.position.x,
      player.root.position.z,
      player.root.position.y,
      config.stepHeight,
      config.maxGroundProbe,
    );

    if (Number.isFinite(ground) && velocity.y <= 0) {
      const distanceToGround = player.root.position.y - ground;
      const landingTolerance = Math.max(0.08, Math.abs(velocity.y * delta) + 0.04);

      if (
        player.root.position.y <= ground + landingTolerance
        || (wasGrounded && distanceToGround >= 0 && distanceToGround <= config.stepHeight + 0.08)
      ) {
        player.root.position.y = ground;
        velocity.y = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    } else if (!Number.isFinite(ground)) {
      this.grounded = false;
    }

    // Evita di perdere il player sotto una mappa con buchi reali.
    if (player.root.position.y < config.respawnY) {
      this.parkour.reset();
      const spawn = this.world.spawn;
      player.root.position.set(spawn[0], spawn[1], spawn[2]);
      const spawnGround = this.world.groundHeightAt(spawn[0], spawn[2], spawn[1], 3, 20);
      if (Number.isFinite(spawnGround)) player.root.position.y = spawnGround;
      velocity.set(0, 0, 0);
      this.grounded = true;
    }

    if (moving || input.aiming) {
      const desired = input.aiming ? cameraYaw : Math.atan2(-direction.x, -direction.z);
      const diff = Math.atan2(
        Math.sin(desired - player.root.rotation.y),
        Math.cos(desired - player.root.rotation.y),
      );
      player.root.rotation.y += diff * Math.min(1, config.rotationSpeed * delta);
    }

    player.movementState = !this.grounded
      ? 'Jumping'
      : moving
        ? input.sprint ? 'Running' : 'Walking'
        : 'Idle';

    if (!this.grounded && this.parkour.tryAcquire(delta, input, direction, cameraYaw)) {
      player.movementState = this.parkour.state;
    } else if (this.grounded && this.parkour.state !== 'GROUND') {
      this.parkour.transition('GROUND', null);
    }

    player.updateVisual(delta);
  }
}
