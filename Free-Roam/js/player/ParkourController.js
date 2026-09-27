import * as THREE from 'three';
import { ClimbDetector } from './ClimbDetector.js?v=animation-v1';

const ACTIVE = new Set(['LEDGE_GRAB', 'HANGING', 'SHIMMY', 'CLIMB_UP', 'FALLBACK_GRAB', 'FALLBACK_CLIMB']);
const inputDirection = new THREE.Vector3();
const facing = new THREE.Vector3();
const predicted = new THREE.Vector3();
const desired = new THREE.Vector3();
const smoothstep = (value) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export class ParkourController {
  constructor(controller, world, options = {}) {
    this.controller = controller;
    this.player = controller.player;
    this.world = world;
    this.detector = new ClimbDetector(world, options);
    this.state = 'GROUND';
    this.target = null;
    this.timer = 0;
    this.cooldown = 0;
    this.probeTimer = 0;
    this.lostWallTime = 0;
    this.lastScore = 0;
    this.debug = null;
    if (globalThis.location?.search && new URLSearchParams(location.search).has('parkourDebug')) {
      this.debug = new ParkourDebug(world.scene);
    }
  }

  get active() { return ACTIVE.has(this.state); }

  reset() {
    this.transition('GROUND');
    this.target = null;
    this.cooldown = 0.2;
    this.debug?.update(this);
  }

  dispose() { this.debug?.dispose(); }

  transition(next, target = this.target) {
    this.state = next;
    this.player.parkourState = ACTIVE.has(next) ? next : null;
    this.player.parkourProgress = 0;
    this.timer = 0;
    this.target = target;
    this.lastScore = target?.score || 0;
    this.debug?.update(this);
  }

  tick(delta) {
    this.cooldown = Math.max(0, this.cooldown - delta);
    this.timer += delta;
    this.probeTimer -= delta;
  }

  // Il rilevamento anticipa brevemente la traiettoria; non sposta mai il corpo
  // oltre il raggio di presa né attraverso la collisione della mappa.
  tryAcquire(delta, input, moveDirection, cameraYaw) {
    this.tick(delta);
    if (this.cooldown > 0 || !this.world.customMapLoaded || !this.world.collision.ready) return false;
    const velocity = this.controller.velocity;
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 0.3 && velocity.y >= -0.4) return false;
    if (this.probeTimer > 0) return false;
    this.probeTimer = 0.075;
    inputDirection.copy(moveDirection);
    facing.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    if (speed > 0.3) facing.set(velocity.x / speed, 0, velocity.z / speed);
    predicted.copy(this.player.root.position).addScaledVector(velocity, 0.09);
    predicted.y = this.player.root.position.y + Math.max(-0.16, Math.min(0.15, velocity.y * 0.09));
    let target = this.detector.scan(predicted, facing, velocity, inputDirection);
    if (!target) target = this.detector.scan(this.player.root.position, facing, velocity, inputDirection);
    this.debug?.update(this);
    if (!target) return false;
    if (target.kind === 'ledge') {
      const correction = this.player.root.position.distanceTo(target.hang);
      if (correction > 1.12 || Math.abs(target.hang.y - this.player.root.position.y) > 0.92) return false;
      this.transition('LEDGE_GRAB', target);
    } else {
      const toward = -(velocity.x * target.normal.x + velocity.z * target.normal.z);
      if (target.wall.distance > 0.52 || (toward < 0.35 && velocity.y > -0.7)) return false;
      target.hang = new THREE.Vector3(
        target.wall.point.x + target.normal.x * 0.32,
        this.player.root.position.y,
        target.wall.point.z + target.normal.z * 0.32,
      );
      if (this.player.root.position.distanceTo(target.hang) > 0.64) return false;
      this.transition('FALLBACK_GRAB', target);
    }
    velocity.set(0, 0, 0);
    this.controller.grounded = false;
    return true;
  }

  rotateToward(normal, delta) {
    const want = Math.atan2(normal.x, normal.z);
    const current = this.player.root.rotation.y;
    const diff = Math.atan2(Math.sin(want - current), Math.cos(want - current));
    this.player.root.rotation.y += diff * Math.min(1, delta * 12);
  }

  moveTo(position, delta, speed = 12) {
    const amount = Math.min(1, delta * speed);
    this.player.root.position.lerp(position, amount);
  }

  release(jumpBack = false) {
    const normal = this.target?.normal;
    this.controller.velocity.set(
      jumpBack && normal ? normal.x * 3.8 : 0,
      jumpBack ? 4.3 : -0.5,
      jumpBack && normal ? normal.z * 3.8 : 0,
    );
    this.controller.grounded = false;
    this.cooldown = jumpBack ? 0.42 : 0.32;
    this.transition(jumpBack ? 'WALL_JUMP' : 'AIRBORNE', null);
  }

  shiftLedge(side, jump = false) {
    const target = this.target;
    const tangent = desired.set(target.normal.z * side, 0, -target.normal.x * side);
    const distance = jump ? 0.92 : 0.15;
    const testPosition = this.player.root.position.clone().addScaledVector(tangent, distance);
    let ledge = null;
    for (const probe of [target.normal.clone().negate(), tangent.clone(), tangent.clone().sub(target.normal).normalize()]) {
      const wall = this.detector.wallAt(testPosition, probe, 0.72);
      ledge = wall && this.detector.ledgeAt(testPosition, wall);
      if (ledge) break;
    }
    if (!ledge || Math.abs(ledge.hang.y - target.hang.y) > (jump ? 0.7 : 0.25)) return false;
    if (ledge.hang.distanceTo(this.player.root.position) > (jump ? 1.25 : 0.46)) return false;
    ledge.score = target.score;
    this.target = ledge;
    this.transition(jump ? 'LEDGE_GRAB' : 'SHIMMY', ledge);
    return true;
  }

  update(delta, input) {
    if (!this.active) return false;
    this.tick(delta);
    const { player, target } = this;
    if (!this.world.customMapLoaded || !this.world.collision.ready
      || !this.world.collision.activeMeshes.has(target.wall.mesh)
      || (this.world.streamedMap && !this.world.streamedMap.canMoveTo(player.root.position.x, player.root.position.z))) {
      this.release();
      return false;
    }
    this.controller.velocity.set(0, 0, 0);
    this.controller.grounded = false;
    player.parkourSide = input.moveX || 0;
    if (this.state === 'LEDGE_GRAB' || this.state === 'FALLBACK_GRAB') {
      player.parkourProgress = Math.min(1, this.timer / 0.22);
      this.moveTo(target.hang, delta, 11);
      this.rotateToward(target.normal, delta);
      if (this.timer > 0.2 || player.root.position.distanceTo(target.hang) < 0.055) {
        this.transition(this.state === 'LEDGE_GRAB' ? 'HANGING' : 'FALLBACK_CLIMB');
      }
    } else if (this.state === 'CLIMB_UP') {
      if (!target.stand
        || (this.world.streamedMap && !this.world.streamedMap.canMoveTo(target.stand.x, target.stand.z))) {
        this.transition('HANGING');
      } else {
        // Solleva prima il bacino sopra il bordo, poi porta i piedi sul piano.
        // Tempo e posa condividono la stessa progressione per evitare foot sliding.
        const progress = Math.min(1, this.timer / 0.96);
        const lift = smoothstep(progress / 0.64);
        const traverse = smoothstep((progress - 0.54) / 0.46);
        player.parkourProgress = progress;
        player.root.position.set(
          target.hang.x + (target.stand.x - target.hang.x) * traverse,
          target.hang.y + (target.stand.y - target.hang.y) * lift,
          target.hang.z + (target.stand.z - target.hang.z) * traverse,
        );
        this.rotateToward(target.normal, delta);
        if (progress >= 1) {
          player.root.position.copy(target.stand);
          this.controller.grounded = true;
          this.cooldown = 0.28;
          this.transition('LANDING', null);
        }
      }
    } else if (this.state === 'HANGING' || this.state === 'SHIMMY') {
      if (input.jump && input.moveY < -0.35) this.release(true);
      else if (input.jump && Math.abs(input.moveX) > 0.3) this.shiftLedge(Math.sign(input.moveX), true);
      else if (input.jump && input.moveY > 0.3 && !target.stand) this.jumpUp();
      else if ((input.jump || input.moveY > 0.45) && this.timer > 0.13) {
        if (target.stand && this.detector.clearAbove(target.stand)) this.transition('CLIMB_UP');
      } else if (Math.abs(input.moveX) > 0.2 && this.probeTimer <= 0) {
        this.probeTimer = 0.075;
        this.shiftLedge(Math.sign(input.moveX));
      } else if (input.moveY < -0.75 && this.timer > 0.25) this.release();
      if (this.active && this.state !== 'CLIMB_UP') {
        this.moveTo(this.target.hang, delta, 10);
        this.rotateToward(this.target.normal, delta);
      }
    } else if (this.state === 'FALLBACK_CLIMB') {
      if (input.jump && input.moveY < -0.3) {
        this.release(true);
      } else if (input.jump && Math.abs(input.moveX) > 0.3 && this.jumpSide(Math.sign(input.moveX))) {
        // Il target laterale è stato acquisito con una distanza limitata.
      } else if (input.jump && input.moveY > 0.3 && this.jumpUp()) {
        // Il salto usa il bordo reale superiore quando è raggiungibile.
      } else {
        const side = Math.max(-1, Math.min(1, input.moveX));
        const up = Math.max(-0.7, Math.min(1, input.moveY + (input.jump && input.moveY >= 0 ? 0.65 : 0)));
        const step = Math.min(delta, 0.05);
        desired.copy(player.root.position);
        desired.y += up * 1.85 * step;
        desired.x += target.normal.z * side * 1.55 * step;
        desired.z -= target.normal.x * side * 1.55 * step;
        const wall = this.detector.wallAt(desired, target.normal.clone().negate(), 0.75);
        if (this.probeTimer <= 0) {
          this.probeTimer = 0.07;
          const ledge = this.detector.ledgeAt(desired, wall || target.wall);
          if (ledge && ledge.hang.distanceTo(player.root.position) <= 1.1) {
            ledge.score = 10;
            this.transition('LEDGE_GRAB', ledge);
          }
        }
        if (this.state === 'FALLBACK_CLIMB') {
          if (!wall) this.lostWallTime += delta;
          else {
            this.lostWallTime = 0;
            target.wall = wall;
            target.normal.copy(wall.normal);
            const correctionX = wall.point.x + wall.normal.x * 0.32 - desired.x;
            const correctionZ = wall.point.z + wall.normal.z * 0.32 - desired.z;
            const correction = Math.hypot(correctionX, correctionZ);
            const fraction = correction > 0.08 ? 0.08 / correction : 1;
            desired.x += correctionX * fraction;
            desired.z += correctionZ * fraction;
            if (!this.world.streamedMap || this.world.streamedMap.canMoveTo(desired.x, desired.z)) {
              player.root.position.copy(desired);
            }
            this.rotateToward(target.normal, delta);
          }
          if (this.lostWallTime > 0.18) this.release();
        }
      }
    }
    player.movementState = this.active ? this.state : this.state === 'LANDING' ? 'Idle' : 'Jumping';
    player.updateVisual(delta);
    this.debug?.update(this);
    return true;
  }

  jumpSide(side) {
    const tangent = new THREE.Vector3(this.target.normal.z * side, 0, -this.target.normal.x * side);
    const probePosition = this.player.root.position.clone().addScaledVector(tangent, 0.82);
    probePosition.y += 0.25;
    for (const probe of [this.target.normal.clone().negate(), tangent, tangent.clone().sub(this.target.normal).normalize()]) {
      const wall = this.detector.wallAt(probePosition, probe, 0.72);
      if (!wall) continue;
      const ledge = this.detector.ledgeAt(probePosition, wall);
      if (ledge && ledge.hang.distanceTo(this.player.root.position) <= 1.25) {
        this.transition('LEDGE_GRAB', ledge);
        return true;
      }
      const hang = new THREE.Vector3(wall.point.x + wall.normal.x * 0.32,
        probePosition.y, wall.point.z + wall.normal.z * 0.32);
      if (hang.distanceTo(this.player.root.position) <= 1.15) {
        this.transition('FALLBACK_GRAB', { kind: 'wall', wall, normal: wall.normal.clone(), hang, score: 1 });
        return true;
      }
    }
    return false;
  }

  jumpUp() {
    if (this.cooldown > 0) return false;
    const elevated = this.player.root.position.clone();
    elevated.y += 0.58;
    const wall = this.detector.wallAt(elevated, this.target.normal.clone().negate(), 0.75);
    const ledge = wall && this.detector.ledgeAt(elevated, wall);
    if (ledge && ledge.hang.distanceTo(this.player.root.position) <= 1.15) {
      this.transition('LEDGE_GRAB', ledge);
      this.cooldown = 0.35;
      return true;
    }
    if (this.state !== 'FALLBACK_CLIMB' || !wall) return false;
    const hang = new THREE.Vector3(wall.point.x + wall.normal.x * 0.32,
      elevated.y, wall.point.z + wall.normal.z * 0.32);
    if (hang.distanceTo(this.player.root.position) > 0.88) return false;
    this.transition('FALLBACK_GRAB', { kind: 'wall', wall, normal: wall.normal.clone(), hang, score: 0 });
    this.cooldown = 0.45;
    return true;
  }
}

