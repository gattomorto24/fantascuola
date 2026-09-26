export class DebugHud {
  constructor(root, interval) {
    this.root = root;
    this.interval = interval;
    this.elapsed = 0;
    this.frames = 0;
    this.compactTimer = null;

    this.fps = root.querySelector('#fps');
    this.network = root.querySelector('#network');
    this.players = root.querySelector('#players');
    this.position = root.querySelector('#position');
    this.movement = root.querySelector('#movement');
    this.detail = root.querySelector('#network-detail');
    this.map = root.querySelector('#map-name');
    this.avatar = root.querySelector('#avatar-name');
    this.assetStatus = root.querySelector('#asset-status');
    this.latency = root.querySelector('#latency');

    this.compactRoot = document.getElementById('compact-hud');
    this.compactStats = document.getElementById('compact-stats');
  }

  setVisible(visible) {
    this.root.hidden = !visible;
    if (!visible && this.compactRoot) this.compactRoot.hidden = true;
  }

  startCompactCountdown(delay = 5000) {
    clearTimeout(this.compactTimer);
    this.root.hidden = false;
    if (this.compactRoot) this.compactRoot.hidden = true;

    this.compactTimer = setTimeout(() => {
      this.root.hidden = true;
      if (this.compactRoot) this.compactRoot.hidden = false;
    }, delay);
  }

  setNetwork(online, detail) {
    this.network.textContent = online ? 'Online' : 'Offline';
    this.detail.textContent = detail;
  }

  setLatency(ms) {
    if (this.latency) this.latency.textContent = Number.isFinite(ms) ? `${ms} ms` : '—';
  }

  setMap(name) { this.map.textContent = name; }

  setAvatar(id) {
    this.avatar.textContent = id === 'default'
      ? 'Default'
      : id === 'pixel'
        ? 'Pixel'
        : id === 'local'
          ? 'GLB locale'
          : 'GLB pubblicato';
  }

  setAssetStatus(message) {
    this.assetStatus.textContent = message;
    this.assetStatus.hidden = !message;
  }

  update(delta, player, remoteCount) {
    this.elapsed += delta;
    this.frames += 1;
    if (this.elapsed < this.interval) return;

    const fps = Math.round(this.frames / this.elapsed);
    const players = 1 + remoteCount;

    this.fps.textContent = String(fps);
    this.players.textContent = String(players);
    if (this.compactStats) this.compactStats.textContent = `${fps} FPS - ${players} Players`;

    const p = player.root.position;
    this.position.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    this.movement.textContent = player.movementState;

    this.elapsed = 0;
    this.frames = 0;
  }

  dispose() {
    clearTimeout(this.compactTimer);
    this.compactTimer = null;
    if (this.compactRoot) this.compactRoot.hidden = true;
  }
}
