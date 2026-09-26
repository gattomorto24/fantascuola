import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
const rayOrigin = new THREE.Vector3();
const boxSize = new THREE.Vector3();
const resolved = new THREE.Vector3();

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function finiteBox(box) {
  return Number.isFinite(box.min.x) && Number.isFinite(box.min.y) && Number.isFinite(box.min.z)
    && Number.isFinite(box.max.x) && Number.isFinite(box.max.y) && Number.isFinite(box.max.z);
}

export class WorldCollision {
  constructor({
    cellSize = 14,
    maxCellsPerMesh = 196,
    groundCacheStep = 0.5,
    maxRaycastMeshes = 28,
  } = {}) {
    this.cellSize = cellSize;
    this.maxCellsPerMesh = maxCellsPerMesh;
    this.groundCacheStep = groundCacheStep;
    this.maxRaycastMeshes = maxRaycastMeshes;

    this.raycaster = new THREE.Raycaster();
    this.proxies = [];
    this.cells = new Map();
    this.globalIndices = [];
    this.groundCache = new Map();
    this.ready = false;
  }

  clear() {
    this.proxies.length = 0;
    this.cells.clear();
    this.globalIndices.length = 0;
    this.groundCache.clear();
    this.ready = false;
  }

  async build(root, onProgress = () => {}) {
    this.clear();
    root.updateMatrixWorld(true);

    const meshes = [];
    root.traverse((node) => {
      if (node.isMesh && node.visible !== false && node.geometry?.attributes?.position) meshes.push(node);
    });

    const total = Math.max(1, meshes.length);

    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      const geometry = mesh.geometry;

      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox) continue;

      const box = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      if (box.isEmpty() || !finiteBox(box)) continue;

      const size = box.getSize(new THREE.Vector3());
      const footprint = Math.max(size.x, size.z);
      const terrainLike = (size.x > 70 && size.z > 70)
        || (size.y <= 1.2 && footprint >= 5)
        || (size.y > 0 && size.x > size.y * 12 && size.z > size.y * 12);

      const proxy = {
        mesh,
        box,
        terrainLike,
        obstacle: !terrainLike && size.y > 0.45,
      };

      const index = this.proxies.push(proxy) - 1;
      this.indexProxy(index, proxy);

      if (i % 80 === 0) {
        onProgress(i / total);
        await nextFrame();
      }
    }

    this.ready = this.proxies.length > 0;
    onProgress(1);
    return {
      meshes: this.proxies.length,
      indexedCells: this.cells.size,
      globalMeshes: this.globalIndices.length,
    };
  }

  indexProxy(index, proxy) {
    const minX = Math.floor(proxy.box.min.x / this.cellSize);
    const maxX = Math.floor(proxy.box.max.x / this.cellSize);
    const minZ = Math.floor(proxy.box.min.z / this.cellSize);
    const maxZ = Math.floor(proxy.box.max.z / this.cellSize);

    const width = maxX - minX + 1;
    const depth = maxZ - minZ + 1;
    if (width * depth > this.maxCellsPerMesh) {
      this.globalIndices.push(index);
      return;
    }

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const key = `${x}:${z}`;
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(index);
      }
    }
  }

  candidateIndices(x, z, radius = 0.5) {
    if (!this.ready) return [];

    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    const unique = new Set(this.globalIndices);

    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cz = minZ; cz <= maxZ; cz += 1) {
        const list = this.cells.get(`${cx}:${cz}`);
        if (!list) continue;
        for (const index of list) unique.add(index);
      }
    }

    return [...unique];
  }

  groundHeightAt(x, z, referenceY = 0, maxStep = 0.65, maxDrop = 8) {
    if (!this.ready) return null;

    const qx = Math.round(x / this.groundCacheStep);
    const qz = Math.round(z / this.groundCacheStep);
    const qy = Math.round(referenceY / 2);
    const cacheKey = `${qx}:${qz}:${qy}`;
    if (this.groundCache.has(cacheKey)) return this.groundCache.get(cacheKey);

    const indices = this.candidateIndices(x, z, 0.8);
    const minimumY = referenceY - maxDrop;
    const maximumY = referenceY + maxStep + 0.12;

    const candidates = [];
    let boxFallback = null;

    for (const index of indices) {
      const proxy = this.proxies[index];
      const box = proxy.box;

      if (x < box.min.x - 0.08 || x > box.max.x + 0.08 || z < box.min.z - 0.08 || z > box.max.z + 0.08) continue;
      if (box.max.y < minimumY - 0.5 || box.min.y > maximumY + 1.5) continue;

      if (box.max.y <= maximumY && box.max.y >= minimumY) {
        if (boxFallback === null || box.max.y > boxFallback) boxFallback = box.max.y;
      }

      candidates.push(proxy);
    }

    candidates.sort((a, b) => {
      const da = Math.abs(referenceY - a.box.max.y);
      const db = Math.abs(referenceY - b.box.max.y);
      if (a.terrainLike !== b.terrainLike) return a.terrainLike ? -1 : 1;
      return da - db;
    });

    const meshes = candidates.slice(0, this.maxRaycastMeshes).map((item) => item.mesh);
    let height = null;

    if (meshes.length) {
      const startY = referenceY + maxStep + 1.25;
      rayOrigin.set(x, startY, z);
      this.raycaster.set(rayOrigin, DOWN);
      this.raycaster.near = 0;
      this.raycaster.far = maxDrop + maxStep + 2.5;

      const hits = this.raycaster.intersectObjects(meshes, false);
      for (const hit of hits) {
        const y = hit.point.y;
        if (y <= maximumY && y >= minimumY) {
          height = y;
          break;
        }
      }
    }

    if (height === null) height = boxFallback;

    if (this.groundCache.size > 5000) this.groundCache.clear();
    this.groundCache.set(cacheKey, height);
    return height;
  }

  resolveHorizontalMovement(position, movement, radius = 0.34, height = 1.8, stepHeight = 0.55) {
    resolved.copy(position);
    resolved.x += movement.x;
    resolved.z += movement.z;

    if (!this.ready || (movement.x === 0 && movement.z === 0)) return resolved;

    const searchRadius = radius + Math.max(Math.abs(movement.x), Math.abs(movement.z)) + 0.3;
    const indices = this.candidateIndices(resolved.x, resolved.z, searchRadius);
    const bodyBottom = position.y + stepHeight + 0.04;
    const bodyTop = position.y + height - 0.08;

    // A few passes are enough to slide a capsule-like point out of nearby static AABBs.
    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;

      for (const index of indices) {
        const proxy = this.proxies[index];
        if (!proxy.obstacle) continue;

        const box = proxy.box;
        if (box.max.y <= bodyBottom || box.min.y >= bodyTop) continue;

        const minX = box.min.x - radius;
        const maxX = box.max.x + radius;
        const minZ = box.min.z - radius;
        const maxZ = box.max.z + radius;

        if (resolved.x <= minX || resolved.x >= maxX || resolved.z <= minZ || resolved.z >= maxZ) continue;

        const pushLeft = resolved.x - minX;
        const pushRight = maxX - resolved.x;
        const pushBack = resolved.z - minZ;
        const pushForward = maxZ - resolved.z;
        const minPush = Math.min(pushLeft, pushRight, pushBack, pushForward);

        if (minPush === pushLeft) resolved.x = minX;
        else if (minPush === pushRight) resolved.x = maxX;
        else if (minPush === pushBack) resolved.z = minZ;
        else resolved.z = maxZ;

        changed = true;
      }

      if (!changed) break;
    }

    return resolved;
  }
}
