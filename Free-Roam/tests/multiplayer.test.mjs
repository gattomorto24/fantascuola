import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerManager, validSnapshot } from '../js/multiplayer/MultiplayerManager.js';

function player(x = 0) { return { root: { position: { x, y: 0, z: 0 }, rotation: { y: 0 } }, avatarId: 'default', movementState: 'Idle' }; }
function remotes() {
  const items = new Map();
  return { items, receive: (snapshot) => items.set(snapshot.playerId, snapshot), reconcile: (ids) => { for (const id of items.keys()) if (!ids.has(id)) items.delete(id); }, clear: () => items.clear(), update: () => {} };
}
function bus() {
  const channels = new Set(); const presence = new Map();
  const sync = () => { for (const channel of channels) channel.handlers.sync?.(); };
  return {
    client() {
      return {
        channel(_topic, options) {
          const channel = {
            key: options.config.presence.key, handlers: {},
            on(_kind, filter, fn) { this.handlers[filter.event] = fn; return this; },
            subscribe(fn) { this.status = fn; channels.add(this); queueMicrotask(() => fn('SUBSCRIBED')); return this; },
            presenceState() { return Object.fromEntries([...presence].map(([id, state]) => [id, [state]])); },
            async track(state) { presence.set(this.key, state); sync(); return 'ok'; },
            async send(message) { for (const peer of channels) if (peer !== this) peer.handlers.state?.({ payload: message.payload }); return 'ok'; },
          };
          return channel;
        },
        async removeChannel(channel) { channels.delete(channel); presence.delete(channel.key); sync(); },
      };
    },
  };
}

test('rifiuta stati remoti invalidi', () => {
  const state = { playerId: 'a', displayName: 'Tony', avatarId: 'default', position: { x: 1, y: 0, z: 2 }, rotation: 0, movementState: 'Walking', timestamp: Date.now() };
  assert.equal(validSnapshot(state), true);
  assert.equal(validSnapshot({ ...state, position: { x: Infinity, y: 0, z: 0 } }), false);
  assert.equal(validSnapshot({ ...state, displayName: '<script>' }), false);
  assert.equal(validSnapshot({ ...state, avatarId: 'https://host/file.glb' }), false);
  assert.equal(validSnapshot({ ...state, timestamp: Date.now() - 61000 }), false);
});

test('Presence, Broadcast e uscita funzionano tra due client', async () => {
  const network = bus(), remoteA = remotes(), remoteB = remotes();
  const config = { sendHz: 10, presenceRefreshSeconds: 5 };
  const a = new MultiplayerManager(network.client(), { userId: crypto.randomUUID(), displayName: 'Tony' }, player(1), remoteA, config, () => {});
  const b = new MultiplayerManager(network.client(), { userId: crypto.randomUUID(), displayName: 'Altro' }, player(4), remoteB, config, () => {});
  a.connect(); b.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(remoteA.items.get(b.playerId)?.displayName, 'Altro');
  assert.equal(remoteB.items.get(a.playerId)?.displayName, 'Tony');
  a.localPlayer.root.position.x = 9;
  a.update(0.11);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(remoteB.items.get(a.playerId)?.position.x, 9);
  await a.disconnect();
  assert.equal(remoteB.items.has(a.playerId), false);
  await b.disconnect();
});

test('un canale chiuso si riconnette e ripubblica la presenza', async () => {
  const network = bus(), remoteA = remotes(), remoteB = remotes();
  const config = { sendHz: 10, presenceRefreshSeconds: 5, reconnectBaseMs: 5 };
  const a = new MultiplayerManager(network.client(), { userId: crypto.randomUUID(), displayName: 'Tony' }, player(1), remoteA, config, () => {});
  const b = new MultiplayerManager(network.client(), { userId: crypto.randomUUID(), displayName: 'Altro' }, player(4), remoteB, config, () => {});
  a.connect(); b.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const firstChannel = a.channel;
  firstChannel.status('CLOSED');
  assert.equal(a.online, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.notEqual(a.channel, firstChannel);
  assert.equal(a.online, true);
  assert.equal(remoteB.items.get(a.playerId)?.displayName, 'Tony');
  await a.disconnect();
  await b.disconnect();
});
