export class GameLoop {
  constructor(update, render, maxDelta) { this.update = update; this.render = render; this.maxDelta = maxDelta; this.last = 0; this.running = false; this.frame = this.frame.bind(this); }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); this.handle = requestAnimationFrame(this.frame); }
  frame(now) {
    if (!this.running) return;
    const delta = Math.min(Math.max((now - this.last) / 1000, 0), this.maxDelta);
    this.last = now;
    this.update(delta, now);
    this.render();
    this.handle = requestAnimationFrame(this.frame);
  }
  stop() { this.running = false; cancelAnimationFrame(this.handle); }
}
