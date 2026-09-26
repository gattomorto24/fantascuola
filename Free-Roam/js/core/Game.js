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
import { DisconnectScreen } from '../ui/DisconnectScreen.js';
import { StressHarness } from '../debug/StressHarness.js';
import { spawnForPlayer } from '../world/spawn.js';

export class Game {
  constructor(container, hudRoot, { client, identity, displayName, avatarSelection, storage }) {
    this.container = container;
    this.client = client;
    const fallbackIdentity = { userId: `guest:${crypto.randomUUID()}`, displayName };
    this.identity = { ...(identity || fallbackIdentity), displayName };
    this.displayName = displayName;
    this.avatarSelection = avatarSelection;
    this.storage = storage;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 260);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });

    const coarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
    this.isTouchDevice = coarsePointer || Number(globalThis.navigator?.maxTouchPoints || 0) > 0;
    const nativeRatio = Math.max(1, globalThis.devicePixelRatio || 1);
    this.pixelRatioCap = Math.min(
      nativeRatio,
      coarsePointer ? settings.rendering.pixelRatioMobileMax : settings.rendering.pixelRatioMax,
    );
    this.pixelRatio = Math.max(settings.rendering.pixelRatioMin, this.pixelRatioCap);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);

    this.resolutionElapsed = 0;
    this.resolutionFrames = 0;

    this.world = new WorldManager(this.scene);
    this.avatars = new AvatarManager(storage);
    this.player = new Player(this.scene, this.avatars);
    this.controller = new PlayerController(this.player, this.world, settings.player);
    this.input = new InputManager(this.renderer.domElement, document.getElementById('touch-controls'), settings.touch);
    this.followCamera = new ThirdPersonCamera(this.camera, settings.camera);
    this.remotes = new RemotePlayerManager(this.scene, this.avatars, settings.network);
    this.hud = new DebugHud(hudRoot, settings.rendering.hudInterval);
    this.hud.setVisible(true);
    this.hud.setNetwork(false, 'Connessione al server dedicato…');

    this.disconnectScreen = new DisconnectScreen(document.getElementById('disconnect-screen'), {
      onReconnect: () => {
        if (!this.multiplayer) return;
        this.input.setEnabled(false);
        this.disconnectScreen.setReconnecting(true);
        this.multiplayer.reconnectNow();
      },
      onOffline: () => {
        if (!this.multiplayer) return;
        this.multiplayer.continueOffline();
        this.disconnectScreen.hide();
        this.input.setEnabled(true);
      },
    });

    this.exitHoldTimer = null;
    this.onExitKeyDown = (event) => {
      if (this.isTouchDevice || event.code !== 'Escape' || this.exitHoldTimer) return;
      event.preventDefault();
      this.exitHoldTimer = setTimeout(() => {
        this.exitHoldTimer = null;
        window.location.href = '../index.html';
      }, 900);
    };
    this.cancelExitHold = () => {
      clearTimeout(this.exitHoldTimer);
      this.exitHoldTimer = null;
    };
    this.onExitKeyUp = (event) => {
      if (event.code === 'Escape') this.cancelExitHold();
    };

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onExitKeyDown, true);
    window.addEventListener('keyup', this.onExitKeyUp, true);
    window.addEventListener('blur', this.cancelExitHold);
    this.resize();

    this.loop = new GameLoop(
      (delta) => this.update(delta),
      () => this.renderer.render(this.scene, this.camera),
      settings.rendering.maxDelta,
    );
  }

  async start(onStage = () => {}) {
    document.body.classList.add('gameplay-active');
    this.player.setName(this.displayName);

    onStage('Preparazione personaggio…', 3);
    const visual = await this.player.setAvatar(this.avatarSelection, (event) => {
      if (event.total) {
        const pct = event.loaded / event.total;
        onStage(`Caricamento avatar · ${Math.round(pct * 100)}%`, 3 + pct * 7);
      }
    });
    if (visual?.warning) this.hud.setAssetStatus(visual.warning);
    this.hud.setAvatar(this.player.visualAvatarId);

    onStage('Ricerca mappa attiva…', 11);

    if (this.storage) {
      try {
        const manifest = await this.storage.activeMap();
        if (manifest) {
          onStage('Connessione alla mappa…', 14);

          const result = await this.world.loadWorld(
            manifest,
            this.storage,
            (event) => {
              const expectedTotal = Number(
                event.total
                || manifest.metadata?.original_file_size
                || manifest.file_size
                || 0,
              );
              if (expectedTotal > 0 && Number.isFinite(event.loaded)) {
                const pct = Math.max(0, Math.min(1, event.loaded / expectedTotal));
                // Il download arriva al massimo all'88%: dopo restano parsing,
                // ottimizzazione, collisioni e compilazione shader.
                onStage(
                  `Download mappa · ${Math.round(pct * 100)}%`,
                  14 + pct * 74,
                );
              } else {
                onStage('Download mappa…', 18);
              }
            },
            (stage, localProgress = null) => {
              if (stage.includes('Ottimizzazione')) onStage(stage, 90);
              else if (stage.includes('Creazione collisioni')) {
                const pct = Number.isFinite(localProgress) ? localProgress : 0;
                onStage(stage, 92 + pct * 5);
              } else if (stage.includes('Download')) {
                onStage(stage, 14);
              }
            },
          );

          if (result.warning) this.hud.setAssetStatus(result.warning);
          else if (!result.fallback) {
            const triangles = result.renderStats?.triangles || 0;
            const meshes = result.renderStats?.meshes || 0;
            console.info(
              `[Free Roam] Mappa pronta: ${meshes} mesh, ~${triangles.toLocaleString('it-IT')} triangoli, collisioni indicizzate.`,
            );
          }
        } else {
          onStage('Pianura di test pronta', 94);
        }
      } catch (error) {
        console.warn('[Free Roam] Mappa attiva non disponibile:', error);
        this.hud.setAssetStatus('Mappa online non disponibile. Uso la pianura di test.');
        onStage('Uso mappa di fallback…', 94);
      }
    } else {
      onStage('Uso mappa locale di fallback…', 94);
    }

    onStage('Avvio sessione multiplayer…', 97);
    this.multiplayer = new MultiplayerManager(
      this.client,
      this.identity,
      this.player,
      this.remotes,
      settings.network,
      (online, detail) => {
        this.hud.setNetwork(online, detail);
        if (online) {
          this.disconnectScreen.hide();
          this.input.setEnabled(true);
        }
      },
      (latency) => this.hud.setLatency(latency),
      {
        onDisconnected: () => {
          this.input.setEnabled(false);
          this.disconnectScreen.show();
        },
        onRecovered: () => {
          this.disconnectScreen.hide();
          this.input.setEnabled(true);
        },
        onReconnectStart: () => {
          this.input.setEnabled(false);
          this.disconnectScreen.setReconnecting(true);
        },
        onOffline: () => {
          this.disconnectScreen.hide();
          this.input.setEnabled(true);
        },
      },
    );

    const spawn = spawnForPlayer(this.world.spawn, this.multiplayer.playerId);
    const spawnGround = this.world.groundHeightAt(spawn[0], spawn[2], spawn[1], 3, 20);
    if (Number.isFinite(spawnGround)) spawn[1] = spawnGround;
    this.player.root.position.set(...spawn);

    this.followCamera.update(0, { cameraX: 0, cameraY: 0, zoom: 0 }, this.player.root.position);
    this.hud.setMap(this.world.mapName);

    const stressCount = Math.max(0, Math.min(200, Number(new URLSearchParams(location.search).get('stress')) || 0));
    if (stressCount) {
      this.stress = new StressHarness(this.remotes, stressCount);
      this.hud.setAssetStatus(`Stress test locale attivo: ${stressCount} giocatori simulati.`);
    }

    onStage('Preparazione grafica…', 98);
    try {
      if (typeof this.renderer.compileAsync === 'function') {
        await this.renderer.compileAsync(this.scene, this.camera);
      } else {
        this.renderer.compile(this.scene, this.camera);
      }
    } catch (error) {
      console.warn('[Free Roam] Precompilazione shader saltata:', error);
    }

    // Disegna già un frame completo dietro la schermata di caricamento:
    // quando questa sparisce non compare un frame vuoto o incompleto.
    this.renderer.render(this.scene, this.camera);

    this.loop.start();
    this.input.showTouchControls();
    this.multiplayer.connect();
    this.hud.startCompactCountdown(5000);
    onStage('Mondo pronto', 100);
  }

  updateAdaptiveResolution(delta) {
    if (!settings.rendering.adaptiveResolution || this.pixelRatioCap <= settings.rendering.pixelRatioMin) return;

    this.resolutionElapsed += delta;
    this.resolutionFrames += 1;

    if (this.resolutionElapsed < 2.25) return;

    const fps = this.resolutionFrames / this.resolutionElapsed;
    const target = settings.rendering.targetFps;
    let next = this.pixelRatio;

    if (fps < target - 8) next -= 0.15;
    else if (fps > target + 7) next += 0.1;

    next = Math.max(
      settings.rendering.pixelRatioMin,
      Math.min(this.pixelRatioCap, Math.round(next * 20) / 20),
    );

    if (Math.abs(next - this.pixelRatio) >= 0.05) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
      console.info(`[Free Roam] Risoluzione dinamica: ${next.toFixed(2)}x · ${Math.round(fps)} FPS`);
    }

    this.resolutionElapsed = 0;
    this.resolutionFrames = 0;
  }

  update(delta) {
    const controls = this.input.read();
    this.controller.update(delta, controls, this.followCamera.yaw);
    this.followCamera.update(delta, controls, this.player.root.position);
    this.multiplayer?.update(delta);
    this.stress?.update(delta);
    this.hud.update(delta, this.player, this.remotes.size);
    this.updateAdaptiveResolution(delta);
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  async dispose() {
    this.loop.stop();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onExitKeyDown, true);
    window.removeEventListener('keyup', this.onExitKeyUp, true);
    window.removeEventListener('blur', this.cancelExitHold);
    this.cancelExitHold();
    this.hud.dispose();
    document.body.classList.remove('gameplay-active', 'network-disconnected');
    this.disconnectScreen.hide();
    this.input.dispose();
    this.stress?.dispose();
    await this.multiplayer?.disconnect();
    this.remotes.clear();
    this.player.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
