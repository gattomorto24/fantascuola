import * as THREE from 'three';
import { settings } from '../config/settings.js';
import { GameLoop } from './GameLoop.js';
import { InputManager } from '../input/InputManager.js?v=chat-v1';
import { WorldManager } from '../world/WorldManager.js?v=vehicle-v1';
import { AvatarManager } from '../avatars/AvatarManager.js';
import { Player } from '../player/Player.js?v=vehicle-v1';
import { PlayerController } from '../player/PlayerController.js';
import { VehicleController } from '../player/VehicleController.js?v=chat-v1';
import { RemotePlayerManager } from '../player/RemotePlayerManager.js?v=vehicle-v1';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js?v=vehicle-v1';
import { MultiplayerManager } from '../multiplayer/MultiplayerManager.js?v=chat-v1';
import { DebugHud } from '../ui/DebugHud.js';
import { GlobalChat } from '../ui/GlobalChat.js';
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
    this.mapVersion = 'test-world';

    this.scene = new THREE.Scene();

    const coarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
    this.isTouchDevice = coarsePointer || Number(globalThis.navigator?.maxTouchPoints || 0) > 0;
    const userAgent = String(globalThis.navigator?.userAgent || '');
    const iPadDesktopAgent = globalThis.navigator?.platform === 'MacIntel'
      && Number(globalThis.navigator?.maxTouchPoints || 0) > 1;
    this.isMobilePlatform = /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent) || iPadDesktopAgent;

    this.camera = new THREE.PerspectiveCamera(
      65,
      1,
      0.1,
      this.isTouchDevice ? 190 : 260,
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isTouchDevice,
      powerPreference: this.isTouchDevice ? 'low-power' : 'high-performance',
      alpha: false,
    });

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
    this.chat = new GlobalChat(document.getElementById('global-chat'), {
      onSend: (text) => this.multiplayer?.sendChat(text),
      onOpenChange: (active) => this.input.setTextEntry(active),
    });
    this.followCamera = new ThirdPersonCamera(this.camera, settings.camera);
    this.shotRaycaster = new THREE.Raycaster();
    this.shotNdc = new THREE.Vector2();
    this.aimReticle = document.getElementById('aim-reticle');
    this.vehiclePrompt = document.getElementById('vehicle-prompt');
    this.reticleResetAt = 0;
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
      if (this.isTouchDevice || this.chat.active || event.code !== 'Escape' || this.exitHoldTimer) return;
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
              if (stage.includes('Tentativo')) onStage(stage, 16);
              else if (stage.includes('Salvataggio mappa')) onStage(stage, 62);
              else if (stage.includes('cache locale')) onStage(stage, 68);
              else if (stage.includes('Download texture e geometria')) onStage(stage, 70);
              else if (stage.includes('Assemblaggio GLB')) onStage(stage, 88);
              else if (stage.includes('Decodifica texture')) onStage(stage, 90);
              else if (stage.includes('Ottimizzazione')) onStage(stage, 92);
              else if (stage.includes('Creazione collisioni')) {
                const pct = Number.isFinite(localProgress) ? localProgress : 0;
                onStage(stage, 94 + pct * 3);
              } else if (stage.includes('Download')) {
                onStage(stage, 14);
              } else if (stage.includes('Zona di spawn')) {
                onStage(stage, 20 + (Number.isFinite(localProgress) ? localProgress : 0) * 70);
              }
            },
            {
              isMobile: this.isMobilePlatform,
            },
          );

          if (result.warning) this.hud.setAssetStatus(result.warning);
          else if (!result.fallback) {
            this.mapVersion = `${manifest.id}:${manifest.metadata?.mobile_source_sha256 || manifest.version || 1}`;
            const triangles = result.renderStats?.triangles || 0;
            const meshes = result.renderStats?.meshes || 0;

            const strategyInfo = result.mobileLiteInfo || {};
            const strategyLabel = strategyInfo.strategyLabel || result.strategy || 'standard';
            if (strategyInfo.fullQuality) {
              const downloaded = Number(strategyInfo.downloadedBytes || 0);
              this.hud.setAssetStatus(
                `Mappa completa caricata · ${strategyLabel}${downloaded ? ` · ${Math.round(downloaded / 1024 / 1024)} MB` : ''}.`,
              );
            } else if (strategyInfo.strategy) {
              this.hud.setAssetStatus(
                `Fallback mobile attivo · ${strategyLabel}. Geometria e coordinate restano condivise col PC.`,
              );
            }

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
          this.chat.close();
          this.input.setEnabled(false);
          this.disconnectScreen.show();
        },
        onRecovered: () => {
          this.disconnectScreen.hide();
          this.input.setEnabled(true);
        },
        onReconnectStart: () => {
          this.chat.close();
          this.input.setEnabled(false);
          this.disconnectScreen.setReconnecting(true);
        },
        onOffline: () => {
          this.chat.close();
          this.disconnectScreen.hide();
          this.input.setEnabled(true);
        },
        getVehicleState: () => ({
          vehicleId: this.vehicle?.vehicleId,
          vehicleStates: this.world.ambient?.networkVehicleStates() || [],
        }),
        onVehicleSnapshot: (snapshot) => {
          this.world.ambient?.receiveVehicleSnapshot(snapshot);
          if (this.vehicle?.driving
            && this.world.ambient?.drivers.get(this.vehicle.vehicleId)?.playerId !== this.multiplayer.playerId) {
            this.vehicle.exit(false);
            this.input.setDriving(false);
          }
        },
        onVehicleLeave: (playerId) => this.world.ambient?.releaseDriver(playerId),
        onVehicleReconcile: (present) => {
          for (const driver of this.world.ambient?.drivers.values() || []) {
            if (driver.playerId !== this.multiplayer.playerId && !present.has(driver.playerId)) {
              this.world.ambient.releaseDriver(driver.playerId);
            }
          }
        },
        onChat: (message) => this.chat.add(message.displayName, message.text),
      },
      this.mapVersion,
    );
    this.vehicle = new VehicleController(this.player, this.world, this.followCamera, this.multiplayer.playerId);

    let spawn = spawnForPlayer(this.world.spawn, this.multiplayer.playerId);
    try {
      await this.world.ensureAt(spawn[0], spawn[2]);
    } catch (error) {
      console.warn('[Free Roam] Zona di spawn non disponibile:', error);
      this.world.useFallback();
      this.mapVersion = 'test-world';
      this.multiplayer.mapVersion = this.mapVersion;
      this.hud.setAssetStatus(`Zona di spawn non disponibile: ${error.message || error}. Uso la pianura.`);
      spawn = spawnForPlayer(this.world.spawn, this.multiplayer.playerId);
    }
    const spawnGround = this.world.groundHeightAt(spawn[0], spawn[2], spawn[1], 3, 20);
    if (Number.isFinite(spawnGround)) spawn[1] = spawnGround;
    this.player.root.position.set(...spawn);
    this.world.updateAmbient(0, this.player.root.position, Date.now());

    this.followCamera.update(0, { cameraX: 0, cameraY: 0, zoom: 0 }, this.player.root.position);
    this.hud.setMap(this.world.mapName);

    const stressCount = Math.max(0, Math.min(200, Number(new URLSearchParams(location.search).get('stress')) || 0));
    if (stressCount) {
      this.stress = new StressHarness(this.remotes, stressCount);
      this.hud.setAssetStatus(`Stress test locale attivo: ${stressCount} giocatori simulati.`);
    }

    onStage(this.isTouchDevice ? 'Ottimizzazione memoria mobile…' : 'Preparazione grafica…', 98);
    if (!this.isTouchDevice) {
      try {
        if (typeof this.renderer.compileAsync === 'function') {
          await this.renderer.compileAsync(this.scene, this.camera);
        } else {
          this.renderer.compile(this.scene, this.camera);
        }
      } catch (error) {
        console.warn('[Free Roam] Precompilazione shader saltata:', error);
      }
    } else {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    // Disegna già un frame completo dietro la schermata di caricamento:
    // quando questa sparisce non compare un frame vuoto o incompleto.
    this.renderer.render(this.scene, this.camera);

    this.loop.start();
    this.chat.setEnabled(true);
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
    const wasDriving = this.vehicle.driving;
    if (controls.interact) {
      if (this.vehicle.driving) this.vehicle.exit();
      else this.vehicle.enter();
    }
    if (controls.exitVehicle && this.vehicle.driving) this.vehicle.exit();
    if (wasDriving !== this.vehicle.driving) {
      this.controller.velocity.set(0, 0, 0);
      this.controller.grounded = true;
    }
    this.input.setDriving(this.vehicle.driving);
    this.input.setWeaponDrawn(this.player.weapon.drawn);
    if (controls.toggleWeapon && !this.vehicle.driving) {
      this.player.weapon.setDrawn(!this.player.weapon.drawn);
      this.input.setWeaponDrawn(this.player.weapon.drawn);
    }
    const aiming = !this.vehicle.driving && this.input.enabled && this.player.weapon.drawn
      && (this.isTouchDevice || controls.aim);
    this.player.weapon.setAiming(aiming);
    this.world.updateStreaming(this.player.root.position.x, this.player.root.position.z);
    if (this.vehicle.driving) this.vehicle.update(delta, controls);
    else this.controller.update(delta, { ...controls, aiming }, this.followCamera.yaw);
    this.world.updateAmbient(delta, this.player.root.position, Date.now() + (this.multiplayer?.serverTimeOffset || 0));
    this.followCamera.update(delta, { ...controls, aiming, driving: this.vehicle.driving }, this.player.root.position);
    if (controls.shot && this.player.weapon.drawn && !this.vehicle.driving) this.fire(controls.shot);
    const nearby = !this.vehicle.driving && this.world.ambient?.nearestVehicle(this.player.root.position);
    this.input.setVehicleAvailable(Boolean(nearby));
    if (this.vehiclePrompt) {
      this.vehiclePrompt.hidden = !this.input.enabled || (!nearby && !this.vehicle.driving);
      this.vehiclePrompt.textContent = this.vehicle.driving ? "Premi E per uscire dall'auto" : "Premi E per guidare l'auto";
    }
    if (this.aimReticle) {
      this.aimReticle.hidden = !aiming;
      if (this.reticleResetAt && performance.now() >= this.reticleResetAt) {
        this.aimReticle.style.left = '50%';
        this.aimReticle.style.top = '50%';
        this.reticleResetAt = 0;
      }
    }
    this.multiplayer?.update(delta);
    this.stress?.update(delta);
    this.hud.update(delta, this.player, this.remotes.size);
    this.updateAdaptiveResolution(delta);
  }

  fire(shot) {
    if (this.player.weapon.cooldown > 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = shot.touch ? (shot.x - rect.left) / Math.max(1, rect.width) * 2 - 1 : 0;
    const y = shot.touch ? 1 - (shot.y - rect.top) / Math.max(1, rect.height) * 2 : 0;
    this.shotNdc.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
    this.shotRaycaster.setFromCamera(this.shotNdc, this.camera);
    const { origin, direction } = this.shotRaycaster.ray;
    const hit = this.world.raycastShot(origin, direction, 70);
    const target = hit || origin.clone().addScaledVector(direction, 70);
    if (shot.touch) {
      this.player.root.rotation.y = Math.atan2(-direction.x, -direction.z);
      if (this.aimReticle) {
        this.aimReticle.style.left = `${shot.x}px`;
        this.aimReticle.style.top = `${shot.y}px`;
        this.reticleResetAt = performance.now() + 300;
      }
    }
    this.player.weapon.fireTo(target.toArray(), { local: true });
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
    this.chat.dispose();
    if (this.aimReticle) this.aimReticle.hidden = true;
    if (this.vehiclePrompt) this.vehiclePrompt.hidden = true;
    document.body.classList.remove('gameplay-active', 'network-disconnected');
    this.disconnectScreen.hide();
    this.input.dispose();
    this.stress?.dispose();
    await this.multiplayer?.disconnect();
    this.remotes.clear();
    this.player.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
