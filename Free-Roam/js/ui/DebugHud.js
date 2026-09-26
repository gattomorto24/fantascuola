export class DebugHud {
  constructor(root, interval) {
    this.root = root; this.interval = interval; this.elapsed = 0; this.frames = 0;
    this.fps = root.querySelector('#fps'); this.network = root.querySelector('#network'); this.players = root.querySelector('#players');
    this.position = root.querySelector('#position'); this.movement = root.querySelector('#movement'); this.detail = root.querySelector('#network-detail');
    this.map = root.querySelector('#map-name'); this.avatar = root.querySelector('#avatar-name'); this.assetStatus = root.querySelector('#asset-status');
  }
  setVisible(visible) { this.root.hidden = !visible; }
  setNetwork(online, detail) { this.network.textContent = online ? 'Online' : 'Offline'; this.detail.textContent = detail; }
  setMap(name) { this.map.textContent = name; }
  setAvatar(id) { this.avatar.textContent = id === 'default' ? 'Default' : id === 'pixel' ? 'Pixel' : id === 'local' ? 'GLB locale' : 'GLB pubblicato'; }
  setAssetStatus(message) { this.assetStatus.textContent = message; this.assetStatus.hidden = !message; }
  update(delta, player, remoteCount) {
    if (this.root.hidden) return;
    this.elapsed += delta; this.frames++;
    if (this.elapsed < this.interval) return;
    this.fps.textContent = String(Math.round(this.frames / this.elapsed));
    this.players.textContent = String(1 + remoteCount);
    const p = player.root.position;
    this.position.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    this.movement.textContent = player.movementState;
    this.elapsed = 0; this.frames = 0;
  }
}
