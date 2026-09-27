import * as THREE from 'three';

const movement = new THREE.Vector3();
const candidate = new THREE.Vector3();

export class VehicleController {
  constructor(player, world, camera, playerId = '') {
    this.player = player;
    this.world = world;
    this.camera = camera;
    this.playerId = playerId;
    this.vehicleId = null;
    this.speed = 0;
    this.savedWeapon = false;
    this.lastFootPosition = null;
  }

  get driving() { return this.vehicleId !== null; }

  enter() {
    const ambient = this.world.ambient;
    const nearby = ambient?.nearestVehicle(this.player.root.position);
    if (!nearby || !ambient.setDrivenPose(nearby.id, this.playerId, nearby.pose, true)) return false;
    this.vehicleId = nearby.id;
    this.speed = 0;
    this.savedWeapon = this.player.weapon.drawn;
    this.lastFootPosition = this.player.root.position.clone();
    this.player.weapon.setDrawn(false);
    this.player.setVehiclePresence(true);
    this.player.root.position.set(nearby.pose.x, nearby.pose.y, nearby.pose.z);
    this.player.root.rotation.y = nearby.pose.yaw;
    this.camera.yaw = nearby.pose.yaw;
    this.camera.pitch = 0.3;
    return true;
  }

  update(delta, input) {
    if (!this.driving) return;
    const ambient = this.world.ambient;
    const car = ambient?.drivers.get(this.vehicleId);
    if (!car || car.playerId !== this.playerId) {
      this.exit(false);
      return;
    }

    const dt = Math.min(delta, 0.05);
    const throttle = input.moveY;
    if (Math.abs(throttle) > 0.05) {
      this.speed += throttle * (this.speed * throttle < 0 ? 10 : 6.5) * dt;
    } else {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 4.8 * dt);
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -4.5, 12);
    if (Math.abs(this.speed) < 0.03) this.speed = 0;

    const pose = car.pose;
    if (Math.abs(this.speed) > 0.15) {
      const steering = THREE.MathUtils.clamp(input.moveX, -1, 1);
      pose.yaw -= steering * 1.45 * dt * Math.sign(this.speed)
        * Math.min(1, Math.abs(this.speed) / 3);
    }
    movement.set(-Math.sin(pose.yaw) * this.speed * dt, 0,
      -Math.cos(pose.yaw) * this.speed * dt);
    candidate.set(pose.x, pose.y, pose.z);
    const resolved = this.world.resolveHorizontalMovement(candidate, movement, 1.25, 1.55);
    const advanced = Math.hypot(resolved.x - pose.x, resolved.z - pose.z);
    if (advanced < movement.length() * 0.45 && movement.length() > 0.01) this.speed = 0;
    const ground = this.world.groundHeightAt(resolved.x, resolved.z, pose.y, 0.9, 2.5);
    if (Number.isFinite(ground) && Math.abs(ground - pose.y) <= 1.3) {
      pose.x = resolved.x;
      pose.y = ground;
      pose.z = resolved.z;
    } else {
      this.speed = 0;
    }
    this.player.root.position.set(pose.x, pose.y, pose.z);
    this.player.root.rotation.y = pose.yaw;
    this.player.movementState = this.speed === 0 ? 'Idle' : 'Walking';
    this.player.updateVisual(delta);
    this.camera.yaw += Math.atan2(Math.sin(pose.yaw - this.camera.yaw),
      Math.cos(pose.yaw - this.camera.yaw)) * Math.min(1, 1.8 * dt);
  }

  exit(park = true) {
    if (!this.driving) return false;
    const id = this.vehicleId;
    const ambient = this.world.ambient;
    const pose = ambient?.drivers.get(id)?.pose || {
      x: this.player.root.position.x, y: this.player.root.position.y,
      z: this.player.root.position.z, yaw: this.player.root.rotation.y,
    };
    this.vehicleId = null;
    this.speed = 0;
    if (park) ambient?.parkVehicle(id, this.playerId, pose);

    const sideX = Math.cos(pose.yaw);
    const sideZ = -Math.sin(pose.yaw);
    let exitPosition = null;
    for (const [dx, dz] of [[sideX * 2.35, sideZ * 2.35],
      [-sideX * 2.35, -sideZ * 2.35], [Math.sin(pose.yaw) * 2.8, Math.cos(pose.yaw) * 2.8]]) {
      const x = pose.x + dx;
      const z = pose.z + dz;
      const ground = this.world.groundHeightAt(x, z, pose.y, 1, 2);
      if (!Number.isFinite(ground) || Math.abs(ground - pose.y) > 1.2) continue;
      if (this.world.streamedMap && !this.world.streamedMap.canMoveTo(x, z)) continue;
      const reached = this.world.resolveHorizontalMovement(
        new THREE.Vector3(pose.x, pose.y, pose.z), new THREE.Vector3(dx, 0, dz), 0.34, 1.8,
      );
      if (Math.hypot(reached.x - x, reached.z - z) > 0.3) continue;
      exitPosition = new THREE.Vector3(x, ground, z);
      break;
    }
    this.player.root.position.copy(exitPosition || this.lastFootPosition || candidate.set(pose.x, pose.y, pose.z));
    this.lastFootPosition = null;
    this.player.setVehiclePresence(false);
    this.player.weapon.setDrawn(this.savedWeapon);
    this.camera.yaw = pose.yaw;
    return true;
  }
}
