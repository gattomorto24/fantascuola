import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const testPosition = new THREE.Vector3();
const resolved = new THREE.Vector3();
const worldNormal = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function finiteBox(box) {
  return Number.isFinite(box.min.x) && Number.isFinite(box.min.y) && Number.isFinite(box.min.z)
    && Number.isFinite(box.max.x) && Number.isFinite(box.max.y) && Number.isFinite(box.max.z);
}

function triangleCount(geometry) {
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  return Math.floor((geometry.attributes?.position?.count || 0) / 3);
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
    this.roots = new Map();
    this.ready = false;
  }

  clear() {
    this.proxies.length = 0;
    this.cells.clear();
    this.globalIndices.length = 0;
    this.groundCache.clear();
    this.roots.clear();
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
      const proxy = this.proxyFor(meshes[i]);
      if (proxy) this.indexProxy(this.proxies.push(proxy) - 1, proxy);

      if (i % 80 === 0) {
        onProgress(i / total);
        await nextFrame();
      }
    }

    this.ready = this.proxies.length > 0;
    this.roots.set(root, this.proxies.map((proxy) => proxy.mesh));
    onProgress(1);

    return {
      meshes: this.proxies.length,
      indexedCells: this.cells.size,
      globalMeshes: this.globalIndices.length,
    };
  }

  proxyFor(mesh) {
    const geometry = mesh.geometry;
    if (!geometry?.attributes?.position) return null;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return null;
    const box = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    if (box.isEmpty() || !finiteBox(box)) return null;
    const size = box.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z);
    const triangles = triangleCount(geometry);
    return {
      mesh, box, triangles,
      terrainLike: (size.x > 70 && size.z > 70)
        || (size.y <= 1.2 && footprint >= 5)
        || (size.y > 0 && size.x > size.y * 12 && size.z > size.y * 12),
      horizontalCollision: size.y > 0.45 && triangles > 0 && triangles <= 120000 && footprint <= 55,
    };
  }

  add(root) {
    if (this.roots.has(root)) return;
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse((node) => {
      if (!node.isMesh || node.visible === false) return;
      const proxy = this.proxyFor(node);
      if (proxy) {
        meshes.push(node);
        this.indexProxy(this.proxies.push(proxy) - 1, proxy);
      }
    });
    this.roots.set(root, meshes);
    this.groundCache.clear();
    this.ready = this.proxies.length > 0;
  }

  remove(root) {
    const meshes = this.roots.get(root);
    if (!meshes) return;
    const removed = new Set(meshes);
    this.roots.delete(root);
    this.proxies = this.proxies.filter((proxy) => !removed.has(proxy.mesh));
    this.cells.clear();
    this.globalIndices.length = 0;
    this.proxies.forEach((proxy, index) => this.indexProxy(index, proxy));
    this.groundCache.clear();
    this.ready = this.proxies.length > 0;
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
    for (const index of indices) {
      const proxy = this.proxies[index];
      const box = proxy.box;

      if (x < box.min.x - 0.08 || x > box.max.x + 0.08 || z < box.min.z - 0.08 || z > box.max.z + 0.08) continue;
      if (box.max.y < minimumY - 0.5 || box.min.y > maximumY + 1.5) continue;

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

    // Niente fallback alla bounding box: una mesh con un portone/vicolo aperto
    // non deve creare un pavimento o tetto invisibile solo perché la sua AABB
    // copre anche quello spazio vuoto.
    if (this.groundCache.size > 5000) this.groundCache.clear();
    this.groundCache.set(cacheKey, height);
    return height;
  }

  blocksRay(origin, direction, distance, radius, bodyHeight) {
    if (distance <= 0.00001) return false;

    const midX = origin.x + direction.x * distance * 0.5;
    const midZ = origin.z + direction.z * distance * 0.5;
    const endX = origin.x + direction.x * distance;
    const endZ = origin.z + direction.z * distance;
    const sweepMinX = Math.min(origin.x, endX) - radius - 0.05;
    const sweepMaxX = Math.max(origin.x, endX) + radius + 0.05;
    const sweepMinZ = Math.min(origin.z, endZ) - radius - 0.05;
    const sweepMaxZ = Math.max(origin.z, endZ) + radius + 0.05;

    const candidates = this.candidateIndices(midX, midZ, distance * 0.5 + radius + 0.45)
      .map((index) => this.proxies[index])
      .filter((proxy) => proxy.horizontalCollision)
      .filter((proxy) => {
        const box = proxy.box;
        const minY = origin.y + 0.12;
        const maxY = origin.y + bodyHeight - 0.12;
        return box.max.y >= minY
          && box.min.y <= maxY
          && box.max.x >= sweepMinX
          && box.min.x <= sweepMaxX
          && box.max.z >= sweepMinZ
          && box.min.z <= sweepMaxZ;
      })
      .sort((a, b) => {
        const acx = (a.box.min.x + a.box.max.x) * 0.5;
        const acz = (a.box.min.z + a.box.max.z) * 0.5;
        const bcx = (b.box.min.x + b.box.max.x) * 0.5;
        const bcz = (b.box.min.z + b.box.max.z) * 0.5;
        return Math.hypot(acx - origin.x, acz - origin.z) - Math.hypot(bcx - origin.x, bcz - origin.z);
      })
      .slice(0, 6);

    if (!candidates.length) return false;

    const meshes = candidates.map((proxy) => proxy.mesh);
    const probeHeights = [0.42, Math.min(bodyHeight - 0.2, 1.28)];

    for (const height of probeHeights) {
      rayOrigin.set(origin.x, origin.y + height, origin.z);
      rayDirection.set(direction.x, 0, direction.z).normalize();
      this.raycaster.set(rayOrigin, rayDirection);
      this.raycaster.near = 0;
      this.raycaster.far = distance + radius;

      const hits = this.raycaster.intersectObjects(meshes, false);

      for (const hit of hits) {
        if (!hit.face) return true;

        normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        worldNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();

        // Blocca soltanto superfici abbastanza verticali. Strade, marciapiedi,
        // tetti e rampe non devono trasformarsi in muri durante il movimento.
        if (Math.abs(worldNormal.y) < 0.72) return true;
      }
    }

    return false;
  }

  resolveHorizontalMovement(position, movement, radius = 0.34, height = 1.8) {
    resolved.copy(position);

    if (!this.ready || (movement.x === 0 && movement.z === 0)) {
      resolved.x += movement.x;
      resolved.z += movement.z;
      return resolved;
    }

    // Risoluzione per assi: se un muro blocca solo X, Z continua e il player
    // scivola lungo la parete invece di fermarsi di colpo.
    if (movement.x !== 0) {
      rayDirection.set(Math.sign(movement.x), 0, 0);
      if (!this.blocksRay(resolved, rayDirection, Math.abs(movement.x), radius, height)) {
        resolved.x += movement.x;
      }
    }

    if (movement.z !== 0) {
      rayDirection.set(0, 0, Math.sign(movement.z));
      if (!this.blocksRay(resolved, rayDirection, Math.abs(movement.z), radius, height)) {
        resolved.z += movement.z;
      }
    }

    return resolved;
  }
}
