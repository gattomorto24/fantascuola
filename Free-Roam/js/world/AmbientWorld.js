import * as THREE from 'three';
import { createPixelAvatar } from '../avatars/PixelAvatarRenderer.js?v=parkour-v1';
import { MOVING_VEHICLES, PARKED_VEHICLES, PEDESTRIANS, sampleRoute } from './AmbientMapData.js?v=motorcycles-v1';

const GLASS = '#263d48';
const RUBBER = '#1b1d20';
const CHROME = '#a8adb0';
const VEHICLES = [...PARKED_VEHICLES, ...MOVING_VEHICLES];
const VEHICLE_IDS = new Set(VEHICLES.map((item) => item.id));
const VEHICLE_BY_ID = new Map(VEHICLES.map((item) => [item.id, item]));
const MOVING_IDS = new Set(MOVING_VEHICLES.map((item) => item.id));
const PEDESTRIAN_IDS = new Set(PEDESTRIANS.map((item) => item.id));

const copyPose = (pose) => ({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });

function vehicleFootprint(pose, motorcycle) {
  const yaw = Number.isFinite(pose.yaw) ? pose.yaw : 0;
  return { x: pose.x, z: pose.z,
    rightX: Math.cos(yaw), rightZ: -Math.sin(yaw),
    forwardX: Math.sin(yaw), forwardZ: Math.cos(yaw),
    halfWidth: motorcycle ? 0.42 : 0.96,
    halfLength: motorcycle ? 1.05 : 1.86 };
}

function overlapsOnAxis(a, b, dx, dz, ax, az) {
  const separation = Math.abs(dx * ax + dz * az);
  const extentA = a.halfWidth * Math.abs(a.rightX * ax + a.rightZ * az)
    + a.halfLength * Math.abs(a.forwardX * ax + a.forwardZ * az);
  const extentB = b.halfWidth * Math.abs(b.rightX * ax + b.rightZ * az)
    + b.halfLength * Math.abs(b.forwardX * ax + b.forwardZ * az);
  return separation < extentA + extentB;
}

function footprintsOverlap(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return overlapsOnAxis(a, b, dx, dz, a.rightX, a.rightZ)
    && overlapsOnAxis(a, b, dx, dz, a.forwardX, a.forwardZ)
    && overlapsOnAxis(a, b, dx, dz, b.rightX, b.rightZ)
    && overlapsOnAxis(a, b, dx, dz, b.forwardX, b.forwardZ);
}

export class AmbientWorld {
  constructor(scene, collision, { isMobile = false, tileReady = () => true } = {}) {
    this.scene = scene;
    this.collision = collision;
    this.tileReady = tileReady;
    this.externalVehicles = () => [];
    this.radius = isMobile ? 37 : 75;
    this.active = new Map();
    this.geometries = new Map();
    this.materials = new Map();
    this.vehicleStates = new Map();
    this.vehicleConditions = new Map();
    this.trafficStates = new Map();
    this.drivers = new Map();
    this.passengers = new Map();
    this.pedestrianHealth = new Map();
    this.deadPedestrians = new Map();
    this.angryDrivers = new Map();
    this.playerTargets = new Map();
    this.lastAngryContactAt = 0;
    this.revision = 0;
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
    const bodyMaterial = body.material.clone();
    body.material = bodyMaterial;
    const damageMarks = [
      this.box(root, [1.42, 0.035, 0.7], [0, 1.0, 1.15], '#342c2b'),
      this.box(root, [1.42, 0.035, 0.7], [0, 1.0, -1.35], '#342c2b'),
    ];
    for (const mark of damageMarks) mark.visible = false;
    if (!this.geometries.has('smoke')) this.geometries.set('smoke', new THREE.SphereGeometry(0.28, 7, 5));
    const smoke = new THREE.Mesh(this.geometries.get('smoke'), this.material('#404342'));
    smoke.position.set(0.2, 1.3, 1.22);
    smoke.visible = false;
    root.add(smoke);
    this.box(root, [1.46, 0.58, 1.85], [0, 1.18, -0.24], GLASS, 0.18);
    this.box(root, [1.48, 0.08, 1.68], [0, 1.52, -0.24], paint, 0.17);
    const bumpers = [
      this.box(root, [1.82, 0.18, 0.18], [0, 0.44, 1.87], '#293036'),
      this.box(root, [1.82, 0.18, 0.18], [0, 0.44, -1.87], '#293036'),
    ];
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
    return { root, collider: body, bodyMaterial, basePaint: new THREE.Color(paint), damageMarks, smoke, bumpers };
  }

