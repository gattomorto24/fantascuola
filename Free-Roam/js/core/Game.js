import * as THREE from 'three';
import { settings } from '../config/settings.js';
import { GameLoop } from './GameLoop.js';
import { InputManager } from '../input/InputManager.js';
import { WorldManager } from '../world/WorldManager.js';
import { AvatarManager } from '../avatars/AvatarManager.js';
import { Player } from '../player/Player.js';
import { PlayerController } from '../player/PlayerController.js';
import { RemotePlayerManager } from '../player/RemotePlayerManager.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { MultiplayerManager } from '../multiplayer/MultiplayerManager.js';
import { DebugHud } from '../ui/DebugHud.js';

export class Game {
  constructor(container, hudRoot, { client, identity, displayName, avatarSelection, storage }) {
    this.container = container; this.client = client; this.identity = identity ? { ...identity, displayName } : null;
    this.displayName = displayName; this.avatarSelection = avatarSelection; this.storage = storage;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 500);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.rendering.pixelRatioMax));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.world = new WorldManager(this.scene);
    this.avatars = new AvatarManager(storage);
    this.player = new Player(this.scene, this.avatars);
    this.controller = new PlayerController(this.player, this.world, settings.player);
    this.input = new InputManager(this.renderer.domElement);
    this.followCamera = new ThirdPersonCamera(this.camera, settings.camera);
    this.remotes = new RemotePlayerManager(this.scene, this.avatars, settings.network);
    this.hud = new DebugHud(hudRoot, settings.rendering.hudInterval);
    this.hud.setVisible(true); this.hud.setNetwork(false, this.identity ? 'Connessione in corso…' : 'Accedi a FantaScuola per giocare online');
    this.resize = this.resize.bind(this); window.addEventListener('resize', this.resize); this.resize();
    // Separate simulation, camera, network, and render. Delta is capped after background-tab pauses.
    this.loop = new GameLoop((delta) => this.update(delta), () => this.renderer.render(this.scene, this.camera), settings.rendering.maxDelta);
  }
  async start(onStage = () => {}) {
    this.player.setName(this.displayName);
    onStage('Caricamento avatar…');
    const visual = await this.player.setAvatar(this.avatarSelection, (event) => {
      if (event.total) onStage(`Caricamento avatar: ${Math.round(event.loaded / event.total * 100)}%`);
    });
    if (visual?.warning) this.hud.setAssetStatus(visual.warning);
    this.hud.setAvatar(this.player.visualAvatarId);
    if (this.storage) {
      try {
        onStage('Ricerca mappa attiva…');
        const manifest = await this.storage.activeMap();
        if (manifest) {
          onStage('Caricamento mappa GLB…');
          const result = await this.world.loadWorld(manifest, this.storage, (event) => {
            if (event.total) onStage(`Caricamento mappa: ${Math.round(event.loaded / event.total * 100)}%`);
          });
          if (result.warning) this.hud.setAssetStatus(result.warning);
        }
      } catch (error) {
        console.warn('[Free Roam] Mappa attiva non disponibile:', error);
        this.hud.setAssetStatus('Mappa online non disponibile. Uso la pianura di test.');
      }
    }
    this.player.root.position.set(...this.world.spawn);
    this.followCamera.update(0, { cameraX: 0, cameraY: 0, zoom: 0 }, this.player.root.position);
    this.hud.setMap(this.world.mapName);
    this.loop.start();
    if (this.client && this.identity) {
      this.multiplayer = new MultiplayerManager(this.client, this.identity, this.player, this.remotes, settings.network,
        (online, detail) => this.hud.setNetwork(online, detail));
      this.multiplayer.connect(); // Realtime cannot block rendering or movement.
    }
  }
  update(delta) {
    const controls = this.input.read();
    this.controller.update(delta, controls, this.followCamera.yaw);
    this.followCamera.update(delta, controls, this.player.root.position);
    this.multiplayer?.update(delta);
    this.hud.update(delta, this.player, this.remotes.size);
  }
  resize() {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height);
  }
  async dispose() {
    this.loop.stop(); window.removeEventListener('resize', this.resize); this.input.dispose();
    await this.multiplayer?.disconnect(); this.remotes.clear(); this.player.dispose(); this.world.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
