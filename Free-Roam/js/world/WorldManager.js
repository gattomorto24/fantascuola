import * as THREE from 'three';
import { MapLoader } from './MapLoader.js';
import { WorldCollision } from './WorldCollision.js';
import { settings } from '../config/settings.js';
import { StreamedMap, validateMobileManifest } from './StreamedMap.js?v=mobile-tiles-v2';
import { mobileManifestUrl } from './MobileManifest.js';

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
    this.streamedMap = null;
  }

  resetFallback() {
    this.collision.clear();
    this.customMapLoaded = false;
    this.ground.visible = true;
    this.grid.visible = true;
    this.mapName = 'Pianura di test';
    this.spawn = [...settings.world.defaultSpawn];
    this.scene.fog.near = 90;
    this.scene.fog.far = 210;
  }

  async loadWorld(manifest, storage, onProgress, onStage = () => {}, options = {}) {
    this.streamedMap?.dispose();
    this.streamedMap = null;
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

      if (options.isMobile) {
        const mobileUrl = manifest.metadata?.mobile_manifest_url || mobileManifestUrl(url);
        onStage('Lettura manifest mobile…');
        const response = await fetch(mobileUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Manifest mobile HTTP ${response.status}.`);
        const mobileManifest = validateMobileManifest(await response.json(), url, manifest);
        const spawn = Array.isArray(manifest.spawn) ? manifest.spawn.map(Number) : [];
        if (spawn.length === 3 && spawn.every(Number.isFinite)) this.spawn = spawn;
        this.streamedMap = new StreamedMap(this.scene, this.collision, mobileManifest, mobileUrl, {
          onError: (error) => console.warn('[Free Roam] Zona mobile:', error),
          onProgress: (loaded, total) => onStage(`Zona di spawn · ${Math.round(loaded / total * 100)}%`, loaded / total),
        });
        onStage('Caricamento zona di spawn…');
        await this.streamedMap.start(this.spawn[0], this.spawn[2]);
        this.ground.visible = false;
        this.grid.visible = false;
        this.scene.fog.far = Math.min(58, Math.max(18, mobileManifest.tileSize * 1.7));
        this.scene.fog.near = this.scene.fog.far * 0.42;
        this.customMapLoaded = true;
        this.mapName = manifest.name || 'Mappa GLB';
        return {
          fallback: false,
          name: this.mapName,
          spawn: this.spawn,
          mobileLite: true,
          mobileLiteInfo: { strategy: 'streamed-tiles', strategyLabel: 'zone mobile ottimizzate', fullQuality: false },
          strategy: 'streamed-tiles',
          renderStats: { meshes: this.collision.proxies.length, triangles: 0 },
        };
      }

      onStage('Download e preparazione mappa…');
      const object = await this.mapLoader.load(url, manifest, onProgress, onStage, options);

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
        mobileLite: this.mapLoader.mobileLite,
        mobileLiteInfo: this.mapLoader.mobileLiteInfo,
        strategy: this.mapLoader.strategy,
      };
    } catch (error) {
      console.warn('[Free Roam] Mappa GLB non caricata; uso la pianura:', error);
      this.streamedMap?.dispose();
      this.streamedMap = null;
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
    const resolved = this.collision.resolveHorizontalMovement(position, movement, radius, height, stepHeight);
    if (this.streamedMap) {
      if (!this.streamedMap.canMoveTo(resolved.x, position.z)) resolved.x = position.x;
      if (!this.streamedMap.canMoveTo(resolved.x, resolved.z)) resolved.z = position.z;
    }
    return resolved;
  }

  updateStreaming(x, z) { this.streamedMap?.update(x, z); }
  async ensureAt(x, z) { await this.streamedMap?.ensureAt(x, z); }

  useFallback() {
    this.streamedMap?.dispose();
    this.streamedMap = null;
    this.mapLoader.dispose();
    this.resetFallback();
  }

  dispose() {
    this.streamedMap?.dispose();
    this.streamedMap = null;
    this.collision.clear();
    this.mapLoader.dispose();
    this.scene.remove(this.ground, this.grid);
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
  }
}
