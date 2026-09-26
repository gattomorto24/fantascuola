import { RemotePlayer } from './RemotePlayer.js';
export class RemotePlayerManager {
  constructor(scene, avatars, config) { this.scene = scene; this.avatars = avatars; this.config = config; this.players = new Map(); }
  receive(snapshot) {
    let player = this.players.get(snapshot.playerId);
    if (!player) { player = new RemotePlayer(this.scene, this.avatars, snapshot.playerId, this.config); this.players.set(snapshot.playerId, player); }
    player.applySnapshot(snapshot);
  }
  remove(id) { const player = this.players.get(id); if (player) { player.dispose(); this.players.delete(id); } }
  reconcile(presentIds) { for (const id of this.players.keys()) if (!presentIds.has(id)) this.remove(id); }
  update(delta) {
    const now = performance.now();
    for (const [id, player] of this.players) {
      if (now - player.lastSeen > this.config.staleSeconds * 1000) this.remove(id);
      else player.update(delta);
    }
  }
  clear() { for (const id of this.players.keys()) this.remove(id); }
  get size() { return this.players.size; }
}
