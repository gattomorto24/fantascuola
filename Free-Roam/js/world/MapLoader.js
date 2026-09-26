import { loadGLB } from '../assets/GLBLoader.js';

export class MapLoader {
  constructor(scene) { this.scene = scene; this.object = null; }
  async load(url, manifest, onProgress) {
    const gltf = await loadGLB(url, onProgress);
    const object = gltf.scene;
    let hasMesh = false;
    object.traverse((node) => { if (node.isMesh) hasMesh = true; });
    if (!hasMesh) throw new Error('La mappa GLB non contiene geometria visibile.');
    object.scale.setScalar(Number(manifest.scale) || 1);
    object.rotation.y = Number(manifest.rotation) || 0;
    this.dispose(); this.object = object; this.scene.add(object);
    return object;
  }
  dispose() {
    if (!this.object) return;
    this.scene.remove(this.object);
    this.object.traverse((node) => { node.geometry?.dispose(); if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose()); else node.material?.dispose(); });
    this.object = null;
  }
}
