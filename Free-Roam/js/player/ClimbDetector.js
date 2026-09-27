import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const normalMatrix = new THREE.Matrix3();
const scratchNormal = new THREE.Vector3();
const origin = new THREE.Vector3();

function forbidden(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (material?.userData?.noClimb || material?.userData?.climbable === false
      || material?.userData?.parkour === false) return true;
  }
  for (let node = mesh; node; node = node.parent) {
    if (node.userData?.noClimb || node.userData?.climbable === false || node.userData?.parkour === false) return true;
  }
  return false;
}

export class ClimbDetector {
  constructor(world, config = {}) {
    this.world = world;
    this.collision = world.collision;
    this.raycaster = new THREE.Raycaster();
    this.config = {
      grabDistance: 0.85,
      ledgeReach: 1.65,
      minWallHeight: 1.15,
      minWallWidth: 0.65,
      maxWallNormalY: 0.52,
      ...config,
    };
    this.meshes = [];
    this.lastCandidates = [];
  }

  nearby(position, radius = 1.5) {
    this.meshes.length = 0;
    if (!this.world.customMapLoaded || !this.collision.ready) return this.meshes;
    const indices = this.collision.candidateIndices(position.x, position.z, radius);
    for (const index of indices) {
      const proxy = this.collision.proxies[index];
      if (!proxy || !proxy.horizontalCollision || forbidden(proxy.mesh)) continue;
      const box = proxy.box;
      if (box.max.y < position.y + 0.15 || box.min.y > position.y + this.config.ledgeReach + 0.4) continue;
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      if (box.max.y - box.min.y < this.config.minWallHeight || width < this.config.minWallWidth) continue;
      if (box.distanceToPoint(position) > radius + 0.5) continue;
      this.meshes.push(proxy.mesh);
      if (this.meshes.length >= 24) break;
    }
    return this.meshes;
  }