  makeMotorcycle(paint) {
    const root = new THREE.Group();
    root.name = 'AmbientMotorcycle';
    if (!this.geometries.has('motorcycle-tire')) {
      this.geometries.set('motorcycle-tire', new THREE.CylinderGeometry(0.41, 0.41, 0.17, 12));
    }
    for (const z of [-0.83, 0.83]) {
      const tire = new THREE.Mesh(this.geometries.get('motorcycle-tire'), this.material(RUBBER));
      tire.rotation.z = Math.PI / 2;
      tire.position.set(0, 0.41, z);
      root.add(tire);
      this.box(root, [0.09, 0.58, 0.09], [0, 0.7, z], CHROME, 0.42);
    }
    const body = this.box(root, [0.62, 0.55, 1.62], [0, 0.67, 0], paint, 0.2);
    const bodyMaterial = body.material.clone();
    body.material = bodyMaterial;
    this.box(root, [0.7, 0.36, 0.68], [0, 0.96, 0.12], paint, 0.2);
    this.box(root, [0.57, 0.12, 0.73], [0, 1.02, -0.43], '#252527');
    const handlebar = this.box(root, [0.94, 0.08, 0.08], [0, 1.34, 0.76], CHROME, 0.42);
    this.box(root, [0.33, 0.25, 0.1], [0, 0.93, 0.88], '#f8e6bb');
    this.box(root, [0.3, 0.14, 0.1], [0, 0.84, -0.9], '#ba3231');
    const damageMarks = [this.box(root, [0.5, 0.03, 0.38], [0, 1.16, 0.1], '#302725')];
    damageMarks[0].visible = false;
    if (!this.geometries.has('motorcycle-smoke')) {
      this.geometries.set('motorcycle-smoke', new THREE.SphereGeometry(0.18, 7, 5));
    }
    const smoke = new THREE.Mesh(this.geometries.get('motorcycle-smoke'), this.material('#404342'));
    smoke.position.set(0.24, 0.86, -0.8);
    smoke.visible = false;
    root.add(smoke);
    return { root, collider: body, bodyMaterial, basePaint: new THREE.Color(paint),
      damageMarks, smoke, handlebar };
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
      : definition.type === 'motorcycle' ? this.makeMotorcycle(definition.paint) : this.makeCar(definition.paint);
    instance.kind = kind;
    instance.type = definition.type || 'car';
    instance.id = definition.id;
    instance.root.position.set(pose.x, pose.y, pose.z);
    instance.root.rotation.y = pose.yaw + (kind === 'pedestrian' ? Math.PI : 0);
    this.scene.add(instance.root);
    instance.root.updateMatrixWorld(true);
    instance.colliderRegistered = false;
    if (kind !== 'pedestrian' && !this.drivers.has(definition.id)
      && (kind === 'parked' || this.vehicleStates.has(definition.id))) {
      instance.collider.userData.noClimb = true;
      this.collision.add(instance.collider);
      instance.colliderRegistered = true;
    }
    this.active.set(definition.id, instance);
  }

  deactivate(id) {
    const instance = this.active.get(id);
    if (!instance) return;
    if (instance.colliderRegistered) this.collision.remove(instance.collider);
    instance.bodyMaterial?.dispose();
    this.scene.remove(instance.root);
    instance.root.clear();
    this.active.delete(id);
  }

  nearestVehicle(position, maxDistance = 3.3, passenger = false) {
    let closest = null;
    let best = maxDistance * maxDistance;
    for (const [id, instance] of this.active) {
      if (instance.kind === 'pedestrian' || (passenger ? this.passengers.has(id) : this.drivers.has(id))) continue;
      const dx = instance.root.position.x - position.x;
      const dz = instance.root.position.z - position.z;
      const distance = dx * dx + dz * dz;
      if (distance < best && Math.abs(instance.root.position.y - position.y) < 2.2) {
        best = distance;
        closest = { id, kind: instance.kind, type: instance.type,
          pose: { x: instance.root.position.x, y: instance.root.position.y,
          z: instance.root.position.z, yaw: instance.root.rotation.y } };
      }
    }
    return closest;
  }

