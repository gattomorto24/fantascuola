import * as THREE from 'three';
import { MapLoader } from './MapLoader.js';
import { WorldCollision } from './WorldCollision.js';
import { settings } from '../config/settings.js';

export class WorldManager {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color(0x9bc8dd);
    scene.fog = new THREE.Fog(0x9bc8dd, 90, 210);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8d78, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(20, 35, 15);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshStandardMaterial({ color: 0x658f79, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = false;
    scene.add(ground);
    this.ground = ground;

    const grid = new THREE.GridHelper(500, 100, 0x426a63, 0x6b9a88);
    grid.position.y = 0.008;
    scene.add(grid);
    this.grid = grid;

    this.mapLoader = new MapLoader(scene);
    this.collision = new WorldCollision({
      cellSize: settings.world.collisionCellSize,
      maxCellsPerMesh: settings.world.collisionMaxCellsPerMesh,
      groundCacheStep: settings.world.collisionGroundCacheStep,
      maxRaycastMeshes: settings.world.collisionMaxRaycastMeshes,
    });

    this.mapName = 'Pianura di test';
    this.spawn = [...settings.world.defaultSpawn];
    this.customMapLoaded = false;
  }

  resetFallback() {
    this.collision.clear();
    this.customMapLoaded = false;
    this.ground.visible = true;
    this.grid.visible = true;
    this.mapName = 'Pianura di test';
    this.spawn = [...settings.world.defaultSpawn];
  }

  async loadWorld(manifest, storage, onProgress, onStage = () => {}) {
    this.mapLoader.dispose();
    this.resetFallback();

    const directUrl = manifest?.asset_url
      || manifest?.metadata?.asset_url
      || (/^https:\/\//i.test(manifest?.storage_path || '') ? manifest.storage_path : null);

    if (!manifest?.enabled || (!manifest.storage_path && !directUrl) || !storage) {
      return { fallback: true };
    }

    try {
      const url = directUrl || await storage.signedUrl('free-roam-maps', manifest.storage_path);

      onStage('Download e preparazione mappa…');
      const object = await this.mapLoader.load(url, manifest, onProgress, onStage);

      onStage('Creazione collisioni…', 0);
      const collisionStats = await this.collision.build(object, (progress) => {
        onStage('Creazione collisioni…', progress);
      });

      // La pianura esiste solo come fallback. Quando il GLB è pronto viene
      // completamente tolta dalla vista e la quota del player arriva dalla mappa.
      this.ground.visible = false;
      this.grid.visible = false;
      this.customMapLoaded = true;
      this.mapName = manifest.name || 'Mappa GLB';

      const spawn = Array.isArray(manifest.spawn) ? manifest.spawn.map(Number) : [];
      if (spawn.length === 3 && spawn.every(Number.isFinite)) this.spawn = spawn;

      return {
        fallback: false,
        name: this.mapName,
        spawn: this.spawn,
        renderStats: this.mapLoader.stats,
        collisionStats,
      };
    } catch (error) {
      console.warn('[Free Roam] Mappa GLB non caricata; uso la pianura:', error);
      this.mapLoader.dispose();
      this.resetFallback();
      return {
        fallback: true,
        warning: `Mappa non caricata: ${error.message || error}. Uso la pianura.`,
      };
    }
  }

  groundHeightAt(x, z, referenceY = 0, maxStep = settings.player.stepHeight, maxDrop = settings.player.maxGroundProbe) {
    if (!this.customMapLoaded || !this.collision.ready) return 0;
    return this.collision.groundHeightAt(x, z, referenceY, maxStep, maxDrop);
  }

  resolveHorizontalMovement(position, movement, radius = settings.player.radius, height = settings.player.height, stepHeight = settings.player.stepHeight) {
    if (!this.customMapLoaded || !this.collision.ready) {
      return new THREE.Vector3(position.x + movement.x, position.y, position.z + movement.z);
    }
    return this.collision.resolveHorizontalMovement(position, movement, radius, height, stepHeight);
  }

  dispose() {
    this.collision.clear();
    this.mapLoader.dispose();
    this.scene.remove(this.ground, this.grid);
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
  }
}
