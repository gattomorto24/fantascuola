export class WebSocketTransport {
  constructor(url, handlers = {}) {
    this.url = url;
    this.handlers = handlers;
    this.socket = null;
    this.manualClose = false;
  }

  connect() {
    if (this.socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.socket.readyState)) return;
    this.manualClose = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.handlers.onOpen?.();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      let payload;
      try { payload = JSON.parse(event.data); }
      catch { return; }
      this.handlers.onMessage?.(payload);
    });

    socket.addEventListener('error', (event) => {
      if (this.socket !== socket) return;
      this.handlers.onError?.(event);
    });

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handlers.onClose?.(event, this.manualClose);
    });
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  close(code = 1000, reason = 'client close') {
    this.manualClose = true;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      if ([WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) socket.close(code, reason);
    } catch {}
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}
