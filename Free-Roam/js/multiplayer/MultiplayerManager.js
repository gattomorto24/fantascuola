import { WebSocketTransport } from './WebSocketTransport.js';

const STATES = new Set(['Idle', 'Walking', 'Running', 'Jumping']);
const AVATAR_REF = /^(default|pixel|published:[0-9a-f-]{36})$/i;
const validNumber = (value) => Number.isFinite(value) && Math.abs(value) < 100000;

const PIXEL_VALUES = Object.freeze({
  skinTone: new Set(['light', 'medium', 'amber', 'dark']),
  hairColor: new Set(['blonde', 'light-brown', 'brown', 'black']),
  shirtColor: new Set(['red', 'yellow', 'blue']),
  pantsColor: new Set(['red', 'yellow', 'blue']),
  shoesColor: new Set(['black', 'white']),
});

export function validAvatarConfig(value) {
  return !!value && typeof value === 'object' &&
    value.version === 1 && value.type === 'pixel' && value.hairStyle === 'basic' &&
    PIXEL_VALUES.skinTone.has(value.skinTone) &&
    PIXEL_VALUES.hairColor.has(value.hairColor) &&
    PIXEL_VALUES.shirtColor.has(value.shirtColor) &&
    PIXEL_VALUES.pantsColor.has(value.pantsColor) &&
    PIXEL_VALUES.shoesColor.has(value.shoesColor);
}

export function validSnapshot(value, maxAge = 60000) {
  if (!(!!value && typeof value.playerId === 'string' && value.playerId.length > 0 && value.playerId.length <= 120 &&
    typeof value.displayName === 'string' && value.displayName.length > 0 && value.displayName.length <= 32 && !/[<>\u0000-\u001f]/.test(value.displayName) &&
    typeof value.avatarId === 'string' && (AVATAR_REF.test(value.avatarId) || value.avatarId.length <= 160) &&
    value.position && validNumber(value.position.x) && validNumber(value.position.y) && validNumber(value.position.z) &&
    validNumber(value.rotation) && STATES.has(value.movementState) &&
    Number.isFinite(value.timestamp) && Math.abs(Date.now() - value.timestamp) < maxAge)) return false;

  if (value.avatarId === 'pixel' && value.avatarConfig != null && !validAvatarConfig(value.avatarConfig)) return false;
  return true;
}

export class MultiplayerManager {
  constructor(_client, identity, localPlayer, remotes, config, onStatus, onLatency = () => {}, events = {}) {
    this.identity = identity;
    this.localPlayer = localPlayer;
    this.remotes = remotes;
    this.config = config;
    this.onStatus = onStatus;
    this.onLatency = onLatency;
    this.events = events;

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
  }

  snapshot() {
    const p = this.localPlayer;
    const snapshot = {
      playerId: this.playerId,
      displayName: this.identity.displayName,
      avatarId: p.avatarId,
      position: { x: p.root.position.x, y: p.root.position.y, z: p.root.position.z },
      rotation: p.root.rotation.y,
      movementState: p.movementState,
      timestamp: Date.now(),
    };
    if (p.avatarId === 'pixel' && p.avatarConfig) snapshot.avatarConfig = p.avatarConfig;
    return snapshot;
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
    this.onStatus(false, 'OFFLINE · modalità locale');
    this.events.onOffline?.();
  }

  receiveMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'snapshot' && Array.isArray(message.players)) {
      const present = new Set();
      for (const snapshot of message.players) {
        if (!validSnapshot(snapshot, Infinity) || snapshot.playerId === this.playerId) continue;
        present.add(snapshot.playerId);
        this.remotes.receive(snapshot);
      }
      this.remotes.reconcile(present);
      return;
    }

    if ((message.type === 'join' || message.type === 'state') && validSnapshot(message.player, Infinity)) {
      if (message.player.playerId !== this.playerId) this.remotes.receive(message.player);
      return;
    }

    if (message.type === 'leave' && typeof message.playerId === 'string') {
      this.remotes.remove(message.playerId);
      return;
    }

    if (message.type === 'pong' && Number.isFinite(message.ts)) {
      this.onLatency(Math.max(0, Math.round(performance.now() - message.ts)));
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
  }
}
