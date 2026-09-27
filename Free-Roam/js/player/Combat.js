import * as THREE from 'three';

export const MAX_HEALTH = 100;
export const PISTOL_DAMAGE = 25;
export const SHOT_RANGE = 70;

const bodyOffsets = [0.48, 1.18];
const bodyRadius = 0.43;

function nearestBodyHit(ray, position, radius = bodyRadius) {
  let nearest = null;
  for (const height of bodyOffsets) {
    const sphere = new THREE.Sphere(
      new THREE.Vector3(position.x, position.y + height, position.z), radius,
    );
    const hit = ray.intersectSphere(sphere, new THREE.Vector3());
    if (hit && (!nearest || hit.distanceToSquared(ray.origin) < nearest.distanceToSquared(ray.origin))) {
      nearest = hit;
    }
  }
  return nearest;
}

export function findPlayerHit(ray, mapHit, players, maxDistance = SHOT_RANGE) {
  const mapDistance = mapHit ? ray.origin.distanceTo(mapHit) : maxDistance;
  let best = null;
  for (const [playerId, player] of players) {
    if (!player.hasSnapshot || player.health === 0) continue;
    const position = player.root.position;
    const hit = nearestBodyHit(ray, position, player.inVehicle ? 1.05 : bodyRadius);
    if (!hit) continue;
    const distance = ray.origin.distanceTo(hit);
    if (distance > maxDistance || distance >= mapDistance - 0.03) continue;
    if (!best || distance < best.distance) best = { playerId, point: hit, distance };
  }
  return best;
}

export function plausibleHit(snapshot, victimPosition, world, victimInVehicle = false) {
  if (!Array.isArray(snapshot.shotOrigin) || !Array.isArray(snapshot.shotTarget)
    || snapshot.shotOrigin.length !== 3 || snapshot.shotTarget.length !== 3
    || !snapshot.shotOrigin.every(Number.isFinite) || !snapshot.shotTarget.every(Number.isFinite)) return false;
  const origin = new THREE.Vector3(...snapshot.shotOrigin);
  const target = new THREE.Vector3(...snapshot.shotTarget);
  const shooter = new THREE.Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z);
  if (origin.distanceTo(shooter) > 12.5) return false;
  const distance = origin.distanceTo(target);
  if (distance < 0.05 || distance > SHOT_RANGE + 1) return false;
  const ray = new THREE.Ray(origin, target.sub(origin).normalize());
  const victimHit = nearestBodyHit(ray, victimPosition, victimInVehicle ? 1.55 : 1.15);
  if (!victimHit || origin.distanceTo(victimHit) > distance + 1.25) return false;
  const wall = world.raycastShot(origin, ray.direction, Math.min(distance, SHOT_RANGE));
  return !wall || origin.distanceTo(wall) >= origin.distanceTo(victimHit) - 0.12;
}

export class CombatState {
  constructor() {
    this.health = MAX_HEALTH;
    this.invulnerableUntil = 0;
  }

  hit(now = Date.now()) {
    if (this.health <= 0 || now < this.invulnerableUntil) return false;
    this.health = Math.max(0, this.health - PISTOL_DAMAGE);
    if (this.health > 0) this.invulnerableUntil = now + 100;
    return true;
  }

  respawn(now = Date.now()) {
    if (this.health > 0) return false;
    this.health = MAX_HEALTH;
    this.invulnerableUntil = now + 1800;
    return true;
  }
}
