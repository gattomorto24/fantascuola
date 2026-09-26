const STATES = new Set(['Idle', 'Walking', 'Running', 'Jumping']);
const AVATAR_REF = /^(default|pixel|published:[0-9a-f-]{36})$/i;
const validNumber = (value) => Number.isFinite(value) && Math.abs(value) < 100000;
export function validSnapshot(value, maxAge = 60000) {
  return !!value && typeof value.playerId === 'string' && value.playerId.length > 0 && value.playerId.length <= 120 &&
    typeof value.displayName === 'string' && value.displayName.length > 0 && value.displayName.length <= 32 && !/[<>\u0000-\u001f]/.test(value.displayName) &&
    typeof value.avatarId === 'string' && AVATAR_REF.test(value.avatarId) &&
    value.position && validNumber(value.position.x) && validNumber(value.position.y) && validNumber(value.position.z) &&
    validNumber(value.rotation) && STATES.has(value.movementState) &&
    Number.isFinite(value.timestamp) && Math.abs(Date.now() - value.timestamp) < maxAge;
}

export class MultiplayerManager {
  constructor(client, identity, localPlayer, remotes, config, onStatus) {
    this.client = client; this.identity = identity; this.localPlayer = localPlayer; this.remotes = remotes; this.config = config; this.onStatus = onStatus;
    this.playerId = `${identity.userId}:${crypto.randomUUID()}`;
    this.online = false; this.elapsed = 0; this.presenceElapsed = 0; this.channel = null;
    this.disposed = false; this.retryTimer = null; this.retryDelay = config.reconnectBaseMs ?? 1000;
  }
  connect() {
    if (!this.client || !this.identity || this.channel || this.disposed) return;
    // Presence owns membership. Broadcast carries only temporary transforms; nothing writes positions to Postgres.
    const channel = this.client.channel('free-roam:v1', { config: { presence: { key: this.playerId }, broadcast: { self: false } } });
    this.channel = channel;
    channel.on('presence', { event: 'sync' }, () => this.syncPresence());
    channel.on('broadcast', { event: 'state' }, ({ payload }) => this.receive(payload));
    channel.subscribe(async (status) => {
      if (this.channel !== channel || this.disposed) return;
      if (status === 'SUBSCRIBED') {
        try {
          const result = await channel.track(this.snapshot());
          if (this.channel !== channel || this.disposed || this.retryTimer) return;
          if (result !== 'ok') throw new Error(`Presence track: ${result}`);
          this.retryDelay = this.config.reconnectBaseMs ?? 1000;
          this.online = true; this.onStatus(true, 'Connesso a Supabase Realtime');
          this.syncPresence();
        } catch (error) {
          console.warn('[Free Roam] Presence non disponibile:', error);
          this.reconnect(channel);
        }
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        console.warn('[Free Roam] Realtime:', status);
        this.reconnect(channel);
      }
    });
  }
  reconnect(channel) {
    if (this.channel !== channel || this.disposed || this.retryTimer) return;
    this.online = false; this.remotes.clear(); this.onStatus(false, 'Riconnessione multiplayer…');
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 30000);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (this.channel !== channel || this.disposed) return;
      this.channel = null;
      try { await this.client.removeChannel(channel); }
      catch (error) { console.warn('[Free Roam] Chiusura canale:', error); }
      this.connect();
    }, delay);
  }
  snapshot() {
    const p = this.localPlayer;
    return { playerId: this.playerId, displayName: this.identity.displayName, avatarId: p.avatarId,
      position: { x: p.root.position.x, y: p.root.position.y, z: p.root.position.z },
      rotation: p.root.rotation.y, movementState: p.movementState, timestamp: Date.now() };
  }
  syncPresence() {
    if (!this.channel) return;
    const present = new Set();
    for (const metas of Object.values(this.channel.presenceState())) {
      for (const meta of metas) {
        if (!validSnapshot(meta, Infinity) || meta.playerId === this.playerId) continue;
        present.add(meta.playerId); this.remotes.receive(meta);
      }
    }
    this.remotes.reconcile(present);
  }
  receive(payload) {
    if (!this.online || !validSnapshot(payload) || payload.playerId === this.playerId) return;
    // Ignore states from clients no longer present in the channel.
    const known = Object.values(this.channel.presenceState()).some((metas) => metas.some((meta) => meta.playerId === payload.playerId));
    if (known) this.remotes.receive(payload);
  }
  update(delta) {
    this.remotes.update(delta);
    if (!this.online) return;
    this.elapsed += delta;
    this.presenceElapsed += delta;
    if (this.presenceElapsed >= this.config.presenceRefreshSeconds) {
      this.presenceElapsed = 0;
      this.channel.track(this.snapshot()).catch((error) => console.warn('[Free Roam] Presence refresh:', error));
    }
    if (this.elapsed < 1 / this.config.sendHz) return;
    this.elapsed = 0;
    this.channel.send({ type: 'broadcast', event: 'state', payload: this.snapshot() })
      .then((result) => { if (result !== 'ok') console.warn('[Free Roam] Broadcast:', result); })
      .catch((error) => console.warn('[Free Roam] Broadcast fallito:', error));
  }
  async disconnect() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.online = false; this.remotes.clear();
    const channel = this.channel;
    this.channel = null;
    if (channel) await this.client.removeChannel(channel);
  }
}
