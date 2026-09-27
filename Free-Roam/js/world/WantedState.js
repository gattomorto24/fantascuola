export class WantedState {
  constructor() {
    this.stars = 0;
    this.lastCrimeAt = 0;
  }

  crime(severity = 1, now = Date.now()) {
    this.stars = Math.min(5, this.stars + Math.max(1, Math.round(severity)));
    this.lastCrimeAt = now;
    return this.stars;
  }

  update(now = Date.now()) {
    if (this.stars > 0 && now - this.lastCrimeAt >= 45000) {
      this.stars -= 1;
      this.lastCrimeAt = now;
    }
    return this.stars;
  }

  clear() {
    this.stars = 0;
    this.lastCrimeAt = 0;
  }
}
