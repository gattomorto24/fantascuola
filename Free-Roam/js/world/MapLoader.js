import { loadGLB } from '../assets/GLBLoader.js';

function nextFrame() {
  return typeof requestAnimationFrame === 'function'
    ? new Promise((resolve) => requestAnimationFrame(resolve))
    : new Promise((resolve) => setTimeout(resolve, 0));
}

function optimizeStaticObject(root) {
  let meshes = 0;
  let triangles = 0;

  root.updateMatrixWorld(true);

  root.traverse((node) => {
    if (node.isMesh && node.geometry) {
      meshes += 1;
      const position = node.geometry.attributes?.position;
      const index = node.geometry.index;
      if (index) triangles += Math.floor(index.count / 3);
      else if (position) triangles += Math.floor(position.count / 3);

      node.castShadow = false;
      node.receiveShadow = false;
      node.frustumCulled = true;

      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere();

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material) continue;
        material.needsUpdate = false;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const texture = material[key];
          if (!texture) continue;
          texture.anisotropy = 1;
        }
      }
    }

    node.updateMatrix();
    node.matrixAutoUpdate = false;
    if ('matrixWorldAutoUpdate' in node) node.matrixWorldAutoUpdate = false;
  });

  root.updateMatrixWorld(true);
  return { meshes, triangles };
}

function makeStrategies() {
  return [
    { id: 'direct-full', label: 'GLB completo diretto', fullQuality: true, load: (url, p, s) => loadGLB(url, p, { onStage: s }) },
  ];
}

export class MapLoader {
  constructor(scene) {
    this.scene = scene;
    this.object = null;
    this.stats = null;
    this.mobileLite = false;
    this.mobileLiteInfo = null;
    this.strategy = null;
  }

  async load(url, manifest, onProgress, onStage = () => {}, options = {}) {
    const strategies = makeStrategies();
    const startIndex = Math.max(0, Math.min(strategies.length - 1, Number(options.startIndex) || 0));
    const errors = [];

    for (let index = startIndex; index < strategies.length; index += 1) {
      const strategy = strategies[index];
      try {
        options.onAttempt?.(index, strategy.id);
        onStage(`Tentativo ${index + 1}/${strategies.length} · ${strategy.label}…`, index / strategies.length);
        await nextFrame();

        const gltf = await strategy.load(url, onProgress, onStage);
        const object = gltf.scene;

        let hasMesh = false;
        object.traverse((node) => { if (node.isMesh) hasMesh = true; });
        if (!hasMesh) throw new Error('La mappa GLB non contiene geometria visibile.');

        object.scale.setScalar(Number(manifest.scale) || 1);
        object.rotation.y = Number(manifest.rotation) || 0;

        onStage(`Ottimizzazione · ${strategy.label}…`);
        await nextFrame();
        const stats = optimizeStaticObject(object);

        this.dispose();
        this.stats = stats;
        this.mobileLite = Boolean(strategy.lite || gltf.userData?.mobileLite);
        this.mobileLiteInfo = {
          ...(gltf.userData || {}),
          fullQuality: strategy.fullQuality,
          strategy: strategy.id,
          strategyIndex: index,
          strategyCount: strategies.length,
          strategyLabel: strategy.label,
          previousErrors: errors,
        };
        this.strategy = strategy.id;
        this.object = object;
        this.scene.add(object);
        return object;
      } catch (error) {
        const reason = String(error?.message || error);
        errors.push({ strategy: strategy.id, reason });
        console.warn(`[Free Roam] Strategia mappa ${strategy.id} fallita:`, error);
        onStage(`Tentativo ${index + 1} fallito · preparo il fallback…`);
        this.dispose();
        await nextFrame();
      }
    }

    const finalError = new Error(`Tutte le strategie mappa sono fallite: ${errors.map((item) => `${item.strategy}: ${item.reason}`).join(' | ')}`);
    finalError.mapStrategyErrors = errors;
    throw finalError;
  }

  dispose() {
    if (!this.object) {
      this.mobileLite = false;
      this.mobileLiteInfo = null;
      this.strategy = null;
      return;
    }

    this.scene.remove(this.object);
    this.object.traverse((node) => {
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material) continue;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          material[key]?.dispose?.();
        }
        material.dispose?.();
      }
    });

    this.object = null;
    this.stats = null;
    this.mobileLite = false;
    this.mobileLiteInfo = null;
    this.strategy = null;
  }
}
