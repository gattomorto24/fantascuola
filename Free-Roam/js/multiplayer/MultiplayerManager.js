import { WebSocketTransport } from './WebSocketTransport.js';
import { isPixelAvatarConfig } from '../avatars/AvatarConfig.js';

const STATES = new Set(['Idle', 'Walking', 'Running', 'Jumping']);
const AVATAR_REF = /^(default|pixel|published:[0-9a-f-]{36})$/i;
const validNumber = (value) => Number.isFinite(value) && Math.abs(value) < 100000;
const validVehicleState = (state) => state && typeof state.id === 'string' && state.id.length <= 64
  && state.pose && validNumber(state.pose.x) && validNumber(state.pose.y)
  && validNumber(state.pose.z) && validNumber(state.pose.yaw)
  && Number.isSafeInteger(state.revision) && state.revision >= 0 && state.revision < 1_000_000_000
  && typeof state.author === 'string' && state.author.length <= 120;
const validChat = (chat) => chat && Number.isSafeInteger(chat.id) && chat.id > 0 && chat.id < 1_000_000_000
  && typeof chat.text === 'string' && chat.text.length > 0 && chat.text.length <= 160
  && !/[<>\u0000-\u001f\u007f]/.test(chat.text) && Number.isFinite(chat.at);

export function cleanChatText(value) {
  return String(value || '').replace(/[<>\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export const validAvatarConfig = isPixelAvatarConfig;

export function validSnapshot(value, maxAge = 60000) {
  if (!(!!value && typeof value.playerId === 'string' && value.playerId.length > 0 && value.playerId.length <= 120 &&
    typeof value.displayName === 'string' && value.displayName.length > 0 && value.displayName.length <= 32 && !/[<>\u0000-\u001f]/.test(value.displayName) &&
    typeof value.avatarId === 'string' && (AVATAR_REF.test(value.avatarId) || value.avatarId.length <= 160) &&
    value.position && validNumber(value.position.x) && validNumber(value.position.y) && validNumber(value.position.z) &&
    validNumber(value.rotation) && STATES.has(value.movementState) &&
    Number.isFinite(value.timestamp) && Math.abs(Date.now() - value.timestamp) < maxAge
    && (value.mapVersion === undefined || (typeof value.mapVersion === 'string' && value.mapVersion.length <= 128))
    && (value.weaponDrawn === undefined || typeof value.weaponDrawn === 'boolean')
    && (value.aiming === undefined || typeof value.aiming === 'boolean')
    && (value.shotId === undefined || (Number.isSafeInteger(value.shotId) && value.shotId >= 0 && value.shotId < 1_000_000_000))
    && (value.shotTarget === undefined || (Array.isArray(value.shotTarget) && value.shotTarget.length === 3 && value.shotTarget.every(validNumber)))
    && (value.vehicleId === undefined || (typeof value.vehicleId === 'string' && value.vehicleId.length <= 64))
    && (value.vehicleStates === undefined || (Array.isArray(value.vehicleStates) && value.vehicleStates.length <= 24
      && value.vehicleStates.every(validVehicleState)))
    && (value.chat === undefined || validChat(value.chat)))) return false;

  const avatarConfig = value.avatar?.type === 'pixel' ? value.avatar.config : value.avatarConfig;
  if (value.avatarId === 'pixel' && !validAvatarConfig(avatarConfig)) return false;
  if (value.avatar && (value.avatar.type !== 'pixel' || value.avatar.version !== 1)) return false;
  return true;
}

export class MultiplayerManager {
  constructor(_client, identity, localPlayer, remotes, config, onStatus, onLatency = () => {}, events = {}, mapVersion = 'test-world') {
    this.identity = identity;
    this.localPlayer = localPlayer;
    this.remotes = remotes;
    this.config = config;
    this.onStatus = onStatus;
    this.onLatency = onLatency;
    this.events = events;
    this.mapVersion = mapVersion;

    this.playerId = `${identity.userId}:${crypto.randomUUID()}`;
    this.online = false;
    this.disposed = false;
    this.offlineMode = false;
    this.transport = null;
    this.retryTimer = null;
    this.connectTimer = null;
    this.disconnectNoticeTimer = null;
    this.retryDelay = config.reconnectBaseMs ?? 1000;
    this.elapsed = 0;
    this.pingElapsed = 0;
    this.serverTimeOffset = 0;
    this.chat = null;
    this.chatSequence = 0;
    this.lastChatSentAt = -Infinity;
    this.lastChatSeen = new Map();
  }

  snapshot() {
    const p = this.localPlayer;
    const snapshot = {
      playerId: this.playerId,
      displayName: this.identity.displayName,
      avatarId: p.avatarId,
      avatar: p.avatarId === 'pixel' && p.avatarConfig
        ? { type: 'pixel', version: 1, config: p.avatarConfig }
        : { type: p.avatarId, version: 1 },
      position: { x: p.root.position.x, y: p.root.position.y, z: p.root.position.z },
      rotation: p.root.rotation.y,
      movementState: p.movementState,
      timestamp: Date.now(),
      mapVersion: this.mapVersion,
      weaponDrawn: p.weapon?.drawn || false,
      aiming: p.weapon?.aiming || false,
      shotId: p.weapon?.shotId || 0,
    };
    if (p.weapon?.shotTarget) snapshot.shotTarget = p.weapon.shotTarget;
    if (this.chat && Date.now() - this.chat.at < 30000) snapshot.chat = this.chat;
    const vehicles = this.events.getVehicleState?.();
    if (vehicles?.vehicleId) snapshot.vehicleId = vehicles.vehicleId;
    if (vehicles?.vehicleStates?.length) snapshot.vehicleStates = vehicles.vehicleStates;
    if (p.avatarId === 'pixel' && p.avatarConfig) snapshot.avatarConfig = p.avatarConfig;
    return snapshot;
  }

  sendChat(value) {
    if (!this.online || this.offlineMode || !this.transport?.connected
      || performance.now() - this.lastChatSentAt < 700) return null;
    const text = cleanChatText(value);
    if (!text) return null;
    const previous = this.chat;
    const chat = { id: ++this.chatSequence, text, at: Date.now() };
    this.chat = chat;
    if (!this.transport.send({ type: 'state', player: this.snapshot() })) {
      this.chat = previous;
      this.chatSequence -= 1;
      return null;
    }
    this.lastChatSentAt = performance.now();
    return { ...chat, displayName: this.identity.displayName, playerId: this.playerId };
  }

  receiveChat(snapshot) {
    const chat = snapshot.chat;
    if (!validChat(chat)) return;
    const previous = this.lastChatSeen.get(snapshot.playerId) || 0;
    if (chat.id <= previous) return;
    this.lastChatSeen.set(snapshot.playerId, chat.id);
    if (this.lastChatSeen.size > 512) this.lastChatSeen.delete(this.lastChatSeen.keys().next().value);
    this.events.onChat?.({ ...chat, playerId: snapshot.playerId, displayName: snapshot.displayName });
  }

  clearTimer(name) {
    if (this[name]) clearTimeout(this[name]);
    this[name] = null;
  }

  clearDisconnectNotice() {
    this.clearTimer('disconnectNoticeTimer');
  }

  scheduleDisconnectNotice() {
    if (this.disposed || this.offlineMode || this.online || this.disconnectNoticeTimer) return;
    this.disconnectNoticeTimer = setTimeout(() => {
      this.disconnectNoticeTimer = null;
      if (!this.online && !this.offlineMode && !this.disposed) this.events.onDisconnected?.();
    }, this.config.disconnectGracePeriodMs ?? 2200);
  }

  markDisconnected(detail = 'Riconnessione al server…') {
    if (this.disposed || this.offlineMode) return;
    this.online = false;
    this.remotes.clear();
    this.events.onVehicleReconcile?.(new Set());
    this.onStatus(false, detail);
    this.scheduleDisconnectNotice();
    this.scheduleReconnect();
  }

  connect() {
    if (this.disposed || this.offlineMode || this.transport) return;

    const transport = new WebSocketTransport(this.config.serverUrl, {
      onOpen: () => {
        if (this.disposed || this.offlineMode || this.transport !== transport) return;
        this.clearTimer('connectTimer');
        this.clearDisconnectNotice();
        this.retryDelay = this.config.reconnectBaseMs ?? 1000;
        this.online = true;
        transport.send({ type: 'join', player: this.snapshot() });
        this.onStatus(true, 'Connesso al server dedicato');
        this.events.onRecovered?.();
      },

      onMessage: (message) => this.receiveMessage(message),

      onError: () => {
        if (!this.disposed && !this.offlineMode && this.transport === transport) {
          this.onStatus(false, 'Problema di rete · tentativo di recupero…');
        }
      },

      onClose: (_event, manualClose) => {
        if (this.transport === transport) this.transport = null;
        this.clearTimer('connectTimer');
        this.online = false;
        if (this.disposed || this.offlineMode || manualClose) return;
        this.markDisconnected('Riconnessione al server…');
      },
    });

    this.transport = transport;
    transport.connect();

    this.connectTimer = setTimeout(() => {
      if (this.transport === transport && !transport.connected && !this.disposed && !this.offlineMode) {
        transport.close(4000, 'connect timeout');
        if (this.transport === transport) this.transport = null;
        this.markDisconnected('Server non raggiungibile · nuovo tentativo…');
      }
    }, this.config.connectTimeoutMs ?? 8000);
  }

  scheduleReconnect() {
    if (this.disposed || this.offlineMode || this.online || this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, this.config.reconnectMaxMs ?? 15000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  reconnectNow() {
    if (this.disposed) return;
    this.offlineMode = false;
    this.online = false;
    this.clearTimer('retryTimer');
    this.clearTimer('connectTimer');
    this.clearDisconnectNotice();
    this.remotes.clear();
    this.events.onVehicleReconcile?.(new Set());
    const old = this.transport;
    this.transport = null;
    old?.close(4001, 'manual reconnect');
    this.retryDelay = this.config.reconnectBaseMs ?? 1000;
    this.onStatus(false, 'Riconnessione…');
    this.events.onReconnectStart?.();
    this.connect();
  }

  continueOffline() {
    if (this.disposed) return;
    this.offlineMode = true;
    this.online = false;
    this.clearTimer('retryTimer');
    this.clearTimer('connectTimer');
    this.clearDisconnectNotice();
    const old = this.transport;
    this.transport = null;
    old?.close(1000, 'offline mode');
    this.remotes.clear();
    this.events.onVehicleReconcile?.(new Set());
    this.onStatus(false, 'OFFLINE · modalità locale');
    this.events.onOffline?.();
  }

  receiveMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'snapshot' && Array.isArray(message.players)) {
      if (Number.isFinite(message.serverTime)) this.serverTimeOffset = message.serverTime - Date.now();
      const present = new Set();
      for (const snapshot of message.players) {
        if (!validSnapshot(snapshot, Infinity) || snapshot.playerId === this.playerId || snapshot.mapVersion !== this.mapVersion) continue;
        present.add(snapshot.playerId);
        this.remotes.receive(snapshot);
        this.events.onVehicleSnapshot?.(snapshot);
        this.receiveChat(snapshot);
      }
      this.remotes.reconcile(present);
      this.events.onVehicleReconcile?.(present);
      return;
    }

    if ((message.type === 'join' || message.type === 'state') && validSnapshot(message.player, Infinity) && message.player.mapVersion === this.mapVersion) {
      if (message.player.playerId !== this.playerId) {
        this.remotes.receive(message.player);
        this.events.onVehicleSnapshot?.(message.player);
        this.receiveChat(message.player);
      }
      return;
    }

    if (message.type === 'leave' && typeof message.playerId === 'string') {
      this.remotes.remove(message.playerId);
      this.events.onVehicleLeave?.(message.playerId);
      return;
    }

    if (message.type === 'pong' && Number.isFinite(message.ts)) {
      const latency = Math.max(0, performance.now() - message.ts);
      this.onLatency(Math.round(latency));
      if (Number.isFinite(message.serverTime)) {
        const estimate = message.serverTime + latency / 2 - Date.now();
        this.serverTimeOffset = this.serverTimeOffset === 0
          ? estimate
          : this.serverTimeOffset * 0.8 + estimate * 0.2;
      }
      return;
    }

    if (message.type === 'error') {
      console.warn('[Free Roam] Server:', message.msg || 'errore');
    }
  }

  update(delta) {
    this.remotes.update(delta);
    if (!this.online || this.offlineMode || !this.transport?.connected) return;

    this.elapsed += delta;
    this.pingElapsed += delta;

    if (this.elapsed >= 1 / this.config.sendHz) {
      this.elapsed = 0;
      this.transport.send({ type: 'state', player: this.snapshot() });
    }

    if (this.pingElapsed >= (this.config.pingSeconds ?? 5)) {
      this.pingElapsed = 0;
      this.transport.send({ type: 'ping', ts: performance.now() });
    }
  }

  async disconnect() {
    this.disposed = true;
    this.online = false;
    this.offlineMode = false;
    this.clearTimer('retryTimer');
    this.clearTimer('connectTimer');
    this.clearDisconnectNotice();
    this.transport?.close();
    this.transport = null;
    this.remotes.clear();
    this.lastChatSeen.clear();
  }
}
