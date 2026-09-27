import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AmbientWorld } from '../js/world/AmbientWorld.js';
import { PARKED_CARS, MOVING_CARS } from '../js/world/AmbientMapData.js';
import { WorldCollision } from '../js/world/WorldCollision.js';
import { VehicleController } from '../js/player/VehicleController.js';

test('si sale su un’auto, si guida in coordinate globali e si parcheggia con collisione', () => {
  const scene = new THREE.Scene();
  const collision = new WorldCollision();
  const ambient = new AmbientWorld(scene, collision, { isMobile: true });
  const car = PARKED_CARS[0];
  const player = {
    root: new THREE.Group(), movementState: 'Idle',
    weapon: { drawn: true, setDrawn(value) { this.drawn = value; } },
    setVehiclePresence(value) { this.inVehicle = value; },
    updateVisual() {},
  };
  player.root.position.set(car.position[0] + 2, car.position[1], car.position[2]);
  const world = {
    ambient, collision, streamedMap: null,
    resolveHorizontalMovement(position, delta) { return position.clone().add(delta); },
    groundHeightAt() { return car.position[1]; },
  };
  const camera = { yaw: 0, pitch: 0 };
  const drive = new VehicleController(player, world, camera, 'driver-a');
  try {
    ambient.update(0.25, player.root.position, 0);
    assert.equal(drive.enter(), true);
    assert.equal(player.inVehicle, true);
    assert.equal(player.weapon.drawn, false);
    assert.equal(collision.roots.has(ambient.active.get(car.id).collider), false);
    for (let i = 0; i < 30; i += 1) drive.update(1 / 30, { moveX: 0, moveY: 1 });
    for (let i = 0; i < 12; i += 1) drive.update(1 / 30, { moveX: 1, moveY: 1 });
    ambient.update(0.25, player.root.position, 0);
    assert.ok(player.root.position.z > car.position[2] + 2);
    assert.ok(player.root.position.x > car.position[0]);
    assert.equal(ambient.active.get(car.id).root.position.z, player.root.position.z);
    assert.equal(drive.exit(), true);
    ambient.update(0.25, player.root.position, 0);
    assert.equal(player.inVehicle, false);
    assert.equal(player.weapon.drawn, true);
    assert.equal(collision.roots.has(ambient.active.get(car.id).collider), true);
    assert.equal(ambient.networkVehicleStates()[0].id, car.id);
    assert.ok(ambient.networkVehicleStates()[0].pose.z > car.position[2] + 2);
  } finally { ambient.dispose(); }
});

test('una seconda sessione vede posizione e guidatore della stessa auto, anche per il traffico', () => {
  const a = new AmbientWorld(new THREE.Scene(), new WorldCollision());
  const b = new AmbientWorld(new THREE.Scene(), new WorldCollision());
  const id = MOVING_CARS[0].id;
  const pose = { x: -9, y: -7, z: 140, yaw: 0.4 };
  try {
    assert.equal(a.setDrivenPose(id, 'player-a', pose, true), true);
    b.receiveVehicleSnapshot({ playerId: 'player-a', vehicleId: id,
      position: { x: pose.x, y: pose.y, z: pose.z }, rotation: pose.yaw });
    b.update(0.25, { x: pose.x, z: pose.z }, 0);
    assert.equal(b.drivers.get(id).playerId, 'player-a');
    assert.equal(b.active.get(id).root.position.z, pose.z);
    a.parkVehicle(id, 'player-a', pose);
    b.receiveVehicleSnapshot({ playerId: 'player-a', position: { x: 0, y: 0, z: 0 }, rotation: 0,
      vehicleStates: a.networkVehicleStates() });
    b.update(0.25, { x: pose.x, z: pose.z }, 0);
    assert.equal(b.drivers.has(id), false);
    assert.equal(b.vehicleStates.get(id).pose.z, pose.z);
    assert.ok(b.collision.proxies.length > 0);
  } finally { a.dispose(); b.dispose(); }
});
