const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class StressHarness {
  constructor(remotes, count = 0) {
    this.remotes = remotes;
    this.count = clamp(Number(count) || 0, 0, 200);
    this.elapsed = 0;
    this.time = 0;
    this.ids = [];

    for (let i = 0; i < this.count; i++) this.ids.push(`stress:${i + 1}`);
    this.pushSnapshots();
  }

  snapshot(index) {
    const ring = 12 + (index % 5) * 4;
    const speed = 0.18 + (index % 7) * 0.015;
    const angle = this.time * speed + (index / Math.max(1, this.count)) * Math.PI * 2;
    return {
      playerId: this.ids[index],
      displayName: `BOT ${String(index + 1).padStart(3, '0')}`,
      avatarId: 'pixel',
      position: {
        x: Math.cos(angle) * ring,
        y: 1,
        z: Math.sin(angle) * ring,
      },
      rotation: -angle + Math.PI / 2,
      movementState: 'Running',
      timestamp: Date.now(),
    };
  }

  pushSnapshots() {
    for (let i = 0; i < this.count; i++) this.remotes.receive(this.snapshot(i));
  }

  update(delta) {
    if (!this.count) return;
    this.time += delta;
    this.elapsed += delta;
    if (this.elapsed < 0.1) return;
    this.elapsed = 0;
    this.pushSnapshots();
  }

  dispose() {
    for (const id of this.ids) this.remotes.remove(id);
    this.ids.length = 0;
  }
}
