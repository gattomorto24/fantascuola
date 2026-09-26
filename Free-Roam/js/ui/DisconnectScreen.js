export class DisconnectScreen {
  constructor(root, { onReconnect, onOffline } = {}) {
    this.root = root;
    this.onReconnect = onReconnect;
    this.onOffline = onOffline;
    this.title = root?.querySelector('#disconnect-title');
    this.detail = root?.querySelector('#disconnect-detail');
    this.reconnectButton = root?.querySelector('#disconnect-reconnect');
    this.offlineButton = root?.querySelector('#disconnect-offline');

    this.reconnectButton?.addEventListener('click', () => this.onReconnect?.());
    this.offlineButton?.addEventListener('click', () => this.onOffline?.());
  }

  show() {
    if (!this.root) return;
    this.root.hidden = false;
    document.body.classList.add('network-disconnected');
    this.setReconnecting(false);
  }

  hide() {
    if (!this.root) return;
    this.root.hidden = true;
    document.body.classList.remove('network-disconnected');
  }

  setReconnecting(active) {
    if (!this.root) return;
    if (this.title) this.title.textContent = active ? 'RICONNESSIONE…' : 'DISCONNESSO';
    if (this.detail) this.detail.textContent = active
      ? 'Sto provando a rientrare nella sessione multiplayer.'
      : 'La connessione alla sessione multiplayer è stata interrotta.';
    if (this.reconnectButton) {
      this.reconnectButton.disabled = active;
      this.reconnectButton.textContent = active ? 'RICONNESSIONE…' : 'RICONNETTI';
    }
    if (this.offlineButton) this.offlineButton.disabled = false;
  }
}
