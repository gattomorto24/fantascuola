import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AmbientWorld } from '../js/world/AmbientWorld.js';
import { PARKED_CARS, MOVING_CARS, PEDESTRIANS } from '../js/world/AmbientMapData.js';
import { WorldCollision } from '../js/world/WorldCollision.js';
import { VehicleController } from '../js/player/VehicleController.js';
import { WantedState } from '../js/world/WantedState.js';
import { PoliceSystem } from '../js/world/PoliceSystem.js';
import { loadGraphicsSettings, saveGraphicsSettings, normalizeGraphicsSettings } from '../js/ui/GraphicsSettings.js';

function player(x, y, z) {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  return { root, movementState: 'Idle',
    weapon: { drawn: false, setDrawn(value) { this.drawn = value; } },
    setVehiclePresence(value) { this.inVehicle = value; }, updateVisual() {} };
}

function world(ambient) {
  return { ambient, streamedMap: null,
    resolveHorizontalMovement(position, movement) { return position.clone().add(movement); },
    groundHeightAt(_x, _z, referenceY) { return referenceY; } };
}

test('il passeggero segue l’auto guidata da un altro giocatore e scende senza parcheggiarla', () => {
  const ambient = new AmbientWorld(new THREE.Scene(), new WorldCollision());
  const car = PARKED_CARS[0];
  const driver = player(car.position[0] + 1, car.position[1], car.position[2]);
  const passenger = player(car.position[0] - 1, car.position[1], car.position[2]);
  const gameWorld = world(ambient);
  const drive = new VehicleController(driver, gameWorld, { yaw: 0, pitch: 0 }, 'driver');
  const ride = new VehicleController(passenger, gameWorld, { yaw: 0, pitch: 0 }, 'passenger');
  try {
    ambient.update(0.25, driver.root.position, 0);
    assert.equal(drive.enter(), true);
    assert.equal(ride.enterPassenger(), true);
    assert.equal(ride.role, 'passenger');
    assert.equal(drive.driving, true);
    drive.update(0.05, { moveX: 0, moveY: 1 });
    ride.update(0.05, {});
    assert.equal(passenger.root.position.z, driver.root.position.z);
    assert.equal(ride.exit(), true);
    assert.equal(ambient.drivers.get(car.id).playerId, 'driver');
    assert.equal(ambient.passengers.has(car.id), false);
  } finally { ambient.dispose(); }
});

test('gli urti consumano l’auto, mostrano danni progressivi e sincronizzano la condizione', () => {
  const ambient = new AmbientWorld(new THREE.Scene(), new WorldCollision());
  const other = new AmbientWorld(new THREE.Scene(), new WorldCollision());
  const car = PARKED_CARS[0];
  const avatar = player(car.position[0] + 1, car.position[1], car.position[2]);
  const gameWorld = { ...world(ambient), resolveHorizontalMovement(position) { return position.clone(); } };
  const drive = new VehicleController(avatar, gameWorld, { yaw: 0, pitch: 0 }, 'driver');
  try {
    ambient.update(0.25, avatar.root.position, 0);
    assert.equal(drive.enter(), true);
    drive.speed = 8;
    drive.update(0.05, { moveX: 0, moveY: 1 });
    assert.ok(ambient.conditionOf(car.id) < 100);
    ambient.damageVehicle(car.id, 75);
    ambient.update(0.25, avatar.root.position, 0);
    assert.equal(ambient.active.get(car.id).smoke.visible, true);
    assert.ok(ambient.active.get(car.id).bumpers[0].rotation.y > 0);
    drive.exit();
    other.receiveVehicleSnapshot({ playerId: 'driver', position: { x: 0, y: 0, z: 0 }, rotation: 0,
      vehicleStates: ambient.networkVehicleStates() });
    assert.equal(other.conditionOf(car.id), ambient.conditionOf(car.id));
  } finally { ambient.dispose(); other.dispose(); }
});

test('i passanti possono morire e il loro stato arriva agli altri client', () => {
  const ambient = new AmbientWorld(new THREE.Scene(), new WorldCollision());
  const other = new AmbientWorld(new THREE.Scene(), new WorldCollision());
  const id = PEDESTRIANS[0].id;
  const near = { x: -16, y: 0, z: 20 };
  try {
    ambient.update(0.25, near, 0);
    assert.equal(ambient.hitPedestrian(id, 25), false);
    assert.equal(ambient.hitPedestrian(id, 25), true);
    ambient.update(0.25, near, 0);
    assert.equal(ambient.active.get(id).root.rotation.x, -Math.PI / 2);
    other.receiveNpcStates(ambient.networkNpcStates());
    other.update(0.25, near, 0);
    assert.equal(other.deadPedestrians.has(id), true);
    assert.equal(other.active.get(id).root.rotation.x, -Math.PI / 2);
  } finally { ambient.dispose(); other.dispose(); }
});

test('rubare un’auto del traffico fa apparire l’autista arrabbiato', () => {
  const ambient = new AmbientWorld(new THREE.Scene(), new WorldCollision());
  const car = MOVING_CARS[0];
  const near = { x: car.path[0][0], y: car.path[0][1], z: car.path[0][2] };
  try {
    ambient.update(0.25, near, 0);
    const pose = ambient.vehiclePose(car.id);
    assert.ok(pose);
    assert.equal(ambient.setDrivenPose(car.id, 'thief', pose, true), true);
    assert.equal(ambient.angryDrivers.has(car.id), true);
    ambient.setPlayerTarget('thief', near);
    ambient.update(0.1, near, 0);
    assert.equal(ambient.angryDrivers.get(car.id).root.name, 'AngryDriver');
  } finally { ambient.dispose(); }
});

test('notorietà e polizia crescono coi crimini, inseguono e decadono', () => {
  const wanted = new WantedState();
  assert.equal(wanted.crime(2, 1000), 2);
  assert.equal(wanted.update(46000), 1);
  const scene = new THREE.Scene();
  const police = new PoliceSystem(scene, world(null));
  try {
    const target = new THREE.Vector3(0, 0, 0);
    const initial = police.updateLocal('local', 1, target, 0, 0.05);
    for (let i = 0; i < 100; i += 1) police.updateLocal('local', 1, target, 0, 0.05);
    assert.ok(police.poseOf('local').z > initial.z);
    police.receive({ playerId: 'remote', wanted: 2,
      policePose: { x: 10, y: 0, z: 12, yaw: 0 } });
    assert.equal(police.units.has('remote'), true);
    police.receive({ playerId: 'remote', wanted: 0 });
    assert.equal(police.units.has('remote'), false);
    wanted.clear();
    assert.equal(wanted.stars, 0);
  } finally { police.dispose(); }
});

test('impostazioni grafiche partono da Bassa e si salvano fino a Ultra', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(loadGraphicsSettings(storage), { quality: 'low', distance: 'normal' });
  saveGraphicsSettings({ quality: 'ultra', distance: 'far' }, storage);
  assert.deepEqual(loadGraphicsSettings(storage), { quality: 'ultra', distance: 'far' });
  assert.deepEqual(normalizeGraphicsSettings({ quality: 'invalid', distance: 'invalid' }),
    { quality: 'low', distance: 'normal' });
});
