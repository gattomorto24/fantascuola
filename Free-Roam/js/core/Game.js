import * as THREE from 'three';
import { settings } from '../config/settings.js';
import { GameLoop } from './GameLoop.js';
import { InputManager } from '../input/InputManager.js?v=motorcycles-v1';
import { WorldManager } from '../world/WorldManager.js?v=tiles-v2';
import { AvatarManager } from '../avatars/AvatarManager.js';
import { Player } from '../player/Player.js?v=gameplay-v1';
import { CombatState, findPlayerHit, plausibleHit, PISTOL_DAMAGE, SHOT_RANGE } from '../player/Combat.js?v=gameplay-v1';
import { WantedState } from '../world/WantedState.js';
import { PoliceSystem } from '../world/PoliceSystem.js?v=motorcycles-v1';
import { PlayerController } from '../player/PlayerController.js';
import { VehicleController } from '../player/VehicleController.js?v=motorcycles-v1';
import { RemotePlayerManager } from '../player/RemotePlayerManager.js?v=gameplay-v1';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js?v=vehicle-v1';
import { MultiplayerManager } from '../multiplayer/MultiplayerManager.js?v=gameplay-v1';
import { DebugHud } from '../ui/DebugHud.js';
import { GlobalChat } from '../ui/GlobalChat.js';
import { DisconnectScreen } from '../ui/DisconnectScreen.js';
import { StressHarness } from '../debug/StressHarness.js';
import { spawnForPlayer } from '../world/spawn.js';
import { GRAPHICS_QUALITY, VIEW_DISTANCE, loadGraphicsSettings, saveGraphicsSettings } from '../ui/GraphicsSettings.js';

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
    this.pixelRatioCap = Math.min(nativeRatio, 2);
    this.pixelRatio = Math.min(this.pixelRatioCap, GRAPHICS_QUALITY[this.graphics?.quality || 'low'].pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.graphics = loadGraphicsSettings();
    this.settingsOpen = false;
    this.settingsScreen = document.getElementById('settings-screen');
    this.qualitySelect = document.getElementById('graphics-quality');
    this.distanceSelect = document.getElementById('render-distance');
    this.settingsButtons = [...document.querySelectorAll('.settings-open')];
    this.onSettingsButton = () => this.toggleSettings();
    this.onGraphicsChange = () => {
      this.graphics = saveGraphicsSettings({
        quality: this.qualitySelect.value,
        distance: this.distanceSelect.value,
      });
      this.applyGraphicsSettings();
    };
    for (const button of this.settingsButtons) button.addEventListener('click', this.onSettingsButton);
    this.qualitySelect?.addEventListener('change', this.onGraphicsChange);
    this.distanceSelect?.addEventListener('change', this.onGraphicsChange);
    if (this.qualitySelect) this.qualitySelect.value = this.graphics.quality;
    if (this.distanceSelect) this.distanceSelect.value = this.graphics.distance;

    this.resolutionElapsed = 0;
    this.resolutionFrames = 0;

    this.world = new WorldManager(this.scene);
    this.wanted = new WantedState();
    this.police = new PoliceSystem(this.scene, this.world);
    this.wantedHud = document.getElementById('wanted-hud');
    this.vehicleHealthHud = document.getElementById('vehicle-health');
    this.avatars = new AvatarManager(storage);
    this.player = new Player(this.scene, this.avatars);
    this.combat = new CombatState();
    this.healthHud = document.getElementById('health-hud');
    this.healthFill = document.getElementById('health-fill');
    this.healthValue = document.getElementById('health-value');
    this.deathScreen = document.getElementById('death-screen');
    this.reenterButton = document.getElementById('death-reenter');
    this.onReenter = () => {
      if (this.combat.health === 0 && !this.respawning) void this.respawn();
    };
    this.reenterButton?.addEventListener('click', this.onReenter);
    this.respawning = false;
    this.disposed = false;
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
        this.input.setEnabled(this.combat.health > 0 && !this.settingsOpen);
      },
    });

    this.onSettingsKeyDown = (event) => {
      if (event.code !== 'Escape' || event.repeat || this.combat.health === 0 || this.chat.active) return;
      event.preventDefault();
      this.toggleSettings();
    };

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onSettingsKeyDown, true);
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

    if (this.world.ambient) this.world.ambient.externalVehicles = () => this.police.collisionVehicles();
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
          this.input.setEnabled(this.combat.health > 0 && !this.settingsOpen);
        }
      },
      (latency) => this.hud.setLatency(latency),
      {
        onDisconnected: () => {
          this.toggleSettings(false);
          this.chat.close();
          this.input.setEnabled(false);
          this.disconnectScreen.show();
        },
        onRecovered: () => {
          this.disconnectScreen.hide();
          this.input.setEnabled(this.combat.health > 0 && !this.settingsOpen);
        },
        onReconnectStart: () => {
          this.toggleSettings(false);
          this.chat.close();
          this.input.setEnabled(false);
          this.disconnectScreen.setReconnecting(true);
        },
        onOffline: () => {
          this.chat.close();
          this.disconnectScreen.hide();
          this.input.setEnabled(this.combat.health > 0 && !this.settingsOpen);
        },
        getVehicleState: () => ({
          vehicleId: this.vehicle?.vehicleId,
          vehicleRole: this.vehicle?.role,
          vehicleCondition: this.vehicle?.vehicleId
            ? this.world.ambient?.conditionOf(this.vehicle.vehicleId) : undefined,
          vehicleStates: this.world.ambient?.networkVehicleStates() || [],
          npcStates: this.world.ambient?.networkNpcStates() || [],
          wanted: this.wanted.stars,
          policePose: this.police.poseOf(this.multiplayer?.playerId),
        }),
        onVehicleSnapshot: (snapshot) => {
          this.world.ambient?.receiveVehicleSnapshot(snapshot);
          this.world.ambient?.receiveNpcStates(snapshot.npcStates);
          this.world.ambient?.setPlayerTarget(snapshot.playerId, snapshot.position);
          this.police.receive(snapshot);
          if (this.vehicle?.driving
            && this.world.ambient?.drivers.get(this.vehicle.vehicleId)?.playerId !== this.multiplayer.playerId) {
            this.vehicle.exit(false);
            this.input.setDriving(false);
          }
          if (this.vehicle?.role === 'passenger'
            && this.world.ambient?.passengers.get(this.vehicle.vehicleId) !== this.multiplayer.playerId) {
            this.vehicle.exit(false);
            this.input.setDriving(false);
          }
        },
        onVehicleLeave: (playerId) => {
          this.world.ambient?.releaseDriver(playerId);
          this.world.ambient?.releasePassenger(playerId);
          this.world.ambient?.playerTargets.delete(playerId);
          this.police.remove(playerId);
        },
        onVehicleReconcile: (present) => {
          for (const driver of this.world.ambient?.drivers.values() || []) {
            if (driver.playerId !== this.multiplayer.playerId && !present.has(driver.playerId)) {
              this.world.ambient.releaseDriver(driver.playerId);
            }
          }
          for (const passenger of this.world.ambient?.passengers.values() || []) {
            if (passenger !== this.multiplayer.playerId && !present.has(passenger)) {
              this.world.ambient.releasePassenger(passenger);
            }
          }
        },
        onChat: (message) => this.chat.add(message.displayName, message.text),
        onShotAtMe: (snapshot) => this.receiveShot(snapshot),
        onNpcShot: (snapshot) => this.receiveNpcShot(snapshot),
      },
      this.mapVersion,
    );
    this.vehicle = new VehicleController(this.player, this.world, this.followCamera,
      this.multiplayer.playerId, {
        onTheft: (id, pose) => this.onCarTheft(id, pose),
        onNpcKilled: (id) => this.onNpcKilled(id),
      });

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
    this.applyGraphicsSettings();
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
    this.updateHealthHud();
    this.updateWantedHud();
    if (this.healthHud) this.healthHud.hidden = false;
    this.chat.setEnabled(true);
    this.input.showTouchControls();
    this.multiplayer.connect();
    this.hud.startCompactCountdown(5000);
    onStage('Mondo pronto', 100);
  }

  applyGraphicsSettings() {
    const quality = GRAPHICS_QUALITY[this.graphics.quality];
    const distance = VIEW_DISTANCE[this.graphics.distance];
    const view = this.isMobilePlatform ? distance.mobile : distance.desktop;
    this.camera.far = view + 30;
    this.camera.updateProjectionMatrix();
    this.world.setViewSettings(view, distance.tiles, quality.anisotropy);
    this.pixelRatio = Math.min(this.pixelRatioCap, quality.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  toggleSettings(force = !this.settingsOpen) {
    if (!this.settingsScreen || (force && this.combat.health === 0)) return;
    this.settingsOpen = Boolean(force);
    this.settingsScreen.hidden = !this.settingsOpen;
    if (this.settingsOpen) {
      this.chat.setEnabled(false);
      this.input.setEnabled(false);
      this.qualitySelect?.focus();
    } else {
      this.chat.setEnabled(this.combat.health > 0);
      this.input.setEnabled(this.combat.health > 0
        && Boolean(this.multiplayer?.online || this.multiplayer?.offlineMode));
    }
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

    const qualityCap = Math.min(this.pixelRatioCap, GRAPHICS_QUALITY[this.graphics.quality].pixelRatio);
    next = Math.max(Math.min(qualityCap, 0.75), Math.min(qualityCap, Math.round(next * 20) / 20));

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
    if (this.combat.health === 0) {
      this.input.setVehicleAvailable(false);
      if (this.vehiclePrompt) this.vehiclePrompt.hidden = true;
      if (this.aimReticle) this.aimReticle.hidden = true;
      this.player.updateVisual(delta);
      this.world.updateStreaming(this.player.root.position.x, this.player.root.position.z);
      this.world.updateAmbient(delta, this.player.root.position, Date.now() + (this.multiplayer?.serverTimeOffset || 0));
      this.police.updateRemote(delta, this.multiplayer?.playerId);
      this.followCamera.update(delta, { cameraX: controls.cameraX, cameraY: controls.cameraY, zoom: controls.zoom }, this.player.root.position);
      this.multiplayer?.update(delta);
      this.hud.update(delta, this.player, this.remotes.size);
      this.updateAdaptiveResolution(delta);
      return;
    }
    const wasDriving = this.vehicle.riding;
    if (controls.interact) {
      if (this.vehicle.riding) this.vehicle.exit();
      else this.vehicle.enter();
    }
    if (controls.passenger && !this.vehicle.riding) this.vehicle.enterPassenger();
    if (controls.exitVehicle && this.vehicle.riding) this.vehicle.exit();
    if (wasDriving !== this.vehicle.riding) {
      this.controller.velocity.set(0, 0, 0);
      this.controller.grounded = true;
    }
    this.input.setDriving(this.vehicle.riding);
    this.input.setWeaponDrawn(this.player.weapon.drawn);
    if (controls.toggleWeapon && !this.vehicle.riding) {
      this.player.weapon.setDrawn(!this.player.weapon.drawn);
      this.input.setWeaponDrawn(this.player.weapon.drawn);
    }
    const aiming = !this.vehicle.riding && this.input.enabled && this.player.weapon.drawn
      && (this.isTouchDevice || controls.aim);
    this.player.weapon.setAiming(aiming);
    this.world.updateStreaming(this.player.root.position.x, this.player.root.position.z);
    if (this.vehicle.riding) this.vehicle.update(delta, controls);
    else this.controller.update(delta, { ...controls, aiming }, this.followCamera.yaw);
    this.world.updateAmbient(delta, this.player.root.position, Date.now() + (this.multiplayer?.serverTimeOffset || 0));
    this.updatePursuit(delta);
    this.followCamera.update(delta, { ...controls, aiming, driving: this.vehicle.riding }, this.player.root.position);
    if (controls.shot && this.player.weapon.drawn && !this.vehicle.riding) this.fire(controls.shot);
    const nearby = !this.vehicle.riding && this.world.ambient?.nearestVehicle(this.player.root.position);
    const passengerNearby = !this.vehicle.riding && this.world.ambient?.nearestVehicle(this.player.root.position, 3.3, true);
    this.input.setVehicleAvailable(Boolean(nearby), Boolean(passengerNearby), nearby?.type);
    if (this.vehicleHealthHud) {
      this.vehicleHealthHud.hidden = !this.vehicle.riding;
      if (this.vehicle.riding) this.vehicleHealthHud.textContent =
        `AUTO ${this.world.ambient?.conditionOf(this.vehicle.vehicleId) ?? 100}% · ${this.vehicle.role === 'passenger' ? 'PASSEGGERO' : 'GUIDA'}`;
    }
    if (this.vehiclePrompt) {
      this.vehiclePrompt.hidden = !this.input.enabled || (!nearby && !passengerNearby && !this.vehicle.riding);
      this.vehiclePrompt.textContent = this.vehicle.riding ? 'Premi E per scendere'
        : nearby ? `E guida ${nearby.type === 'motorcycle' ? 'la moto' : "l'auto"} · F passeggero`
          : 'F sali come passeggero';
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
    const hit = this.world.raycastShot(origin, direction, SHOT_RANGE);
    const playerHit = findPlayerHit(this.shotRaycaster.ray, hit, this.remotes.players, SHOT_RANGE);
    const npcHit = this.world.ambient?.raycastPedestrian(this.shotRaycaster.ray, hit, SHOT_RANGE);
    const selectedPlayer = playerHit && (!npcHit || playerHit.distance <= npcHit.distance) ? playerHit : null;
    const selectedNpc = !selectedPlayer ? npcHit : null;
    const target = selectedPlayer?.point || selectedNpc?.point || hit
      || origin.clone().addScaledVector(direction, SHOT_RANGE);
    if (shot.touch) {
      this.player.root.rotation.y = Math.atan2(-direction.x, -direction.z);
      if (this.aimReticle) {
        this.aimReticle.style.left = `${shot.x}px`;
        this.aimReticle.style.top = `${shot.y}px`;
        this.reticleResetAt = performance.now() + 300;
      }
    }
    if (this.player.weapon.fireTo(target.toArray(), {
      local: true,
      origin: origin.toArray(),
      victimId: selectedPlayer?.playerId || null,
      npcId: selectedNpc?.id || null,
    })) {
      if (selectedPlayer) this.onCrime(1);
      if (selectedNpc) {
        const killed = this.world.ambient.hitPedestrian(selectedNpc.id, PISTOL_DAMAGE);
        this.onCrime(killed ? 2 : 1);
      }
      this.multiplayer?.sendStateNow();
    }
  }

  onCrime(severity) {
    this.wanted.crime(severity);
    this.updateWantedHud();
    this.multiplayer?.sendStateNow();
  }

  onCarTheft() { this.onCrime(1); }
  onNpcKilled() { this.onCrime(2); }

  updateWantedHud() {
    if (!this.wantedHud) return;
    this.wantedHud.hidden = this.wanted.stars === 0;
    this.wantedHud.textContent = `RICERCATO ${'★'.repeat(this.wanted.stars)}${'☆'.repeat(5 - this.wanted.stars)}`;
  }

  updatePursuit(delta) {
    const id = this.multiplayer?.playerId;
    if (!id) return;
    this.world.ambient?.setPlayerTarget(id, this.player.root.position);
    const previous = this.wanted.stars;
    this.wanted.update();
    if (previous !== this.wanted.stars) this.updateWantedHud();
    this.police.updateLocal(id, this.wanted.stars,
      this.player.root.position, this.player.root.rotation.y, delta);
    this.police.updateRemote(delta, id);
    if (this.wanted.stars > 0 && this.police.touchesLocal(id, this.player.root.position)) this.applyDamage(15);
    if (!this.vehicle.riding && this.world.ambient?.angryDriverTouches(id, this.player.root.position)) {
      this.applyDamage(10);
    }
  }

  receiveNpcShot(snapshot) {
    const ambient = this.world.ambient;
    if (!ambient || !Array.isArray(snapshot.shotOrigin) || !Array.isArray(snapshot.shotTarget)) return;
    const origin = new THREE.Vector3(...snapshot.shotOrigin);
    const target = new THREE.Vector3(...snapshot.shotTarget);
    const distance = origin.distanceTo(target);
    if (distance > SHOT_RANGE + 1 || distance < 0.05) return;
    const ray = new THREE.Ray(origin, target.sub(origin).normalize());
    const wall = this.world.raycastShot(origin, ray.direction, distance);
    const hit = ambient.raycastPedestrian(ray, wall, distance + 1);
    if (hit?.id === snapshot.shotNpcId) ambient.hitPedestrian(hit.id, PISTOL_DAMAGE);
  }

  updateHealthHud() {
    if (this.healthFill) this.healthFill.style.width = `${this.combat.health}%`;
    if (this.healthValue) this.healthValue.textContent = `${this.combat.health}/${100}`;
    if (this.healthHud) {
      this.healthHud.dataset.low = String(this.combat.health <= 25);
      this.healthHud.setAttribute('aria-label', `Vita ${this.combat.health} su 100`);
    }
  }

  receiveShot(snapshot) {
    if (!plausibleHit(snapshot, this.player.root.position, this.world, this.vehicle?.riding)) return;
    this.applyDamage(PISTOL_DAMAGE);
  }

  applyDamage(amount) {
    if (!this.combat.damage(amount)) return;
    this.player.health = this.combat.health;
    this.updateHealthHud();
    this.healthHud?.classList.remove('health-hit');
    void this.healthHud?.offsetWidth;
    this.healthHud?.classList.add('health-hit');
    if (this.combat.health === 0) {
      this.toggleSettings(false);
      this.wanted.clear();
      this.updateWantedHud();
      this.police.remove(this.multiplayer?.playerId);
      this.input.setEnabled(false);
      this.chat.setEnabled(false);
      if (this.vehicle?.riding) this.vehicle.exit();
      this.input.setDriving(false);
      this.player.weapon.setDrawn(false);
      this.player.weapon.setAiming(false);
      this.input.setWeaponDrawn(false);
      this.player.root.visible = false;
      if (this.vehicleHealthHud) this.vehicleHealthHud.hidden = true;
      this.controller.velocity.set(0, 0, 0);
      if (this.deathScreen) this.deathScreen.hidden = false;
      this.reenterButton?.focus();
    }
    this.multiplayer?.sendStateNow();
  }

  async respawn() {
    if (this.respawning || this.combat.health > 0 || this.disposed) return;
    this.respawning = true;
    if (this.reenterButton) {
      this.reenterButton.disabled = true;
      this.reenterButton.textContent = 'RIENTRO…';
    }
    let spawn = spawnForPlayer(this.world.spawn, this.multiplayer.playerId);
    try {
      await this.world.ensureAt(spawn[0], spawn[2]);
      const ground = this.world.groundHeightAt(spawn[0], spawn[2], spawn[1], 3, 20);
      if (Number.isFinite(ground)) spawn[1] = ground;
    } catch (error) {
      console.warn('[Free Roam] Respawn nella zona corrente:', error);
      spawn = this.player.root.position.toArray();
    }
    if (!this.disposed) {
      this.player.root.position.set(...spawn);
      this.controller.velocity.set(0, 0, 0);
      this.controller.grounded = true;
      this.player.root.visible = true;
      this.combat.respawn();
      this.player.health = this.combat.health;
      this.updateHealthHud();
      if (this.deathScreen) this.deathScreen.hidden = true;
      this.chat.setEnabled(true);
      this.input.setEnabled(Boolean(this.multiplayer?.online || this.multiplayer?.offlineMode));
      this.multiplayer?.sendStateNow();
    }
    if (this.reenterButton) {
      this.reenterButton.disabled = false;
      this.reenterButton.textContent = 'RIENTRA';
    }
    this.respawning = false;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  async dispose() {
    this.disposed = true;
    this.loop.stop();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onSettingsKeyDown, true);
    for (const button of this.settingsButtons) button.removeEventListener('click', this.onSettingsButton);
    this.qualitySelect?.removeEventListener('change', this.onGraphicsChange);
    this.distanceSelect?.removeEventListener('change', this.onGraphicsChange);
    if (this.settingsScreen) this.settingsScreen.hidden = true;
    this.hud.dispose();
    this.chat.dispose();
    if (this.aimReticle) this.aimReticle.hidden = true;
    if (this.vehiclePrompt) this.vehiclePrompt.hidden = true;
    if (this.healthHud) this.healthHud.hidden = true;
    if (this.deathScreen) this.deathScreen.hidden = true;
    this.reenterButton?.removeEventListener('click', this.onReenter);
    document.body.classList.remove('gameplay-active', 'network-disconnected');
    this.disconnectScreen.hide();
    this.input.dispose();
    this.stress?.dispose();
    await this.multiplayer?.disconnect();
    this.remotes.clear();
    this.player.dispose();
    this.police.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
