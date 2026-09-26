import { loadGLB } from '../assets/GLBLoader.js';

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
          if (texture) texture.anisotropy = Math.min(texture.anisotropy || 1, 2);
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

export class MapLoader {
  constructor(scene) {
    this.scene = scene;
    this.object = null;
    this.stats = null;
    this.mobileLite = false;
    this.mobileLiteInfo = null;
  }

  async load(url, manifest, onProgress, onStage = () => {}) {
    // Cross-platform strict mode: mobile e desktop caricano lo STESSO GLB.
    // Il loader può spezzare download/copia in task più piccoli, ma non elimina
    // texture, materiali, UV, normali o attributi della mappa.
    onStage('Download mappa completa · texture originali…');
    const gltf = await loadGLB(url, onProgress, { onStage });

    const object = gltf.scene;

    let hasMesh = false;
    object.traverse((node) => { if (node.isMesh) hasMesh = true; });
    if (!hasMesh) throw new Error('La mappa GLB non contiene geometria visibile.');

    object.scale.setScalar(Number(manifest.scale) || 1);
    object.rotation.y = Number(manifest.rotation) || 0;

    onStage('Ottimizzazione grafica…');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const stats = optimizeStaticObject(object);

    this.dispose();
    this.stats = stats;
    this.mobileLite = false;
    this.mobileLiteInfo = gltf.userData || null;
    this.object = object;
    this.scene.add(object);
    return object;
  }

  dispose() {
    if (!this.object) {
      this.mobileLite = false;
      this.mobileLiteInfo = null;
      return;
    }

    this.scene.remove(this.object);
    this.object.traverse((node) => {
      node.geometry?.dispose();
      if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose());
      else node.material?.dispose();
    });

    this.object = null;
    this.stats = null;
    this.mobileLite = false;
    this.mobileLiteInfo = null;
  }
}