  cast(meshes, from, direction, far, kind) {
    if (!meshes.length) return null;
    this.raycaster.set(from, direction);
    this.raycaster.near = 0.02;
    this.raycaster.far = far;
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      if (!hit.face || forbidden(hit.object)) continue;
      normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      scratchNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
      if (kind === 'wall') {
        if (Math.abs(scratchNormal.y) > this.config.maxWallNormalY) continue;
        if (scratchNormal.x * direction.x + scratchNormal.z * direction.z > -0.2) continue;
      } else if (kind === 'floor' && scratchNormal.y < 0.72) continue;
      return { point: hit.point.clone(), normal: scratchNormal.clone(), distance: hit.distance, mesh: hit.object };
    }
    return null;
  }

  wallAt(position, toward, maxDistance = this.config.grabDistance) {
    const meshes = this.nearby(position, maxDistance + 0.8);
    if (!meshes.length) return null;
    const ray = new THREE.Vector3(toward.x, 0, toward.z);
    if (ray.lengthSq() < 0.01) return null;
    ray.normalize();
    let best = null;
    for (const height of [0.55, 1.05, 1.42]) {
      origin.set(position.x, position.y + height, position.z);
      const hit = this.cast(meshes, origin, ray, maxDistance, 'wall');
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }

  // Un bordo è valido soltanto se un raycast trova davvero un piano superiore.
  // La AABB serve a filtrare i candidati, mai a inventare tetti o cornici.
  ledgeAt(position, wall) {
    if (!wall) return null;
    const topMeshes = [];
    for (const index of this.collision.candidateIndices(wall.point.x, wall.point.z, 1.2)) {
      const proxy = this.collision.proxies[index];
      if (!proxy || forbidden(proxy.mesh)) continue;
      if (proxy.box.max.y < position.y + 0.55 || proxy.box.min.y > position.y + this.config.ledgeReach + 0.3) continue;
      topMeshes.push(proxy.mesh);
      if (topMeshes.length >= 28) break;
    }
    const inwardX = -wall.normal.x;
    const inwardZ = -wall.normal.z;
    const startY = position.y + this.config.ledgeReach + 0.22;
    let top = null;
    for (const depth of [-0.22, -0.08, 0.16, 0.36, 0.58]) {
      origin.set(wall.point.x + inwardX * depth, startY, wall.point.z + inwardZ * depth);
      const hit = this.cast(topMeshes, origin, DOWN, this.config.ledgeReach - 0.32, 'floor');
      if (hit && hit.point.y >= position.y + 0.62 && (!top || hit.point.y < top.point.y)) top = hit;
    }
    if (!top) return null;
    const hang = new THREE.Vector3(
      wall.point.x + wall.normal.x * 0.31,
      top.point.y - 1.08,
      wall.point.z + wall.normal.z * 0.31,
    );
    if (Math.hypot(hang.x - position.x, hang.z - position.z) > this.config.grabDistance + 0.18) return null;
    const stand = new THREE.Vector3(
      wall.point.x + inwardX * 0.66,
      top.point.y + 0.025,
      wall.point.z + inwardZ * 0.66,
    );
    origin.set(stand.x, top.point.y + 0.4, stand.z);
    const support = this.cast(topMeshes, origin, DOWN, 0.55, 'floor');
    const canStand = support && Math.abs(support.point.y - top.point.y) < 0.16 && this.clearAbove(stand, topMeshes);
    return { kind: 'ledge', wall, top, hang, stand: canStand ? stand : null, normal: wall.normal.clone() };
  }

  clearAbove(position, meshes = null) {
    const candidates = meshes || this.collision.candidateIndices(position.x, position.z, 0.6)
      .map((index) => this.collision.proxies[index]?.mesh).filter(Boolean);
    for (const [dx, dz] of [[0, 0], [0.17, 0], [-0.17, 0], [0, 0.17], [0, -0.17]]) {
      origin.set(position.x + dx, position.y + 0.08, position.z + dz);
      if (this.cast(candidates, origin, UP, 1.1, 'ceiling')) return false;
    }
    return true;
  }

  scan(position, facing, velocity, input, options = {}) {
    this.lastCandidates.length = 0;
    const reach = options.reach || this.config.grabDistance;
    const directions = [];
    const push = (x, z) => {
      const length = Math.hypot(x, z);
      if (length <= 0.12) return;
      const nx = x / length;
      const nz = z / length;
      if (directions.some((direction) => direction.x * nx + direction.z * nz > 0.96)) return;
      directions.push(new THREE.Vector3(nx, 0, nz));
    };
    push(input.x, input.z);
    push(velocity.x, velocity.z);
    push(facing.x, facing.z);
    let bestLedge = null;
    let bestWall = null;
    for (const direction of directions.slice(0, 3)) {
      const wall = this.wallAt(position, direction, reach);
      if (!wall) continue;
      const dotInput = Math.max(0, direction.x * input.x + direction.z * input.z);
      const dotVelocity = Math.max(0, direction.x * velocity.x + direction.z * velocity.z)
        / Math.max(1, Math.hypot(velocity.x, velocity.z));
      const score = (1 - wall.distance / reach) * 2 + dotInput * 1.5 + dotVelocity * 0.8
        + Math.max(0, 1 - Math.abs(wall.normal.y)) * 0.6;
      const ledge = this.ledgeAt(position, wall);
      if (ledge) {
        ledge.score = score + 5 + Math.max(0, 1 - Math.abs(ledge.hang.y - position.y)) * 0.4;
        this.lastCandidates.push(ledge);
        if (!bestLedge || ledge.score > bestLedge.score) bestLedge = ledge;
      } else if (!bestWall || score > bestWall.score) {
        bestWall = { kind: 'wall', wall, normal: wall.normal.clone(), score };
        this.lastCandidates.push(bestWall);
      }
    }
    return bestLedge || bestWall;
  }
}
