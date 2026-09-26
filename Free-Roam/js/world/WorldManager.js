import * as THREE from 'three';
import { MapLoader } from './MapLoader.js';
import { settings } from '../config/settings.js';
export class WorldManager {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color(0x9bc8dd);
    scene.fog = new THREE.Fog(0x9bc8dd, 90, 210);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8d78, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(20, 35, 15); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x658f79, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground); this.ground = ground;
    const grid = new THREE.GridHelper(500, 100, 0x426a63, 0x6b9a88); grid.position.y = 0.008; scene.add(grid); this.grid = grid;
    this.mapLoader = new MapLoader(scene); this.mapName = 'Pianura di test'; this.spawn = [...settings.world.defaultSpawn];
  }
  async loadWorld(manifest, storage, onProgress) {
    this.mapLoader.dispose(); this.grid.visible = true;
    this.mapName = 'Pianura di test'; this.spawn = [...settings.world.defaultSpawn];
    if (!manifest?.enabled || (!manifest.storage_path && !manifest.asset_url) || !storage) return { fallback: true };
    try {
      const url = manifest.asset_url || await storage.signedUrl('free-roam-maps', manifest.storage_path);
      await this.mapLoader.load(url, manifest, onProgress);
      this.grid.visible = false; this.mapName = manifest.name || 'Mappa GLB';
      const spawn = Array.isArray(manifest.spawn) ? manifest.spawn.map(Number) : [];
      if (spawn.length === 3 && spawn.every(Number.isFinite)) this.spawn = spawn;
      return { fallback: false, name: this.mapName, spawn: this.spawn };
    } catch (error) {
      console.warn('[Free Roam] Mappa GLB non caricata; uso la pianura:', error);
      return { fallback: true, warning: `Mappa non caricata: ${error.message || error}. Uso la pianura.` };
    }
  }
  // Future terrain adapters can replace this method without changing player physics.
  groundHeightAt(_x, _z) { return 0; }
  dispose() { this.mapLoader.dispose(); this.scene.remove(this.ground, this.grid); this.ground.geometry.dispose(); this.ground.material.dispose(); this.grid.geometry.dispose(); this.grid.material.dispose(); }
}