  setPassenger(id, playerId) {
    if (!VEHICLE_IDS.has(id) || this.drivers.get(id)?.playerId === playerId) return false;
    const current = this.passengers.get(id);
    if (current && current !== playerId && current < playerId) return false;
    this.releasePassenger(playerId);
    this.passengers.set(id, playerId);
    return true;
  }

  releasePassenger(playerId) {
    for (const [id, passenger] of this.passengers) {
      if (passenger === playerId) this.passengers.delete(id);
    }
  }

  vehiclePose(id) {
    return this.drivers.get(id)?.pose || this.vehicleStates.get(id)?.pose || this.trafficStates.get(id)?.pose || (this.active.has(id)
      ? { x: this.active.get(id).root.position.x, y: this.active.get(id).root.position.y,
        z: this.active.get(id).root.position.z, yaw: this.active.get(id).root.rotation.y }
      : VEHICLE_BY_ID.has(id) && !MOVING_IDS.has(id)
        ? { x: VEHICLE_BY_ID.get(id).position[0], y: VEHICLE_BY_ID.get(id).position[1],
          z: VEHICLE_BY_ID.get(id).position[2], yaw: VEHICLE_BY_ID.get(id).yaw } : null);
  }

  vehicleType(id) { return VEHICLE_BY_ID.get(id)?.type || 'car'; }
  resolveVehicleMovement(id, from, destination) {
    const dx = destination.x - from.x;
    const dz = destination.z - from.z;
    const travelSq = dx * dx + dz * dz;
    if (travelSq < 0.000001) return { x: destination.x, z: destination.z, hitId: null };
    const travel = Math.sqrt(travelSq);
    const own = vehicleFootprint(from, this.vehicleType(id) === 'motorcycle');
    let fraction = 1;
    let hitId = null;
    for (const other of [...VEHICLES, ...this.externalVehicles()]) {
      if (other.id === id) continue;
      const pose = other.pose || this.vehiclePose(other.id);
      if (!pose || Math.abs(pose.y - from.y) > 2.1) continue;
      const target = vehicleFootprint(pose, other.type === 'motorcycle');
      const centerDistance = Math.hypot(from.x - target.x, from.z - target.z);
      if (centerDistance > travel + 4.5) continue;
      own.x = from.x;
      own.z = from.z;
      if (footprintsOverlap(own, target)) {
        if (Math.hypot(destination.x - target.x, destination.z - target.z) < centerDistance) {
          fraction = 0;
          hitId = other.id;
        }
        continue;
      }
      const steps = Math.max(1, Math.ceil(travel / 0.25));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        if (t > fraction) break;
        own.x = from.x + dx * t;
        own.z = from.z + dz * t;
        if (!footprintsOverlap(own, target)) continue;
        fraction = Math.max(0, (step - 1) / steps - 0.02 / travel);
        hitId = other.id;
        break;
      }
    }
    return { x: from.x + dx * fraction, z: from.z + dz * fraction, hitId };
  }

  updateTraffic(delta, timeMs) {
    for (const item of MOVING_VEHICLES) {
      if (this.drivers.has(item.id) || this.vehicleStates.has(item.id)) continue;
      let state = this.trafficStates.get(item.id);
      if (!state) {
        state = { pose: sampleRoute(item.path, item.speed, item.phase, timeMs), delayMs: 0 };
        this.trafficStates.set(item.id, state);
        continue;
      }
      const next = sampleRoute(item.path, item.speed, item.phase, timeMs - state.delayMs);
      if (!next) continue;
      const advance = Math.hypot(next.x - state.pose.x, next.z - state.pose.z);
      // A clock resync or background tab can skip an entire route; resume without a long sweep.
      if (advance > item.speed * Math.max(delta, 0.05) * 3 + 1) {
        state.pose = next;
        continue;
      }
      const movement = this.resolveVehicleMovement(item.id, state.pose, next);
      if (movement.hitId) state.delayMs += Math.max(0, delta) * 1000;
      else state.pose = next;
    }
  }

  conditionOf(id) { return this.vehicleConditions.get(id) ?? 100; }

  damageVehicle(id, amount) {
    if (!VEHICLE_IDS.has(id) || !(amount > 0)) return this.conditionOf(id);
    const condition = Math.max(0, Math.round(this.conditionOf(id) - amount));
    this.vehicleConditions.set(id, condition);
    return condition;
  }

  applyCarDamage(instance, condition, timeMs) {
    if (!instance?.bodyMaterial) return;
    if (instance.lastCondition !== condition) {
      const damage = (100 - condition) / 100;
      instance.bodyMaterial.color.copy(instance.basePaint).lerp(new THREE.Color('#262323'), damage * 0.67);
      if (instance.bumpers) {
        instance.bumpers[0].rotation.y = damage * 0.22;
        instance.bumpers[0].position.z = 1.87 + damage * 0.18;
        instance.bumpers[1].rotation.y = -damage * 0.16;
        instance.bumpers[1].position.z = -1.87 - damage * 0.11;
      }
      if (instance.handlebar) instance.handlebar.rotation.y = damage * 0.3;
      instance.damageMarks[0].visible = condition <= 70;
      if (instance.damageMarks[1]) instance.damageMarks[1].visible = condition <= 35;
      instance.smoke.visible = condition <= 25;
      instance.lastCondition = condition;
    }
    if (instance.smoke.visible) instance.smoke.position.y = 1.3 + Math.sin(timeMs / 350) * 0.12;
  }

  raycastPedestrian(ray, mapHit, maxDistance = 70) {
    const wallDistance = mapHit ? ray.origin.distanceTo(mapHit) : maxDistance;
    let nearest = null;
    for (const [id, instance] of this.active) {
      if (instance.kind !== 'pedestrian' || this.deadPedestrians.has(id)) continue;
      for (const height of [0.45, 1.15]) {
        const center = instance.root.position.clone().add(new THREE.Vector3(0, height, 0));
        const point = ray.intersectSphere(new THREE.Sphere(center, 0.42), new THREE.Vector3());
        if (!point) continue;
        const distance = ray.origin.distanceTo(point);
        if (distance < wallDistance - 0.03 && distance <= maxDistance
          && (!nearest || distance < nearest.distance)) nearest = { id, point, distance };
      }
    }
    return nearest;
  }

  hitPedestrian(id, amount, now = Date.now()) {
    if (!PEDESTRIAN_IDS.has(id) || this.deadPedestrians.has(id) || !(amount > 0)) return false;
    const instance = this.active.get(id);
    if (!instance) return false;
    const health = Math.max(0, (this.pedestrianHealth.get(id) ?? 50) - amount);
    this.pedestrianHealth.set(id, health);
    if (health > 0) return false;
    const position = instance.root.position;
    this.deadPedestrians.set(id, { id, until: now + 90000,
      x: position.x, y: position.y, z: position.z, yaw: instance.root.rotation.y - Math.PI });
    return true;
  }

  hitPedestriansNear(position, radius, now = Date.now()) {
    const killed = [];
    for (const [id, instance] of this.active) {
      if (instance.kind !== 'pedestrian' || this.deadPedestrians.has(id)) continue;
      if (Math.abs(instance.root.position.y - position.y) > 2) continue;
      if (Math.hypot(instance.root.position.x - position.x,
        instance.root.position.z - position.z) <= radius && this.hitPedestrian(id, 50, now)) killed.push(id);
    }
    return killed;
  }

  networkNpcStates() { return [...this.deadPedestrians.values()]; }

  receiveNpcStates(states) {
    for (const state of states || []) {
      if (!PEDESTRIAN_IDS.has(state.id) || !Number.isFinite(state.until)) continue;
      const previous = this.deadPedestrians.get(state.id);
      if (!previous || state.until > previous.until) {
        this.deadPedestrians.set(state.id, { id: state.id, until: state.until,
          x: state.x, y: state.y, z: state.z, yaw: state.yaw });
      }
    }
  }

  setDrivenPose(id, playerId, pose, local = false) {
    if (!VEHICLE_IDS.has(id) || ![pose.x, pose.y, pose.z, pose.yaw].every(Number.isFinite)) return false;
    const current = this.drivers.get(id);
    // Two clients can enter simultaneously. The same playerId wins on every client.
    if (current && current.playerId !== playerId && current.playerId < playerId) return false;
    if (current && current.playerId !== playerId) this.drivers.delete(id);
    if (!current && MOVING_IDS.has(id) && !this.vehicleStates.has(id)
      && !this.angryDrivers.has(id)) this.spawnAngryDriver(id, playerId, pose);
    this.releasePassenger(playerId);
    this.drivers.set(id, { playerId, pose: copyPose(pose), local });
    const instance = this.active.get(id);
    if (instance?.colliderRegistered) {
      this.collision.remove(instance.collider);
      instance.colliderRegistered = false;
    }
    return true;
  }

  spawnAngryDriver(id, targetId, pose) {
    const visual = this.makePedestrian({
      shirtPrimaryColor: 'red', pantsColor: 'blue', hairColor: 'black', skinTone: 'medium',
    });
    visual.root.name = 'AngryDriver';
    visual.root.position.set(pose.x + Math.cos(pose.yaw) * 1.5, pose.y, pose.z - Math.sin(pose.yaw) * 1.5);
    this.scene.add(visual.root);
    this.angryDrivers.set(id, { ...visual, targetId, until: Date.now() + 30000 });
  }

  setPlayerTarget(id, position) {
    this.playerTargets.set(id, { x: position.x, y: position.y, z: position.z, seenAt: Date.now() });
  }

  angryDriverTouches(id, position, now = Date.now()) {
    if (now - this.lastAngryContactAt < 1800) return false;
    for (const driver of this.angryDrivers.values()) {
      if (driver.targetId !== id) continue;
      if (Math.hypot(driver.root.position.x - position.x,
        driver.root.position.z - position.z) < 1.2 && Math.abs(driver.root.position.y - position.y) < 2) {
        this.lastAngryContactAt = now;
        return true;
      }
    }
    return false;
  }

  parkVehicle(id, playerId, pose) {
    const driver = this.drivers.get(id);
    if (!driver || driver.playerId !== playerId) return false;
    this.drivers.delete(id);
    this.revision += 1;
    this.vehicleStates.set(id, { id, pose: copyPose(pose), revision: this.revision,
      author: playerId, condition: this.conditionOf(id) });
    return true;
  }

  releaseDriver(playerId) {
    for (const [id, driver] of [...this.drivers]) {
      if (driver.playerId === playerId) this.parkVehicle(id, playerId, driver.pose);
    }
  }

  receiveVehicleSnapshot(snapshot) {
    for (const state of snapshot.vehicleStates || []) {
      if (!VEHICLE_IDS.has(state.id)) continue;
      this.revision = Math.max(this.revision, state.revision);
      const previous = this.vehicleStates.get(state.id);
      if (!previous || state.revision > previous.revision
        || (state.revision === previous.revision && state.author > previous.author)) {
        this.vehicleStates.set(state.id, { ...state, pose: copyPose(state.pose) });
      }
      if (Number.isInteger(state.condition)) {
        this.vehicleConditions.set(state.id, Math.min(this.conditionOf(state.id), state.condition));
      }
    }
    if (snapshot.vehicleId && Number.isInteger(snapshot.vehicleCondition)) {
      this.vehicleConditions.set(snapshot.vehicleId,
        Math.min(this.conditionOf(snapshot.vehicleId), snapshot.vehicleCondition));
    }
    const oldId = [...this.drivers].find(([, driver]) => driver.playerId === snapshot.playerId)?.[0];
    if (oldId && oldId !== snapshot.vehicleId) this.releaseDriver(snapshot.playerId);
    if (snapshot.vehicleRole === 'passenger') {
      if (oldId) this.releaseDriver(snapshot.playerId);
      if (snapshot.vehicleId) return this.setPassenger(snapshot.vehicleId, snapshot.playerId);
    }
    this.releasePassenger(snapshot.playerId);
    if (snapshot.vehicleId) {
      return this.setDrivenPose(snapshot.vehicleId, snapshot.playerId,
        { ...snapshot.position, yaw: snapshot.rotation });
    }
    return true;
  }

  networkVehicleStates() {
    return [...this.vehicleStates.values()].map((state) => ({ ...state,
      condition: this.conditionOf(state.id), pose: copyPose(state.pose) }));
  }

  update(delta, playerPosition, timeMs = Date.now()) {
    if (this.disposed) return;
    this.updateTraffic(delta, timeMs);
    for (const [id, angry] of this.angryDrivers) {
      if (Date.now() >= angry.until) {
        this.scene.remove(angry.root);
        angry.root.clear();
        this.angryDrivers.delete(id);
        continue;
      }
      const target = this.playerTargets.get(angry.targetId);
      if (!target || Date.now() - target.seenAt > 5000) continue;
      const dx = target.x - angry.root.position.x;
      const dz = target.z - angry.root.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1 && distance < 30) {
        const step = Math.min(distance - 1, 2.4 * delta);
        const direction = new THREE.Vector3(dx / distance * step, 0, dz / distance * step);
        const moved = this.collision.resolveHorizontalMovement(angry.root.position, direction, 0.24, 1.4);
        angry.root.position.x = moved.x;
        angry.root.position.z = moved.z;
        const ground = this.collision.groundHeightAt(moved.x, moved.z, angry.root.position.y, 0.8, 2);
        if (Number.isFinite(ground)) angry.root.position.y = ground;
        angry.root.rotation.y = Math.atan2(-dx, -dz);
        angry.visual.update(delta, 'Running');
      } else angry.visual.update(delta, 'Idle');
      angry.root.visible = angry.root.position.distanceToSquared(playerPosition) < this.radius * this.radius;
    }
    for (const [id, state] of this.deadPedestrians) {
      if (state.until <= Date.now()) {
        this.deadPedestrians.delete(id);
        this.pedestrianHealth.delete(id);
      }
    }
    this.cullElapsed += delta;
    const recull = this.cullElapsed >= 0.22;
    if (recull) this.cullElapsed = 0;
    const radiusSq = this.radius * this.radius;

    const visit = (definition, kind, defaultPose) => {
      const driver = this.drivers.get(definition.id);
      const dead = kind === 'pedestrian' ? this.deadPedestrians.get(definition.id) : null;
      const pose = dead || driver?.pose || this.vehicleStates.get(definition.id)?.pose || defaultPose;
      if (!pose) return;
      if (recull) {
        const dx = pose.x - playerPosition.x;
        const dz = pose.z - playerPosition.z;
        const needed = dx * dx + dz * dz <= radiusSq && this.tileReady(pose.x, pose.z);
        if (needed && !this.active.has(definition.id)) this.activate(definition, kind, pose);
        else if (!needed && this.active.has(definition.id)) this.deactivate(definition.id);
      }
      const instance = this.active.get(definition.id);
      if (!instance) return;
      const shouldCollide = kind !== 'pedestrian' && !driver
        && (kind === 'parked' || this.vehicleStates.has(definition.id));
      if (shouldCollide && instance.colliderRegistered
        && instance.root.position.distanceToSquared(new THREE.Vector3(pose.x, pose.y, pose.z)) > 0.0001) {
        this.collision.remove(instance.collider);
        instance.colliderRegistered = false;
      }
      if (instance.colliderRegistered && !shouldCollide) {
        this.collision.remove(instance.collider);
        instance.colliderRegistered = false;
      }
      if (driver && !driver.local) {
        const alpha = 1 - Math.exp(-12 * delta);
        instance.root.position.lerp(new THREE.Vector3(pose.x, pose.y, pose.z), alpha);
        const difference = Math.atan2(Math.sin(pose.yaw - instance.root.rotation.y), Math.cos(pose.yaw - instance.root.rotation.y));
        instance.root.rotation.y += difference * alpha;
      } else {
        instance.root.position.set(pose.x, pose.y, pose.z);
        instance.root.rotation.y = pose.yaw + (kind === 'pedestrian' ? Math.PI : 0);
      }
      if (kind === 'pedestrian') instance.root.rotation.x = dead ? -Math.PI / 2 : 0;
      if (shouldCollide && !instance.colliderRegistered) {
        instance.root.updateMatrixWorld(true);
        instance.collider.userData.noClimb = true;
        this.collision.add(instance.collider);
        instance.colliderRegistered = true;
      }
      if (kind === 'pedestrian') instance.visual.update(delta, dead ? 'Idle' : 'Walking');
      else this.applyCarDamage(instance, this.conditionOf(definition.id), timeMs);
    };

    for (const item of PARKED_VEHICLES) {
      visit(item, 'parked', { x: item.position[0], y: item.position[1], z: item.position[2], yaw: item.yaw });
    }
    for (const item of MOVING_VEHICLES) visit(item, 'moving', this.trafficStates.get(item.id)?.pose);
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
    this.vehicleConditions.clear();
    this.trafficStates.clear();
    this.passengers.clear();
    this.pedestrianHealth.clear();
    this.deadPedestrians.clear();
    for (const angry of this.angryDrivers.values()) {
      this.scene.remove(angry.root);
      angry.root.clear();
    }
    this.angryDrivers.clear();
    this.playerTargets.clear();
    this.externalVehicles = () => [];
  }
}