class ParkourDebug {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'ParkourDebug';
    this.normal = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.8, 0xff6b4a);
    this.target = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0x5bf2ae, depthTest: false }));
    this.alternatives = Array.from({ length: 3 }, () => new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffb75a, depthTest: false }),
    ));
    this.ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x51bdff, depthTest: false }));
    this.trajectory = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xf5e56c, depthTest: false }));
    this.group.add(this.normal, this.target, this.ray, this.trajectory, ...this.alternatives);
    scene.add(this.group);
    this.label = document.createElement('div');
    this.label.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#091b24dd;color:#adffce;padding:6px;font:12px monospace;pointer-events:none';
    document.body.append(this.label);
  }

  update(controller) {
    const point = controller.target?.wall?.point;
    this.normal.visible = this.target.visible = this.ray.visible = Boolean(point);
    const velocity = controller.controller.velocity;
    const start = controller.player.root.position;
    const path = this.trajectory.geometry.attributes.position;
    path.setXYZ(0, start.x, start.y + 0.7, start.z);
    path.setXYZ(1, start.x + velocity.x * 0.25, start.y + 0.7 + velocity.y * 0.25,
      start.z + velocity.z * 0.25);
    path.needsUpdate = true;
    if (point) {
      this.normal.position.copy(point);
      this.normal.setDirection(controller.target.normal);
      this.target.position.copy(controller.target.hang || point);
      const positions = this.ray.geometry.attributes.position;
      positions.setXYZ(0, controller.player.root.position.x, controller.player.root.position.y + 0.7, controller.player.root.position.z);
      positions.setXYZ(1, point.x, point.y, point.z);
      positions.needsUpdate = true;
    }
    controller.detector.lastCandidates.forEach((candidate, index) => {
      if (index < this.alternatives.length) this.alternatives[index].position.copy(candidate.hang || candidate.wall.point);
    });
    this.alternatives.forEach((marker, index) => { marker.visible = index < controller.detector.lastCandidates.length; });
    this.label.textContent = `PARKOUR ${controller.state} · score ${controller.lastScore.toFixed(2)} · ${point ? `wall ${point.x.toFixed(1)},${point.y.toFixed(1)},${point.z.toFixed(1)}` : 'no target'}`;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
    this.label.remove();
  }
}
